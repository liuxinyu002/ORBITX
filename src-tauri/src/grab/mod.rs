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
