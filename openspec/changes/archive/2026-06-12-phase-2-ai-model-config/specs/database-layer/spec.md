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

#### Scenario: Subsequent launches skip completed migrations
- **WHEN** the app starts with a database that already has `schema_version` = `'2'`
- **THEN** no migration SQL is re-executed
- **THEN** existing data is preserved
