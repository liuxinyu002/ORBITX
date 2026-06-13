use serde::{Deserialize, Serialize};

pub mod constants;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod state;
#[cfg(target_os = "windows")]
pub mod windows;

/// 抓取来源：快捷键 A（静默提取）或 B（命令面板）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GrabSource {
    #[serde(rename = "shortcut-a")]
    ShortcutA,
    #[serde(rename = "shortcut-b")]
    ShortcutB,
}

/// 统一的抓取错误类型，前端只看到这 5 种业务语义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum GrabError {
    /// 系统权限被拒绝，需引导用户授权
    AccessibilityDenied,
    /// 当前无选中文本
    NoSelection,
    /// 焦点控件不支持文本选择
    UnsupportedElement,
    /// 未知底层 API 错误，保留原始信息
    System(String),
    /// 非平台层错误
    Internal(String),
}

/// 跨平台文本抓取 trait。每次快捷键触发时临时创建实例，不放入 Tauri State。
pub trait GrabEngine {
    fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError>;
}

/// 悬浮窗 blur-auto-hide 抑制标记。
///
/// 当 overlay 处于 `PermissionRequired` 态时设为 `true`，
/// Rust 侧 `Focused(false)` handler 检查此标记决定是否跳过 hide。
pub struct OverlayPermissionState(pub std::sync::atomic::AtomicBool);

impl OverlayPermissionState {
    pub fn new() -> Self {
        Self(std::sync::atomic::AtomicBool::new(false))
    }
}

/// 抓取结果，附带截断标记。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrabResult {
    pub text: String,
    /// token 估算超限后是否被截断
    pub truncated: bool,
}

/// 判断字符是否属于 CJK 区块（中文/日文/韩文）。
fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x4E00..=0x9FFF   // CJK Unified Ideographs
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x20000..=0x2A6DF // Extension B
        | 0xF900..=0xFAFF // CJK Compatibility
        | 0x3040..=0x309F // Hiragana
        | 0x30A0..=0x30FF // Katakana
        | 0xAC00..=0xD7AF // Hangul
    )
}

/// 估算文本的 token 数量。
///
/// ASCII 字符 ≈0.25 token/字（4 字 ≈ 1 token），
/// CJK 字符 ≈1.5 token/字，其他 Unicode ≈1.0 token/字。
pub fn estimate_tokens(text: &str) -> usize {
    let mut count: f64 = 0.0;
    for ch in text.chars() {
        if ch.is_ascii() {
            count += 0.25;
        } else if is_cjk(ch) {
            count += 1.5;
        } else {
            count += 1.0;
        }
    }
    count.ceil() as usize
}

/// 按 token 估算截断文本，返回 (截断后文本, 是否发生截断)。
/// 截断点保证在 Unicode 标量边界上。
pub fn truncate_by_tokens(text: &str, max_tokens: usize) -> (String, bool) {
    let mut accumulated: f64 = 0.0;
    for (byte_offset, ch) in text.char_indices() {
        let token_cost = if ch.is_ascii() {
            0.25
        } else if is_cjk(ch) {
            1.5
        } else {
            1.0
        };
        if accumulated + token_cost > max_tokens as f64 {
            // byte_offset 始终在 char 边界上
            return (text[..byte_offset].to_string(), true);
        }
        accumulated += token_cost;
    }
    (text.to_string(), false)
}

/// 根据编译目标导出平台实现。
#[cfg(target_os = "macos")]
pub use macos::MacGrabEngine as PlatformGrabEngine;
#[cfg(target_os = "windows")]
pub use windows::WinGrabEngine as PlatformGrabEngine;

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_cjk ──────────────────────────────────────────────────────────

    #[test]
    fn is_cjk_returns_true_for_cjk_unified_ideographs() {
        assert!(is_cjk('中')); // U+4E2D (CJK Unified, boundary start area)
        assert!(is_cjk('字')); // U+5B57
        assert!(is_cjk('\u{9FFF}')); // CJK Unified end boundary
    }

    #[test]
    fn is_cjk_returns_false_below_cjk() {
        assert!(!is_cjk('\u{33FF}')); // just below CJK Extension A start
        assert!(!is_cjk('A'));
        assert!(!is_cjk(' '));
    }

    #[test]
    fn is_cjk_returns_false_above_cjk_unified() {
        assert!(!is_cjk('\u{A000}')); // Yi Syllables, just above CJK Unified end
    }

    #[test]
    fn is_cjk_covers_extension_a() {
        assert!(is_cjk('\u{3400}')); // start of Extension A
        assert!(is_cjk('\u{4DBF}')); // end of Extension A
    }

    #[test]
    fn is_cjk_covers_hiragana_katakana() {
        assert!(is_cjk('あ')); // U+3042 Hiragana
        assert!(is_cjk('カ')); // U+30AB Katakana
        assert!(is_cjk('\u{309F}')); // Hiragana end
        assert!(is_cjk('\u{30FF}')); // Katakana end
    }

    #[test]
    fn is_cjk_covers_hangul() {
        assert!(is_cjk('한')); // U+D55C Hangul
        assert!(is_cjk('\u{AC00}')); // Hangul start
        assert!(is_cjk('\u{D7AF}')); // Hangul end
    }

    // ── estimate_tokens ─────────────────────────────────────────────────

    #[test]
    fn estimate_tokens_pure_ascii() {
        let text = "hello world 123";
        let tokens = estimate_tokens(text);
        // 14 ASCII chars × 0.25 = 3.5, ceil = 4
        assert_eq!(tokens, 4);
    }

    #[test]
    fn estimate_tokens_pure_cjk() {
        let text = "你好世界";
        let tokens = estimate_tokens(text);
        // 4 CJK chars × 1.5 = 6.0
        assert_eq!(tokens, 6);
    }

    #[test]
    fn estimate_tokens_mixed_cjk_ascii() {
        let text = "hello 你好";
        let tokens = estimate_tokens(text);
        // 6 ASCII chars (hello + space) × 0.25 = 1.5
        // 2 CJK × 1.5 = 3.0
        // total 4.5, ceil = 5
        assert_eq!(tokens, 5);
    }

    #[test]
    fn estimate_tokens_empty_string() {
        assert_eq!(estimate_tokens(""), 0);
    }

    // ── truncate_by_tokens ──────────────────────────────────────────────

    #[test]
    fn truncate_no_cut_when_under_limit() {
        let (text, truncated) = truncate_by_tokens("hello", 10);
        assert_eq!(text, "hello");
        assert!(!truncated);
    }

    #[test]
    fn truncate_cuts_at_exact_unicode_boundary() {
        // 5 ASCII chars = 1.25 tokens, limit=1 token
        let (text, truncated) = truncate_by_tokens("hello", 1);
        // First 4 chars "hell" = 1.0 token, 5th 'o' would be 1.25 → cut at byte 4
        assert_eq!(text, "hell");
        assert!(truncated);
    }

    #[test]
    fn truncate_cjk_at_boundary() {
        // Each CJK = 1.5 tokens, limit = 3 tokens → 2 chars fit
        let (text, truncated) = truncate_by_tokens("你好世界", 3);
        assert_eq!(text, "你好");
        assert!(truncated);
    }

    #[test]
    fn truncate_multi_byte_char_not_split() {
        // 'ñ' (U+00F1, 2 UTF-8 bytes) is non-ASCII, non-CJK → 1.0 token
        // "abc" (3 ASCII × 0.25 = 0.75), +'ñ' (1.0) = 1.75 > limit=1 → cut at byte 3
        let text = "abcñdef";
        let (truncated_text, _) = truncate_by_tokens(text, 1);
        assert_eq!(truncated_text, "abc");
    }

    #[test]
    fn truncate_empty_string() {
        let (text, truncated) = truncate_by_tokens("", 10);
        assert_eq!(text, "");
        assert!(!truncated);
    }

    #[test]
    fn truncate_zero_tokens_drops_all() {
        let (text, truncated) = truncate_by_tokens("abc", 0);
        assert_eq!(text, "");
        assert!(truncated);
    }

    #[test]
    fn truncate_exactly_at_limit_not_truncated() {
        // 4 ASCII chars × 0.25 = 1.0 token, limit = 1
        let (text, truncated) = truncate_by_tokens("abcd", 1);
        // 'a'=0.25, 'b'=0.5, 'c'=0.75, 'd'=1.0 → fits exactly
        assert_eq!(text, "abcd");
        assert!(!truncated);
    }
}
