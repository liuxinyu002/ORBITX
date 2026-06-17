/// Windows UIA 文本抓取实现。
///
/// 使用官方 `windows` crate 通过 UI Automation 从当前焦点控件读取选中文本。
/// 支持多级策略：直接提取（Level 1）→ TreeWalker 深度遍历（Level 2）。

use crate::grab::{GrabEngine, GrabError};

// ── 类型引入 ──────────────────────────────────────────────────────────────

use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
    IUIAutomationTextRange, IUIAutomationTreeWalker, UIA_TextPatternId,
};


// ── 常量 ──────────────────────────────────────────────────────────────────

/// TreeWalker 最大遍历节点数，防止在巨型控件树上耗时过长。
const MAX_TREEWALKER_NODES: u32 = 500;

// ── COM RAII Guard ────────────────────────────────────────────────────────

/// COM 初始化 guard，构造时 CoInitializeEx，析构时 CoUninitialize。
struct ComGuard;

impl ComGuard {
    fn initialize() -> Result<Self, GrabError> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| {
                    log::error!(target: "grab", "COM 初始化失败: {}", e);
                    map_uia_error(e)
                })?;
        }
        Ok(ComGuard)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize(); }
    }
}

// ── 纯函数：元素过滤决策 ──────────────────────────────────────────────────

/// 判断节点是否包含可用的选中文本。
///
/// 提取为纯函数便于单元测试（无需 COM 环境）。
/// `pattern_result` 为 `GetCurrentPattern(UIA_TextPatternId)` 的返回值。
fn check_node_has_text<T>(
    pattern_result: Result<T, windows::core::Error>,
    selection_len: i32,
    text: &str,
) -> Option<String> {
    // 不支持 TextPattern → None
    pattern_result.ok()?;
    // selection 为空 → None
    if selection_len == 0 {
        return None;
    }
    // GetText 空串 → None
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 正常文本 → Some
    Some(trimmed.to_string())
}

/// 遍历计数器自增并检查是否超限。
///
/// 提取为纯函数便于单元测试。返回 `true` 表示已达上限。
fn increment_and_check_limit(count: &mut u32, limit: u32) -> bool {
    *count += 1;
    *count > limit
}

/// 判断 Level 1 结果是否应触发 TreeWalker 降级遍历。
///
/// 提取为纯函数便于单元测试（无需 COM 环境）。
/// 触发条件：`UnsupportedElement` 或空/纯空白文本。
/// 不触发：非空文本、`NoSelection`、`System`、`AccessibilityDenied` 等。
fn should_activate_treewalker(result: &Result<String, GrabError>) -> bool {
    match result {
        Ok(text) if !text.trim().is_empty() => false,
        Err(GrabError::UnsupportedElement) | Ok(_) => true,
        _ => false,
    }
}

// ── 平台引擎 ──────────────────────────────────────────────────────────────

pub struct WinGrabEngine;

impl WinGrabEngine {
    pub fn new() -> Self {
        WinGrabEngine
    }
}

impl GrabEngine for WinGrabEngine {
    fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError> {
        let _com = ComGuard::initialize()?;

        unsafe {
            // 1. 创建 UIA client
            let uia: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| {
                        log::error!(target: "grab", "创建 CUIAutomation 失败: {}", e);
                        map_uia_error(e)
                    })?;

            // 2. 获取焦点元素
            let element: IUIAutomationElement = uia.GetFocusedElement()
                .map_err(|e| {
                    log::error!(target: "grab", "获取焦点元素失败: {}", e);
                    map_uia_error(e)
                })?;

            // Level 1: 从焦点元素直接提取
            let level1 = try_direct_extract(&element, max_length);
            if should_activate_treewalker(&level1) {
                // Level 2: TreeWalker 深度遍历子树
                try_treewalker_grab(&element, &uia, max_length)
            } else {
                level1
            }
        }
    }
}

// ── Level 1: 直接提取 ────────────────────────────────────────────────────

/// 从焦点元素直接提取选中文本（现有路径）。
unsafe fn try_direct_extract(
    element: &IUIAutomationElement,
    max_length: usize,
) -> Result<String, GrabError> {
    let pattern = element
        .GetCurrentPattern(UIA_TextPatternId)
        .map_err(|e| map_uia_error(e))?;
    let text_pattern: IUIAutomationTextPattern = pattern
        .cast()
        .map_err(|e| {
            log::error!(target: "grab", "IUIAutomationTextPattern cast 失败: {}", e);
            map_uia_error(e)
        })?;

    let selection = text_pattern.GetSelection()
        .map_err(|e| {
            log::error!(target: "grab", "获取文本 selection 失败: {}", e);
            map_uia_error(e)
        })?;

    let count = selection.Length()
        .map_err(|e| {
            log::error!(target: "grab", "获取 selection 长度失败: {}", e);
            map_uia_error(e)
        })?;

    if count == 0 {
        log::debug!(target: "grab", "UIA selection 为空，无选中文本");
        return Err(GrabError::NoSelection);
    }

    let range: IUIAutomationTextRange = selection
        .GetElement(0)
        .map_err(|e| {
            log::error!(target: "grab", "获取 TextRange[0] 失败: {}", e);
            map_uia_error(e)
        })?;

    let text = range.GetText(max_length as i32)
        .map_err(|e| {
            log::error!(target: "grab", "GetText 失败: {}", e);
            map_uia_error(e)
        })?;

    Ok(text.to_string())
}

// ── Level 2: TreeWalker 深度遍历 ──────────────────────────────────────────

/// 尝试从单个 UIA 元素提取选中文本，用于 TreeWalker 遍历中的节点检查。
unsafe fn try_extract_text(
    element: &IUIAutomationElement,
    max_length: usize,
) -> Option<String> {
    let pattern_result = element.GetCurrentPattern(UIA_TextPatternId);
    let pattern = pattern_result.ok()?;
    let text_pattern: IUIAutomationTextPattern = pattern.cast().ok()?;
    let selection = text_pattern.GetSelection().ok()?;
    let count = selection.Length().ok()?;
    let range: IUIAutomationTextRange = selection.GetElement(0).ok()?;
    let text = range.GetText(max_length as i32).ok()?;
    check_node_has_text(Ok::<(), windows::core::Error>(()), count, &text.to_string())
}

/// TreeWalker DFS 递归遍历。
///
/// 从 `element` 出发深度优先搜索子节点中的文本。
/// `nodes_visited` 已包含当前节点（调用方已自增）。
unsafe fn dfs_walk(
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
    max_length: usize,
    nodes_visited: &mut u32,
    depth: u32,
) -> Result<Option<String>, GrabError> {
    // 检查当前节点
    if let Some(text) = try_extract_text(element, max_length) {
        log::info!(target: "grab", "TreeWalker: 在第 {} 个节点（深度 {}）找到选中文本（{} 字符）",
            nodes_visited, depth, text.chars().count());
        return Ok(Some(text));
    }

    // 深度优先遍历子节点
    let first_child = walker.GetFirstChildElement(element);
    match first_child {
        Ok(mut child) => loop {
            // 超限检查（每个子节点自增一次）
            if increment_and_check_limit(nodes_visited, MAX_TREEWALKER_NODES) {
                log::info!(target: "grab", "TreeWalker: 遍历 {} 节点后未找到文本承载节点，降级至剪贴板", MAX_TREEWALKER_NODES);
                return Err(GrabError::UnsupportedElement);
            }

            log::debug!(target: "grab", "TreeWalker: 遍历第 {} 个节点，当前深度 {}", nodes_visited, depth + 1);

            match dfs_walk(walker, &child, max_length, nodes_visited, depth + 1) {
                Ok(Some(text)) => return Ok(Some(text)),
                Ok(None) => {}
                Err(e) => return Err(e),
            }

            let sibling = walker.GetNextSiblingElement(&child);
            match sibling {
                Ok(s) => child = s,
                Err(e) => {
                    log::debug!(target: "grab", "TreeWalker: GetNextSiblingElement 失败，跳过后续兄弟节点: {}", e);
                    break;
                }
            }
        },
        Err(e) => {
            log::debug!(target: "grab", "TreeWalker: GetFirstChildElement 失败，跳过该分支: {}", e);
        }
    }

    Ok(None)
}

/// Level 2: 使用 ControlViewWalker 从焦点元素出发深度优先搜索子节点中的文本。
fn try_treewalker_grab(
    element: &IUIAutomationElement,
    uia: &IUIAutomation,
    max_length: usize,
) -> Result<String, GrabError> {
    log::info!(target: "grab", "TreeWalker: GetFocusedElement 未获文本，启动子树遍历（最多 {} 节点）", MAX_TREEWALKER_NODES);

    let walker = unsafe {
        uia.ControlViewWalker().map_err(|e| {
            log::error!(target: "grab", "TreeWalker: 获取 ControlViewWalker 失败: {}", e);
            map_uia_error(e)
        })?
    };

    let mut nodes_visited: u32 = 0;

    // 根元素自身计为第 1 个节点
    if increment_and_check_limit(&mut nodes_visited, MAX_TREEWALKER_NODES) {
        log::info!(target: "grab", "TreeWalker: 遍历 {} 节点后未找到文本承载节点，降级至剪贴板", MAX_TREEWALKER_NODES);
        return Err(GrabError::UnsupportedElement);
    }

    unsafe {
        match dfs_walk(&walker, element, max_length, &mut nodes_visited, 0)? {
            Some(text) => Ok(text),
            None => {
                log::info!(target: "grab", "TreeWalker: 遍历 {} 节点后未找到文本承载节点，降级至剪贴板", nodes_visited);
                Err(GrabError::UnsupportedElement)
            }
        }
    }
}

// ── 错误映射 ──────────────────────────────────────────────────────────────

fn map_uia_error(err: windows::core::Error) -> GrabError {
    let code = err.code();
    let hresult = code.0 as i32;

    // UIA_E_ELEMENTNOTAVAILABLE / UIA_E_PATTERNUNAVAILABLE
    if hresult == -2147220991 {
        log::debug!(target: "grab", "UIA element 不可用/不支持 TextPattern");
        return GrabError::UnsupportedElement;
    }

    match hresult {
        // E_ACCESSDENIED
        -2147024891 => {
            log::warn!(target: "grab", "UIA 权限被拒绝");
            GrabError::AccessibilityDenied
        }
        // E_INVALIDARG
        -2147024809 => {
            log::debug!(target: "grab", "UIA 参数无效，视为 NoSelection");
            GrabError::NoSelection
        }
        _ => {
            log::error!(target: "grab", "UIA 系统错误 HRESULT=0x{:08X}", hresult);
            GrabError::System(format!("UIA 错误 HRESULT=0x{hresult:08X}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::HRESULT;

    fn hresult_error(code: i32) -> windows::core::Error {
        windows::core::Error::new(HRESULT(code), "test")
    }

    // ── map_uia_error ────────────────────────────────────────────────────

    #[test]
    fn map_e_accessdenied() {
        let err = map_uia_error(hresult_error(-2147024891));
        assert_eq!(err, GrabError::AccessibilityDenied);
    }

    #[test]
    fn map_uia_pattern_unavailable_to_unsupported() {
        let err = map_uia_error(hresult_error(-2147220991));
        assert_eq!(err, GrabError::UnsupportedElement);
    }

    #[test]
    fn map_e_invalidarg_to_no_selection() {
        let err = map_uia_error(hresult_error(-2147024809));
        assert_eq!(err, GrabError::NoSelection);
    }

    #[test]
    fn map_unknown_hresult_to_system() {
        let err = map_uia_error(hresult_error(-2147467263)); // E_NOTIMPL
        assert!(matches!(err, GrabError::System(msg) if msg.contains("80004001")));
    }

    // ── check_node_has_text ──────────────────────────────────────────────

    #[test]
    fn check_node_has_text_no_pattern_returns_none() {
        let err = hresult_error(-2147220991); // UIA_E_ELEMENTNOTAVAILABLE
        assert_eq!(check_node_has_text(Err::<(), _>(err), 1, "hello"), None);
    }

    #[test]
    fn check_node_has_text_empty_selection_returns_none() {
        assert_eq!(check_node_has_text(Ok(()), 0, "hello"), None);
    }

    #[test]
    fn check_node_has_text_empty_gettext_returns_none() {
        assert_eq!(check_node_has_text(Ok(()), 1, ""), None);
    }

    #[test]
    fn check_node_has_text_whitespace_only_returns_none() {
        assert_eq!(check_node_has_text(Ok(()), 1, "   \t\n "), None);
    }

    #[test]
    fn check_node_has_text_normal_text_returns_some() {
        assert_eq!(
            check_node_has_text(Ok(()), 1, "hello"),
            Some("hello".to_string())
        );
    }

    #[test]
    fn check_node_has_text_trims_whitespace() {
        assert_eq!(
            check_node_has_text(Ok(()), 1, "  hello world  "),
            Some("hello world".to_string())
        );
    }

    // ── should_activate_treewalker ──────────────────────────────────────

    #[test]
    fn should_activate_true_for_unsupported_element() {
        assert!(should_activate_treewalker(&Err(GrabError::UnsupportedElement)));
    }

    #[test]
    fn should_activate_true_for_ok_empty_string() {
        assert!(should_activate_treewalker(&Ok(String::new())));
    }

    #[test]
    fn should_activate_true_for_ok_whitespace_only() {
        assert!(should_activate_treewalker(&Ok("   ".into())));
        assert!(should_activate_treewalker(&Ok("\t\n ".into())));
    }

    #[test]
    fn should_activate_false_for_ok_non_empty_text() {
        assert!(!should_activate_treewalker(&Ok("hello".into())));
        assert!(!should_activate_treewalker(&Ok("  hello  ".into())));
    }

    #[test]
    fn should_activate_false_for_no_selection() {
        // NoSelection 表示用户未选中任何文本，TreeWalker 无意义
        assert!(!should_activate_treewalker(&Err(GrabError::NoSelection)));
    }

    #[test]
    fn should_activate_false_for_system_error() {
        // System 错误直接透传给 grab_with_fallback 降级到剪贴板
        assert!(!should_activate_treewalker(&Err(GrabError::System(
            "UIA 错误".into()
        ))));
    }

    #[test]
    fn should_activate_false_for_other_errors() {
        assert!(!should_activate_treewalker(&Err(GrabError::AccessibilityDenied)));
        assert!(!should_activate_treewalker(&Err(GrabError::ClipboardTimeout)));
        assert!(!should_activate_treewalker(&Err(GrabError::ClipboardLockFailed)));
        assert!(!should_activate_treewalker(&Err(GrabError::Internal("test".into()))));
    }

    /// 显式穷举所有 GrabError 变体，确保新增变体时编译失败
    #[test]
    fn should_activate_coverage_exhaustive() {
        let payload = "test".to_string();

        // 应触发 TreeWalker 的变体
        let trigger: &[(&str, Result<String, GrabError>)] = &[
            ("UnsupportedElement", Err(GrabError::UnsupportedElement)),
            ("Ok 空串", Ok(String::new())),
            ("Ok 空白", Ok("  ".into())),
        ];
        for (label, r) in trigger {
            assert!(should_activate_treewalker(r), "应触发 TreeWalker: {label}");
        }

        // 不应触发 TreeWalker 的变体
        let non_trigger: &[(&str, Result<String, GrabError>)] = &[
            ("Ok 非空", Ok("hello".into())),
            ("NoSelection", Err(GrabError::NoSelection)),
            ("System", Err(GrabError::System(payload.clone()))),
            ("AccessibilityDenied", Err(GrabError::AccessibilityDenied)),
            ("ClipboardTimeout", Err(GrabError::ClipboardTimeout)),
            ("ClipboardLockFailed", Err(GrabError::ClipboardLockFailed)),
            ("Internal", Err(GrabError::Internal(payload))),
        ];
        for (label, r) in non_trigger {
            assert!(!should_activate_treewalker(r), "不应触发 TreeWalker: {label}");
        }
    }

    // ── increment_and_check_limit ────────────────────────────────────────

    #[test]
    fn increment_and_check_limit_under_limit_returns_false() {
        let mut count = 0;
        assert!(!increment_and_check_limit(&mut count, 5));
        assert_eq!(count, 1);
    }

    #[test]
    fn increment_and_check_limit_at_limit_returns_false() {
        let mut count = 4;
        assert!(!increment_and_check_limit(&mut count, 5));
        assert_eq!(count, 5);
    }

    #[test]
    fn increment_and_check_limit_exceeds_limit_returns_true() {
        let mut count = 5;
        assert!(increment_and_check_limit(&mut count, 5));
        assert_eq!(count, 6);
    }

    #[test]
    fn increment_and_check_limit_reaches_max_treewalker_nodes() {
        let mut count = MAX_TREEWALKER_NODES - 1;
        assert!(!increment_and_check_limit(&mut count, MAX_TREEWALKER_NODES));
        assert_eq!(count, MAX_TREEWALKER_NODES);
        assert!(increment_and_check_limit(&mut count, MAX_TREEWALKER_NODES));
        assert_eq!(count, MAX_TREEWALKER_NODES + 1);
    }
}
