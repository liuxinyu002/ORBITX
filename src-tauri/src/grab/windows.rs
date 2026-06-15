/// Windows UIA 文本抓取实现。
///
/// 使用官方 `windows` crate 通过 UI Automation 从当前焦点控件读取选中文本。

use crate::grab::{GrabEngine, GrabError};

// ── 类型引入 ──────────────────────────────────────────────────────────────

use windows::core::Interface;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::UI::UIAutomation::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
    IUIAutomationTextRange, UIA_TextPatternId,
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
            let uia: IUIAutomation = CUIAutomation::new()
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

            // 3. 获取 TextPattern
            let pattern = element
                .GetCurrentPattern(UIA_TextPatternId)
                .map_err(|e| map_uia_error(e))?;
            let text_pattern: IUIAutomationTextPattern = pattern
                .cast()
                .map_err(|e| {
                    log::error!(target: "grab", "IUIAutomationTextPattern cast 失败: {}", e);
                    map_uia_error(e)
                })?;

            // 4. 获取 selection
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

            // 5. 取第一个 range，GetText 带 max_length 截断
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
}
