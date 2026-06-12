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
    ])
}

/// 在连接上执行迁移并设置 PRAGMA。
pub fn run_migrations(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    migrations().to_latest(conn)?;

    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    Ok(())
}
