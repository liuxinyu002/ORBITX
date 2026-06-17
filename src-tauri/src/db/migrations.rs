use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// 返回 Phase-1 的数据库迁移。
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // V1: 创建 app_kv 表并插入种子数据
        M::up(
            "CREATE TABLE app_kv (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            INSERT INTO app_kv (key, value) VALUES ('schema_version', '1');
            INSERT INTO app_kv (key, value) VALUES ('ipc_status', 'ok');",
        ),
        // V2: 创建 model_configs 表（rusqlite_migration 自动包裹事务）
        M::up(
            "CREATE TABLE model_configs (
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
            UPDATE app_kv SET value = '2' WHERE key = 'schema_version';",
        ),
        // V3: 创建 tasks 表 + 统一 model_configs 时间戳为 ISO 8601
        M::up(
            "CREATE TABLE tasks (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                schema      TEXT,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            -- 统一 model_configs 时间戳为 ISO 8601（重建表以修改 DEFAULT）
            CREATE TABLE model_configs_new (
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
        ),
        // V4: 创建 extractions 表
        M::up(
            "CREATE TABLE extractions (
                id          TEXT PRIMARY KEY,
                task_id     TEXT NOT NULL,
                raw_text    TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_extractions_task_time ON extractions(task_id, created_at);
            UPDATE app_kv SET value = '4' WHERE key = 'schema_version';",
        ),
    ])
}

/// 在连接上执行迁移并设置 PRAGMA。
pub fn run_migrations(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    migrations().to_latest(conn)?;

    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    Ok(())
}
