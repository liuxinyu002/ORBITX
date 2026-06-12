## MODIFIED Requirements

### Requirement: Five-table ER model
The data model SHALL consist of exactly 4 tables:

1. **`app_kv`** — Application key-value store (Phase-1 physical)
2. **`model_configs`** — AI model provider configurations (Phase-2)
3. **`tasks`** — Data extraction tasks with embedded schema JSON (Phase-3)
4. **`extracted_data`** — Extracted structured data records (Phase-5)

The `schema_fields` table is REMOVED. Schema field definitions are stored as JSON TEXT in `tasks.schema`. `TaskSimple` (returned by `list_tasks`) includes `updated_at` for sort/display purposes.

#### Scenario: All 4 tables defined with complete specifications
- **WHEN** reading SCHEMA.md
- **THEN** each table has: column names, types, constraints, business rules
- **THEN** `schema_fields` table does not exist

### Requirement: tasks table structure
The `tasks` table SHALL use the following structure:

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schema TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Key changes from the original design:
- **REMOVED** `is_active INTEGER` column — activation state moved to `app_kv.active_task_id`
- **ADDED** `schema TEXT` column — stores `TaskSchema` JSON (`{ "fields": [...] }`), NULL when not yet defined
- **CHANGED** timestamp defaults from `datetime('now')` to `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (ISO 8601)

#### Scenario: tasks table uses ISO 8601 timestamps
- **WHEN** a new task is created via INSERT without explicit timestamps
- **THEN** `created_at` and `updated_at` contain ISO 8601 format timestamps (e.g., `2026-06-12T08:30:00.000Z`)

#### Scenario: tasks table has no is_active column
- **WHEN** querying `PRAGMA table_info(tasks)` after V3 migration
- **THEN** no `is_active` column exists

### Requirement: ISO 8601 UTC timestamps
All `created_at` and `updated_at` columns SHALL use ISO 8601 UTC format (`YYYY-MM-DDTHH:MM:SS.sssZ`). SQLite defaults SHALL use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`. Rust-side generation SHALL use `chrono::Utc::now().to_rfc3339()`.

#### Scenario: Timestamp stored in ISO 8601 UTC
- **WHEN** a record is created
- **THEN** `created_at` contains an ISO 8601 UTC timestamp with millisecond precision and `Z` suffix

### Requirement: Foreign key cascade deletes
The following foreign key relationships SHALL use `ON DELETE CASCADE`:
- `extracted_data.task_id` → `tasks.id`

This ensures that deleting a task automatically removes its extracted data records. Schema fields are embedded in `tasks.schema` and are automatically removed with the task row itself.

#### Scenario: Delete task cascades to extracted_data
- **WHEN** a task is deleted
- **THEN** all `extracted_data` rows referencing that task are automatically deleted
