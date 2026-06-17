/// Windows UIA 文本抓取实现。
///
/// 使用官方 `windows` crate 通过 UI Automation 从当前焦点控件读取选中文本。
/// 支持多级策略：直接提取（Level 1）→ TreeWalker 深度遍历（Level 2）。
///
/// 此模块通过 `#[cfg(not(test))]` 隔离——测试环境中不编译，避免
/// `Win32_UI_Accessibility` 功能在无 UI 的 Windows Server 上触发
/// `STATUS_ENTRYPOINT_NOT_FOUND`。

use crate::grab::{GrabEngine, GrabError};
use super::uia_utils::{
    check_node_has_text, increment_and_check_limit, map_uia_error,
    should_activate_treewalker, MAX_TREEWALKER_NODES,
};

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
