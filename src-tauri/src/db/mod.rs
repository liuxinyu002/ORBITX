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

/// 向 app_kv 表中写入键值（存在则更新），时间戳使用 ISO 8601 格式。
pub fn set_kv(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO app_kv (key, value, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// 从 app_kv 表中删除键值。key 不存在时静默成功。
pub fn delete_kv(conn: &Connection, key: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM app_kv WHERE key = ?1", [key])?;
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
        assert_eq!(value, "4");
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

    // ── CP-26: set_kv 使用 ISO 8601 时间戳 ─────────────────────────────

    #[test]
    fn set_kv_writes_iso8601_timestamp() {
        let conn = setup_migrated_db();
        set_kv(&conn, "iso_test_key", "iso_value").unwrap();

        let updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM app_kv WHERE key='iso_test_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // ISO 8601 格式: 2026-06-12T08:30:00.000Z
        assert!(
            updated_at.contains('T') && updated_at.ends_with('Z'),
            "set_kv 的 updated_at 应为 ISO 8601 格式，实际: {updated_at}"
        );
        // 验证毫秒精度（包含小数点）
        assert!(
            updated_at.contains('.'),
            "ISO 8601 应包含毫秒精度，实际: {updated_at}"
        );
    }

    #[test]
    fn set_kv_update_preserves_iso8601_timestamp() {
        let conn = setup_migrated_db();
        // 先插入
        set_kv(&conn, "update_iso_key", "v1").unwrap();
        // 再更新
        set_kv(&conn, "update_iso_key", "v2").unwrap();

        let updated_at: String = conn
            .query_row(
                "SELECT updated_at FROM app_kv WHERE key='update_iso_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            updated_at.contains('T') && updated_at.ends_with('Z'),
            "更新后的 updated_at 应为 ISO 8601 格式，实际: {updated_at}"
        );
    }

    // ── delete_kv 测试 ─────────────────────────────────────────────────

    #[test]
    fn delete_kv_removes_existing_key() {
        let conn = setup_migrated_db();
        set_kv(&conn, "active_task_id", "task-1").unwrap();
        delete_kv(&conn, "active_task_id").unwrap();

        let result = get_kv(&conn, "active_task_id");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound { source_id } => {
                assert_eq!(source_id, "kv:active_task_id");
            }
            other => panic!("应该返回 NotFound，却返回了: {other:?}"),
        }
    }

    #[test]
    fn delete_kv_nonexistent_key_succeeds() {
        let conn = setup_migrated_db();
        let result = delete_kv(&conn, "nonexistent");
        assert!(result.is_ok(), "删除不存在的 key 应该静默成功");
    }

    // ── V3 迁移: tasks 表创建 ──────────────────────────────────────────

    #[test]
    fn v3_migration_creates_tasks_table() {
        let conn = setup_migrated_db();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "tasks 表应该存在");
    }

    #[test]
    fn v3_tasks_table_has_no_is_active_column() {
        let conn = setup_migrated_db();

        let col_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='is_active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(col_count, 0, "tasks 表不应有 is_active 列");
    }

    #[test]
    fn v3_tasks_table_has_schema_column() {
        let conn = setup_migrated_db();

        let col_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='schema'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(col_count, 1, "tasks 表应该有 schema 列");
    }

    // ── V3 迁移: model_configs ISO 8601 时间戳 ─────────────────────────

    #[test]
    fn v3_model_configs_uses_iso8601_default() {
        let conn = setup_migrated_db();

        // 插入一条新记录验证 ISO 8601 默认值
        conn.execute(
            "INSERT INTO model_configs (id, provider, label, base_url, model_id, model_name)
             VALUES ('test-id', 'custom', 'test-label', 'https://api.example.com', 'm1', 'Model 1')",
            [],
        )
        .unwrap();

        let created_at: String = conn
            .query_row(
                "SELECT created_at FROM model_configs WHERE id='test-id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // ISO 8601 格式: 2026-06-12T08:30:00.000Z
        assert!(
            created_at.contains('T') && created_at.ends_with('Z'),
            "时间戳应为 ISO 8601 格式，实际: {created_at}"
        );
    }

    // ── V3 迁移: 幂等性与数据保留 ─────────────────────────────────────

    #[test]
    fn v3_migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        // 第二次调用 V3（通过 run_migrations）不应报错
        let result = migrations::run_migrations(&mut conn);
        assert!(result.is_ok(), "V3 迁移重复执行不应出错");
    }

    #[test]
    fn v3_migration_preserves_data_on_rerun() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();

        // 插入一条任务作为测试数据
        conn.execute(
            "INSERT INTO tasks (id, name) VALUES ('test-task', '测试任务')",
            [],
        )
        .unwrap();

        // 重新执行迁移
        migrations::run_migrations(&mut conn).unwrap();

        let name: String = conn
            .query_row(
                "SELECT name FROM tasks WHERE id='test-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "测试任务", "迁移重跑后任务数据应保留");
    }

    // ── CP-29: V3 迁移保留 model_configs 存量数据 ──────────────────────

    #[test]
    fn v3_migration_preserves_model_configs_data() {
        // 手动搭建 V2 状态：创建 app_kv + model_configs（使用 datetime('now') 旧格式）
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_kv (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO app_kv (key, value) VALUES ('schema_version', '2');
            INSERT INTO app_kv (key, value) VALUES ('ipc_status', 'ok');

            CREATE TABLE model_configs (
                id          TEXT PRIMARY KEY,
                provider    TEXT NOT NULL,
                label       TEXT NOT NULL UNIQUE,
                base_url    TEXT NOT NULL,
                model_id    TEXT NOT NULL,
                model_name  TEXT NOT NULL,
                api_key     TEXT NOT NULL,
                is_active   INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_model_configs_active ON model_configs(is_active);

            INSERT INTO model_configs (id, provider, label, base_url, model_id, model_name, api_key, is_active)
            VALUES ('mc-1', 'openai', 'GPT-4', 'https://api.openai.com', 'gpt-4', 'GPT-4', 'sk-test', 1);
            INSERT INTO model_configs (id, provider, label, base_url, model_id, model_name, api_key, is_active)
            VALUES ('mc-2', 'custom', 'Local', 'http://localhost:8080', 'llama3', 'Llama 3', '', 0);",
        )
        .unwrap();

        // 直接执行 V3 迁移 SQL（重建 model_configs 表以统一时间戳格式）
        conn.execute_batch(
            "CREATE TABLE model_configs_new (
                id          TEXT PRIMARY KEY,
                provider    TEXT NOT NULL,
                label       TEXT NOT NULL UNIQUE,
                base_url    TEXT NOT NULL,
                model_id    TEXT NOT NULL,
                model_name  TEXT NOT NULL,
                api_key     TEXT NOT NULL DEFAULT '',
                is_active   INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            INSERT INTO model_configs_new SELECT * FROM model_configs;
            DROP TABLE model_configs;
            ALTER TABLE model_configs_new RENAME TO model_configs;

            CREATE INDEX IF NOT EXISTS idx_model_configs_active ON model_configs(is_active);

            UPDATE app_kv SET value = '3' WHERE key = 'schema_version';",
        )
        .unwrap();

        // 验证数据已保留
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM model_configs",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "V3 迁移后 model_configs 的两条记录应保留");

        // 验证具体数据
        let label: String = conn
            .query_row(
                "SELECT label FROM model_configs WHERE id='mc-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(label, "GPT-4");

        let api_key: String = conn
            .query_row(
                "SELECT api_key FROM model_configs WHERE id='mc-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(api_key, "sk-test");

        let is_active: i32 = conn
            .query_row(
                "SELECT is_active FROM model_configs WHERE id='mc-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(is_active, 1);

        // 验证 V3 后 schema_version 为 '3'
        let version: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "3");
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

    // ── V4 迁移: extractions 表（CP-17）────────────────────────────────

    #[test]
    fn v4_migration_creates_extractions_table() {
        let conn = setup_migrated_db();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='extractions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "extractions 表应该存在");
    }

    #[test]
    fn v4_extractions_table_has_expected_columns() {
        let conn = setup_migrated_db();

        let expected = vec!["id", "task_id", "raw_text", "result_json", "created_at"];
        for col in &expected {
            let count: i32 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('extractions') WHERE name='{}'",
                        col
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "extractions 表应该有 {col} 列");
        }
    }

    #[test]
    fn v4_migration_creates_compound_index() {
        let conn = setup_migrated_db();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_extractions_task_time'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "idx_extractions_task_time 索引应该存在");
    }

    #[test]
    fn v4_migration_sets_schema_version() {
        let conn = setup_migrated_db();

        let version: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key='schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "4", "V4 迁移后 schema_version 应为 '4'");
    }

    #[test]
    fn v4_migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        let result = migrations::run_migrations(&mut conn);
        assert!(result.is_ok(), "V4 迁移重复执行不应出错");
    }

    #[test]
    fn v4_migration_preserves_data_on_rerun() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();

        // 插入一条提取记录
        conn.execute(
            "INSERT INTO extractions (id, task_id, raw_text, result_json, created_at)
             VALUES ('ext-1', 'task-1', 'test text', '{}', '2024-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();

        // 重新执行迁移
        migrations::run_migrations(&mut conn).unwrap();

        let raw_text: String = conn
            .query_row(
                "SELECT raw_text FROM extractions WHERE id='ext-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw_text, "test text", "迁移重跑后提取记录应保留");
    }
}
