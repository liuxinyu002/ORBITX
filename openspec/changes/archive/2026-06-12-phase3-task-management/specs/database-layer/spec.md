## ADDED Requirements

### Requirement: Phase-3 migration V3 (tasks table)
The V3 migration SHALL create the `tasks` table and update `model_configs` timestamp defaults to ISO 8601 format.

Migration V3 SQL:

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schema TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

UPDATE app_kv SET value = '3' WHERE key = 'schema_version';
```

Additionally, the V3 migration SHALL modify the `model_configs` table to use ISO 8601 timestamp defaults. In SQLite, this requires recreating the table:

```sql
-- 统一 model_configs 时间戳为 ISO 8601
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
```

#### Scenario: V3 migration creates tasks table
- **WHEN** V3 migration executes
- **THEN** `tasks` table exists with id, name, description, schema, created_at, updated_at columns
- **THEN** `schema_version` in app_kv is updated to `'3'`

#### Scenario: V3 migration fixes model_configs timestamp defaults
- **WHEN** V3 migration executes
- **THEN** `model_configs` table has `created_at` and `updated_at` defaults using `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
- **THEN** existing data in `model_configs` is preserved (timestamps NOT converted — old rows keep `datetime('now')` format)

#### Scenario: V3 migration is idempotent
- **WHEN** V3 migration runs on a database that already has `schema_version = '3'`
- **THEN** no error occurs
- **THEN** existing data is preserved

## MODIFIED Requirements

### Requirement: Embedded SQL migrations via rusqlite_migration
Database schema migrations SHALL be defined using the `rusqlite_migration` crate. Each Phase SHALL contribute one or more migration closures (`M::up()`). Migrations MUST be executed synchronously in the Tauri setup hook before any window is created.

#### Scenario: Phase-1 migration V1 executed on fresh database
- **WHEN** the app starts with no existing database
- **THEN** the `app_kv` table is created
- **THEN** seed rows `('schema_version', '1')` and `('ipc_status', 'ok')` are inserted

#### Scenario: Phase-2 migration V2 executed on database with V1
- **WHEN** the app starts with a database that has `schema_version` = `'1'`
- **THEN** the migration V2 is executed **within a single SQLite transaction** (`BEGIN` / `COMMIT`)
- **THEN** the `model_configs` table is created with a `UNIQUE(label)` constraint
- **THEN** `idx_model_configs_active` index is created
- **THEN** seed row `('schema_version', '2')` is updated in app_kv
- **THEN** if any statement fails, the entire migration is rolled back and the database schema remains unchanged

#### Scenario: Phase-3 migration V3 executed on database with V2
- **WHEN** the app starts with a database that has `schema_version` = `'2'`
- **THEN** the migration V3 is executed
- **THEN** the `tasks` table is created
- **THEN** `model_configs` timestamp defaults are updated to ISO 8601 format
- **THEN** `schema_version` is updated to `'3'`

#### Scenario: Subsequent launches skip completed migrations
- **WHEN** the app starts with a database that already has `schema_version` = `'3'`
- **THEN** no migration SQL is re-executed
- **THEN** existing data is preserved

### Requirement: delete_kv function
The `db` module SHALL expose a `delete_kv` function for removing `app_kv` entries:

```rust
pub fn delete_kv(conn: &Connection, key: &str) -> Result<(), AppError>
```

- 行为：`DELETE FROM app_kv WHERE key = ?1`
- 如果 key 不存在，静默成功（no-op），不返回错误

#### Scenario: delete_kv removes existing key
- **WHEN** calling `delete_kv(conn, "active_task_id")` and the key exists
- **THEN** the row is deleted
- **THEN** subsequent `get_kv("active_task_id")` returns `NotFound`

#### Scenario: delete_kv on nonexistent key silently succeeds
- **WHEN** calling `delete_kv(conn, "nonexistent")`
- **THEN** the call succeeds (no error)

### Requirement: set_kv uses ISO 8601 timestamp
The `set_kv` function SHALL use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for the `updated_at` column, replacing the current `datetime('now')` format.

#### Scenario: set_kv writes ISO 8601 timestamp
- **WHEN** `set_kv` inserts or updates a row
- **THEN** `updated_at` contains an ISO 8601 UTC timestamp
