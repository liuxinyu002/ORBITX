use crate::db::{self, state::DbState};
use crate::errors::CommandResult;
use log;
use tauri::State;

/// 验证 IPC 通路：从 app_kv 读取 ipc_status 键值并返回。
#[tauri::command]
pub fn check_ipc_status(db: State<'_, DbState>) -> CommandResult<String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| crate::errors::AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let status = db::get_kv(&conn, "ipc_status")?;
    log::debug!("IPC 状态检查: {}", status);
    Ok(status)
}
