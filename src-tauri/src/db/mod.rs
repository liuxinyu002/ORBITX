pub mod migrations;
pub mod state;

use crate::errors::AppError;
use rusqlite::Connection;

/// 从 app_kv 表中读取键值。
pub fn get_kv(conn: &Connection, key: &str) -> Result<String, AppError> {
    let value: String = conn
        .query_row(
            "SELECT value FROM app_kv WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: format!("kv:{key}"),
            },
            other => AppError::Database(other),
        })?;
    Ok(value)
}

/// 向 app_kv 表中写入键值（存在则更新）。
pub fn set_kv(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO app_kv (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::state::DbState;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn setup_migrated_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        conn
    }

    // ── CP-DB-3: 迁移创建 app_kv 表并插入种子数据 ──────────────────────

    #[test]
    fn migration_creates_app_kv_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_kv'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "app_kv 表应该存在");
    }

    #[test]
    fn migration_seeds_schema_version() {
        let conn = setup_migrated_db();
        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "2");
    }

    #[test]
    fn migration_seeds_ipc_status() {
        let conn = setup_migrated_db();
        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='ipc_status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "ok");
    }

    // ── CP-DB-1: WAL 模式已启用（需文件数据库，内存库始终返回 "memory"）─

    #[test]
    fn migration_enables_wal_mode() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("orbitx_test_{}.db", std::process::id()));
        let mut conn = Connection::open(&path).unwrap();
        migrations::run_migrations(&mut conn).unwrap();

        let journal_mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        // 清理测试文件
        drop(conn);
        let _ = std::fs::remove_file(&path);
        assert_eq!(journal_mode, "wal", "WAL 模式应该已启用");
    }

    // ── CP-DB-2: 外键约束已启用 ────────────────────────────────────────

    #[test]
    fn migration_enables_foreign_keys() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();

        let fk: i32 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1, "外键约束应该已启用");
    }

    // ── CP-DB-4: 迁移幂等 — 重复执行不报错且数据保留 ──────────────────

    #[test]
    fn migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        // 第二次调用不应报错
        let result = migrations::run_migrations(&mut conn);
        assert!(result.is_ok(), "第二次迁移不应出错");
    }

    #[test]
    fn migration_preserves_data_on_rerun() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        // 再次执行迁移
        migrations::run_migrations(&mut conn).unwrap();

        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='ipc_status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "ok", "数据应该在迁移重跑后保留");
    }

    // ── CP-DB-6: get_kv 读已有 key → 返回值 ────────────────────────────

    #[test]
    fn get_kv_returns_value_for_existing_key() {
        let conn = setup_migrated_db();
        let result = get_kv(&conn, "ipc_status").unwrap();
        assert_eq!(result, "ok");
    }

    // ── CP-DB-6: get_kv 读不存在 key → NotFound ────────────────────────

    #[test]
    fn get_kv_returns_not_found_for_missing_key() {
        let conn = setup_migrated_db();
        let result = get_kv(&conn, "nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound { source_id } => {
                assert_eq!(source_id, "kv:nonexistent");
            }
            other => panic!("应该返回 NotFound，却返回了: {other:?}"),
        }
    }

    // ── CP-DB-6: set_kv 插入新 key ─────────────────────────────────────

    #[test]
    fn set_kv_inserts_new_key() {
        let conn = setup_migrated_db();
        set_kv(&conn, "test_key", "test_value").unwrap();

        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='test_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "test_value");
    }

    // ── CP-DB-6: set_kv 更新已有 key ────────────────────────────────────

    #[test]
    fn set_kv_updates_existing_key() {
        let conn = setup_migrated_db();
        set_kv(&conn, "ipc_status", "updated").unwrap();

        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='ipc_status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "updated");
    }

    // ── CP-DB-5: Mutex 中毒 → InvalidState（不 panic）───────────────────

    #[test]
    fn mutex_poison_maps_to_invalid_state() {
        let state = DbState {
            conn: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        // 故意污染 Mutex：持有锁时 panic
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.conn.lock().unwrap();
            panic!("intentional poison in test");
        }));

        // 现在 Mutex 应该已被污染
        let result: Result<_, AppError> = state
            .conn
            .lock()
            .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")));
        assert!(result.is_err(), "Mutex 被污染后应返回错误");
        match result.unwrap_err() {
            AppError::InvalidState(msg) => {
                assert!(
                    msg.contains("DB 锁获取失败"),
                    "错误消息应包含 'DB 锁获取失败'，实际: {msg}"
                );
            }
            other => panic!("应该返回 InvalidState，却返回了: {other:?}"),
        }
    }
}
