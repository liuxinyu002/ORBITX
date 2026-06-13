/// macOS AXUIElement 文本抓取实现。
///
/// 通过 `core-foundation` + `extern "C"` 最小绑定调用 AX API，
/// 从当前焦点应用中读取选中文本。
use std::ffi::c_void;

use core_foundation::base::{CFRelease, CFTypeRef, CFRange, CFIndex, TCFType};
use core_foundation::string::{CFString, CFStringRef};

use crate::grab::{GrabEngine, GrabError};

// ── 类型别名 ──────────────────────────────────────────────────────────────

type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = i32;
type AXValueType = i32;
type CFTypeID = usize;

// ── AXError 常量 ──────────────────────────────────────────────────────────

const _K_AX_ERROR_SUCCESS: AXError = 0;
const K_AX_ERROR_API_DISABLED: AXError = -25211;
const K_AX_ERROR_NO_VALUE: AXError = -25212;
const K_AX_ERROR_ATTRIBUTE_UNSUPPORTED: AXError = -25205;
const K_AX_ERROR_NOT_IMPLEMENTED: AXError = -25208;
const K_AX_ERROR_ACTION_UNSUPPORTED: AXError = -25206;
// ── AXValueType 常量 ──────────────────────────────────────────────────────

const K_AX_VALUE_CF_RANGE_TYPE: AXValueType = 4;

// ── AX 属性常量（CFString 运行时创建，调用后不释放=进程级常量） ────────────

fn ax_attr(name: &'static str) -> CFStringRef {
    let cf = CFString::from_static_string(name);
    let ptr = cf.as_concrete_TypeRef();
    std::mem::forget(cf);
    ptr
}

fn ax_focused_app_attr() -> CFStringRef {
    ax_attr("AXFocusedApplication")
}
fn ax_focused_ui_attr() -> CFStringRef {
    ax_attr("AXFocusedUIElement")
}
fn ax_selected_text_range_attr() -> CFStringRef {
    ax_attr("AXSelectedTextRange")
}
fn ax_string_for_range_attr() -> CFStringRef {
    ax_attr("AXStringForRange")
}

// ── extern "C" FFI 绑定 ───────────────────────────────────────────────────

extern "C" {
    // AX API
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: AXUIElementRef,
        parameterized_attribute: CFStringRef,
        parameter: CFTypeRef,
        result: *mut CFTypeRef,
    ) -> AXError;
    fn AXValueCreate(
        value_type: AXValueType,
        value_ptr: *const c_void,
    ) -> AXValueRef;
    fn AXValueGetValue(
        value: AXValueRef,
        value_type: AXValueType,
        value_ptr: *mut c_void,
    ) -> u8;

    // Type ID 查询
    fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
    fn AXUIElementGetTypeID() -> CFTypeID;
    fn AXValueGetTypeID() -> CFTypeID;
    fn CFStringGetTypeID() -> CFTypeID;
}

// ── RAII 封装 ─────────────────────────────────────────────────────────────

/// 对 Copy* API 返回的 CFTypeRef 自动调用 CFRelease。
struct CFGuard(CFTypeRef);

impl CFGuard {
    unsafe fn from_copy(ptr: CFTypeRef) -> Self {
        CFGuard(ptr)
    }
}

impl Drop for CFGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0); }
        }
    }
}

/// 获取 CF 对象的类型 ID。
fn cf_type_id(ptr: CFTypeRef) -> CFTypeID {
    if ptr.is_null() {
        return 0;
    }
    unsafe { CFGetTypeID(ptr) }
}

// ── 平台引擎 ──────────────────────────────────────────────────────────────

pub struct MacGrabEngine;

impl MacGrabEngine {
    pub fn new() -> Self {
        MacGrabEngine
    }
}

impl GrabEngine for MacGrabEngine {
    fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError> {
        unsafe {
            // 1. 创建 system-wide AX 引用
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                log::error!(target: "grab", "AXUIElementCreateSystemWide 返回 null");
                return Err(GrabError::System("无法创建系统级 AX 引用".into()));
            }
            let _system_guard = CFGuard(system as CFTypeRef);

            // 2. 获取焦点应用
            let mut app_ref: CFTypeRef = std::ptr::null();
            let ax_err = AXUIElementCopyAttributeValue(
                system,
                ax_focused_app_attr(),
                &mut app_ref,
            );
            if ax_err != 0 {
                return Err(map_ax_error(ax_err));
            }
            let _app_guard = CFGuard::from_copy(app_ref);

            if cf_type_id(app_ref) != AXUIElementGetTypeID() {
                log::error!(target: "grab", "AXFocusedApplication 属性返回非 AXUIElement 类型");
                return Err(GrabError::System("焦点应用获取返回非预期类型".into()));
            }

            // 3. 获取焦点 UI 元素
            let mut element_ref: CFTypeRef = std::ptr::null();
            let ax_err = AXUIElementCopyAttributeValue(
                app_ref as AXUIElementRef,
                ax_focused_ui_attr(),
                &mut element_ref,
            );
            if ax_err != 0 {
                return Err(map_ax_error(ax_err));
            }
            let _element_guard = CFGuard::from_copy(element_ref);

            if cf_type_id(element_ref) != AXUIElementGetTypeID() {
                log::error!(target: "grab", "AXFocusedUIElement 属性返回非 AXUIElement 类型");
                return Err(GrabError::System("焦点元素获取返回非预期类型".into()));
            }

            // 4. 获取选中文本范围
            let mut range_ref: CFTypeRef = std::ptr::null();
            let ax_err = AXUIElementCopyAttributeValue(
                element_ref as AXUIElementRef,
                ax_selected_text_range_attr(),
                &mut range_ref,
            );
            if ax_err != 0 {
                return Err(map_ax_error(ax_err));
            }
            let _range_guard = CFGuard::from_copy(range_ref);

            // 5. 类型校验 & 提取 CFRange
            if cf_type_id(range_ref) != AXValueGetTypeID() {
                log::debug!(target: "grab", "选中文本范围非 AXValue 类型，视为无选中文本");
                return Err(GrabError::NoSelection);
            }

            let mut cf_range = CFRange {
                location: 0,
                length: 0,
            };
            let ok = AXValueGetValue(
                range_ref as AXValueRef,
                K_AX_VALUE_CF_RANGE_TYPE,
                (&mut cf_range) as *mut CFRange as *mut c_void,
            );
            if ok == 0 {
                log::error!(target: "grab", "AXValueGetValue 返回 false，无法提取 CFRange");
                return Err(GrabError::Internal("无法从 AXValue 提取 CFRange".into()));
            }

            // 6. Clamp 到 max_length
            if cf_range.length <= 0 {
                log::debug!(target: "grab", "选中范围长度为 0，无选中文本");
                return Err(GrabError::NoSelection);
            }
            if cf_range.length > max_length as CFIndex {
                cf_range.length = max_length as CFIndex;
            }

            // 7. 用 clamped range 创建 AXValue
            let clamped_value = AXValueCreate(
                K_AX_VALUE_CF_RANGE_TYPE,
                (&cf_range) as *const CFRange as *const c_void,
            );
            if clamped_value.is_null() {
                log::error!(target: "grab", "AXValueCreate 返回 null");
                return Err(GrabError::Internal("AXValueCreate 返回 null".into()));
            }
            let _clamped_guard = CFGuard(clamped_value as CFTypeRef);

            // 8. 获取范围内的文本
            let mut text_ref: CFTypeRef = std::ptr::null();
            let ax_err = AXUIElementCopyParameterizedAttributeValue(
                element_ref as AXUIElementRef,
                ax_string_for_range_attr(),
                clamped_value as CFTypeRef,
                &mut text_ref,
            );
            if ax_err != 0 {
                return Err(map_ax_error(ax_err));
            }
            let _text_guard = CFGuard::from_copy(text_ref);

            // 9. 类型校验 & 转为 Rust String
            if cf_type_id(text_ref) != CFStringGetTypeID() {
                log::error!(target: "grab", "StringForRange 返回非 CFString 类型");
                return Err(GrabError::Internal("StringForRange 返回非 CFString 类型".into()));
            }

            let cf_string = CFString::wrap_under_get_rule(text_ref as CFStringRef);
            let mut text = cf_string.to_string();

            // Unicode 标量边界二次截断
            if text.len() > max_length {
                let mut end = max_length;
                while end > 0 && !text.is_char_boundary(end) {
                    end -= 1;
                }
                text.truncate(end);
            }

            Ok(text)
        }
    }
}

// ── 错误映射 ──────────────────────────────────────────────────────────────

fn map_ax_error(code: AXError) -> GrabError {
    match code {
        K_AX_ERROR_API_DISABLED => {
            log::warn!(target: "grab", "辅助功能权限被拒绝");
            GrabError::AccessibilityDenied
        }
        K_AX_ERROR_NO_VALUE => {
            log::debug!(target: "grab", "AX 返回 NoValue，无选中文本");
            GrabError::NoSelection
        }
        K_AX_ERROR_ATTRIBUTE_UNSUPPORTED => {
            log::debug!(target: "grab", "AX 属性不支持（非文本元素），视为 UnsupportedElement");
            GrabError::UnsupportedElement
        }
        K_AX_ERROR_NOT_IMPLEMENTED => {
            log::debug!(target: "grab", "AX 功能未实现，可能为 UnsupportedElement");
            GrabError::UnsupportedElement
        }
        K_AX_ERROR_ACTION_UNSUPPORTED => {
            log::debug!(target: "grab", "AX 操作不支持，视为 UnsupportedElement");
            GrabError::UnsupportedElement
        }
        _ => {
            log::error!(target: "grab", "AX 系统错误 代码={}", code);
            GrabError::System(format!("AX API 错误 代码={code}"))
        }
    }
}
