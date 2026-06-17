use crate::grab::{show_overlay_core, OverlayPayload};

/// 前端调用唤起悬浮窗（降级打断路径复用）。
///
/// 与 Shortcut B 内部调用同一条核心路径 `show_overlay_core`。
#[tauri::command]
pub fn show_overlay(
    app_handle: tauri::AppHandle,
    payload: OverlayPayload,
) -> Result<(), String> {
    show_overlay_core(&app_handle, payload)
}
