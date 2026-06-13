use std::sync::atomic::Ordering;

use tauri::State;

use crate::grab::state::GrabState;
use crate::grab::{GrabError, GrabResult, OverlayPermissionState};

/// 前端按 `requestId` 定向消费抓取结果。
///
/// 返回 `Ok(None)` 表示未找到匹配的信封（可能已过期或被消费）。
#[tauri::command]
pub fn consume_grabbed_result(
    request_id: String,
    state: State<'_, GrabState>,
) -> Result<Option<GrabResult>, GrabError> {
    match state.consume(&request_id) {
        Ok(Some(result)) => result.map(Some),
        Ok(None) => Ok(None),
        Err(e) => Err(e),
    }
}

/// 前端设置 overlay 权限引导态，用于抑制 blur-auto-hide。
#[tauri::command]
pub fn set_overlay_permission_state(
    suppressed: bool,
    state: State<'_, OverlayPermissionState>,
) {
    state.0.store(suppressed, Ordering::Release);
    if suppressed {
        log::debug!(target: "overlay", "权限引导态已开启，暂停 blur-auto-hide");
    } else {
        log::debug!(target: "overlay", "权限引导态已关闭，恢复 blur-auto-hide");
    }
}
