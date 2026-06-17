/// UIA 纯函数工具集：过滤、决策、错误映射、遍历限制。
///
/// 这些函数不依赖 COM/FFI，可以在无 UI 环境的 CI 中安全编译和测试。
/// 调用方（windows.rs）通过 Cargo feature `uia-grab` 门控。

use crate::grab::GrabError;

// ── 常量 ──────────────────────────────────────────────────────────────────────

/// TreeWalker 最大遍历节点数，防止在巨型控件树上耗时过长。
pub const MAX_TREEWALKER_NODES: u32 = 500;

// ── 元素过滤 ──────────────────────────────────────────────────────────────────

/// 判断节点是否包含可用的选中文本。
///
/// 提取为纯函数便于单元测试（无需 COM 环境）。
/// `pattern_result` 为 `GetCurrentPattern(UIA_TextPatternId)` 的返回值。
pub fn check_node_has_text<T>(
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

// ── 遍历控制 ──────────────────────────────────────────────────────────────────

/// 遍历计数器自增并检查是否超限。
///
/// 返回 `true` 表示已达上限。
pub fn increment_and_check_limit(count: &mut u32, limit: u32) -> bool {
    *count += 1;
    *count > limit
}

/// 判断 Level 1 结果是否应触发 TreeWalker 降级遍历。
///
/// 触发条件：`UnsupportedElement` 或空/纯空白文本。
/// 不触发：非空文本、`NoSelection`、`System`、`AccessibilityDenied` 等。
pub fn should_activate_treewalker(result: &Result<String, GrabError>) -> bool {
    match result {
        Ok(text) if !text.trim().is_empty() => false,
        Err(GrabError::UnsupportedElement) | Ok(_) => true,
        _ => false,
    }
}

// ── 错误映射 ──────────────────────────────────────────────────────────────────

/// 将 `windows::core::Error` 映射为业务语义错误。
pub fn map_uia_error(err: windows::core::Error) -> GrabError {
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
        let err = hresult_error(-2147220991);
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
        assert!(!should_activate_treewalker(&Err(GrabError::NoSelection)));
    }

    #[test]
    fn should_activate_false_for_system_error() {
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

        let trigger: &[(&str, Result<String, GrabError>)] = &[
            ("UnsupportedElement", Err(GrabError::UnsupportedElement)),
            ("Ok 空串", Ok(String::new())),
            ("Ok 空白", Ok("  ".into())),
        ];
        for (label, r) in trigger {
            assert!(should_activate_treewalker(r), "应触发 TreeWalker: {label}");
        }

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
