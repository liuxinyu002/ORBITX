use crate::grab::{show_overlay_core, OverlayPayload, ToastPayload, show_toast};
use tauri::Manager;

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

/// 前端调用唤起 toast 消息通知（提取成功反馈）。
#[tauri::command]
pub async fn show_toast_command(
    app_handle: tauri::AppHandle,
    payload: ToastPayload,
) -> Result<(), String> {
    show_toast(&app_handle, payload).await
}

/// 关闭 toast 窗口（loading 态无定时器，需在 show_overlay 路径显式关闭）。
#[tauri::command]
pub fn hide_toast(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(toast) = app_handle.get_webview_window("toast") {
        log::debug!(target: "toast", "hide_toast: 隐藏 toast 窗口");
        let _ = toast.hide();
    }
    Ok(())
}
