use rusqlite::Connection;
use std::sync::Mutex;

/// 数据库状态，通过 Tauri Managed State 注入到所有 Command。
pub struct DbState {
    pub conn: Mutex<Connection>,
}
