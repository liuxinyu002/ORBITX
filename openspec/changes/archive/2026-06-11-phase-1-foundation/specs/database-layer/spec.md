## ADDED Requirements

### Requirement: SQLite database with WAL mode and foreign key enforcement
The Rust backend SHALL initialize a SQLite database at the Tauri app data directory (`$APP_DATA_DIR/orbitx.db`). The connection MUST be configured with WAL (Write-Ahead Logging) journal mode and foreign key enforcement enabled immediately after migration.

The following PRAGMAs SHALL be set on every new connection:
- `PRAGMA journal_mode=WAL` — enable concurrent reads
- `PRAGMA foreign_keys=ON` — enforce FK constraints (SQLite defaults to OFF; this is per-connection)

#### Scenario: Database file created on first launch
- **WHEN** the app launches for the first time
- **THEN** a file `orbitx.db` is created in the Tauri app data directory
- **THEN** the file is a valid SQLite database

#### Scenario: WAL mode active
- **WHEN** the database connection is established
- **THEN** `PRAGMA journal_mode` returns `wal`

#### Scenario: Foreign key enforcement active
- **WHEN** the database connection is established
- **THEN** `PRAGMA foreign_keys` returns `1` (ON)
- **THEN** any attempt to violate a FK constraint results in a SQLite error

### Requirement: Embedded SQL migrations via rusqlite_migration
Database schema migrations SHALL be defined using the `rusqlite_migration` crate. Each Phase SHALL contribute one or more migration closures (`M::up()`). Migrations MUST be executed synchronously in the Tauri setup hook before any window is created.

#### Scenario: Phase-1 migration V1 executed on fresh database
- **WHEN** the app starts with no existing database
- **THEN** the `app_kv` table is created
- **THEN** seed rows `('schema_version', '1')` and `('ipc_status', 'ok')` are inserted

#### Scenario: Subsequent launches skip completed migrations
- **WHEN** the app starts with a database that already has `schema_version` = `'1'`
- **THEN** no migration SQL is re-executed
- **THEN** existing data is preserved

### Requirement: Database connection via Tauri Managed State
The SQLite connection SHALL be wrapped in `std::sync::Mutex<rusqlite::Connection>` and stored in a struct (`DbState` or `AppState`) that is registered via `app.manage()`. All Tauri Commands SHALL access the database through `State<'_, DbState>`.

#### Scenario: Command accesses database through managed state
- **WHEN** a Tauri Command is invoked
- **THEN** it receives `State<'_, DbState>` as a parameter
- **THEN** it locks the Mutex to obtain a `&Connection` reference

#### Scenario: Mutex poisoned error handled
- **WHEN** the Mutex lock is poisoned (due to thread panic while holding lock)
- **THEN** the Command returns `Err(SerializableError::InvalidState("DB mutex lock poisoned"))` instead of panicking

### Requirement: app_kv table (Phase-1 physical table)
The database SHALL contain exactly one physical table in Phase-1:

```sql
CREATE TABLE app_kv (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Scenario: Read existing key-value pair
- **WHEN** querying `SELECT value FROM app_kv WHERE key = 'ipc_status'`
- **THEN** the result is `'ok'`

#### Scenario: Write new key-value pair
- **WHEN** inserting a new row into app_kv
- **THEN** the row is persisted and retrievable after app restart

### Requirement: Full ER diagram frozen in SCHEMA.md
The file `docs/SCHEMA.md` SHALL document the complete data model across all 7 Phases, including all 5 tables (`app_kv`, `model_configs`, `tasks`, `schema_fields`, `extracted_data`), their columns, types, constraints, foreign keys, indexes, and the Phase-by-Phase migration plan. This document is authoritative — all future migrations MUST follow the definitions in SCHEMA.md.

#### Scenario: SCHEMA.md matches implementation
- **WHEN** a Phase-N migration is executed
- **THEN** the resulting table structure matches the definition in SCHEMA.md exactly
