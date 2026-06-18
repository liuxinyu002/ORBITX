# Extraction Results

## Purpose

Define the persistence model for AI extraction results: database schema, insert command, and the contract for Phase 6 consumption.

## Requirements

### Requirement: Extractions table
The system SHALL create an `extractions` table via database migration V4 with the following schema:

```sql
CREATE TABLE extractions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_extractions_task_time ON extractions(task_id, created_at);
```

#### Scenario: Table created on migration
- **WHEN** database migration V4 runs
- **THEN** the `extractions` table SHALL exist with all columns and the compound index

#### Scenario: result_json contains only business data as array
- **WHEN** an extraction record is inserted
- **THEN** `result_json` SHALL contain a JSON array of extracted data objects, with `is_relevant` and `reason` stripped. Single-record extractions SHALL still use a single-element array.

### Requirement: Insert extraction command
The system SHALL expose a Tauri command `insert_extraction` accepting `task_id: String`, `raw_text: String`, and `result_json: String`. Before writing to the database, it SHALL validate `result_json` via `serde_json::from_str::<Value>()` and return `Err` if the string is not valid JSON. It SHALL generate a unique ID, set `created_at` to the current ISO 8601 timestamp, insert the row, and return `Result<String, String>` where the success value is the new record ID.

#### Scenario: Successful insert returns record ID
- **WHEN** `insert_extraction` is invoked with valid parameters including valid JSON
- **THEN** the function SHALL return `Ok(record_id)` where `record_id` is the generated unique identifier

#### Scenario: Invalid result_json rejected
- **WHEN** `insert_extraction` is invoked with `result_json: "not-valid-json"`
- **THEN** the function SHALL return `Err("result_json 不是合法 JSON: ...")` and no row SHALL be written

#### Scenario: Insert failure returns error
- **WHEN** the database insert fails (e.g., constraint violation)
- **THEN** the function SHALL return `Err(message)` with a descriptive error string

### Requirement: Extraction model in Rust
The system SHALL define a Rust struct `Extraction` with fields matching the database schema, and an `ExtractionInput` struct for insert parameters (excluding `id` and `created_at` which are generated server-side).

#### Scenario: Extraction struct maps to table columns
- **WHEN** the `Extraction` struct is serialized
- **THEN** its fields SHALL match the `extractions` table columns

### Requirement: ExtractionRow model
The system SHALL define a Rust struct `ExtractionRow` with fields `id: String`, `task_id: String`, `raw_text: String`, `result_json: String`, and `created_at: String`, mapping to the `extractions` table columns.

#### Scenario: ExtractionRow maps to table columns
- **WHEN** `ExtractionRow` is queried from the database
- **THEN** its fields SHALL match `id`, `task_id`, `raw_text`, `result_json`, `created_at`

### Requirement: ExtractionListResponse model
The system SHALL define a Rust struct `ExtractionListResponse` with fields `rows: Vec<ExtractionRow>` and `total: i64`, representing a paginated query result.

#### Scenario: Response carries rows and total count
- **WHEN** `list_extractions` returns
- **THEN** `rows` SHALL contain the current page of records and `total` SHALL be the total matching count across all pages

### Requirement: list_extractions command
The system SHALL expose a Tauri command `list_extractions(task_id: String, page: i64, limit: i64) -> Result<ExtractionListResponse, String>`. It SHALL query the `extractions` table with `WHERE task_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?` for the data rows and a separate `SELECT COUNT(*)` for the total, returning `{ rows, total }`.

The command SHALL validate: `page >= 1`, `limit` in range `[1, 200]`. Invalid input SHALL return `AppError::InvalidInput`.

The command SHALL emit log events at entry (`log::info!("[extraction] 列出提取数据 task_id={task_id} page={page} limit={limit}")`) and exit (`log::info!("[extraction] 列出完成 total={total} rows={rows_len}")`).

#### Scenario: Paginated query returns data
- **WHEN** `list_extractions` is called with `task_id="t1"`, `page=1`, `limit=50`
- **AND** the task has 120 extraction records
- **THEN** `rows` SHALL contain 50 records ordered by `created_at DESC`
- **AND** `total` SHALL be 120

#### Scenario: Empty task query
- **WHEN** `list_extractions` is called for a task with no extraction records
- **THEN** `rows` SHALL be an empty array and `total` SHALL be 0

#### Scenario: Page exceeds available data
- **WHEN** `list_extractions` is called with `page=5`, `limit=50` for a task with 120 records
- **THEN** `rows` SHALL contain 20 records (the remainder) and `total` SHALL still be 120

#### Scenario: Invalid page parameter
- **WHEN** `list_extractions` is called with `page=0`
- **THEN** the command SHALL return `Err` with an `AppError::InvalidInput` message

#### Scenario: Invalid limit parameter
- **WHEN** `list_extractions` is called with `limit=201`
- **THEN** the command SHALL return `Err` with an `AppError::InvalidInput` message

### Requirement: delete_extraction command
The system SHALL expose a Tauri command `delete_extraction(id: String) -> Result<(), String>`. It SHALL delete the record matching the given `id` from the `extractions` table.

The command SHALL validate that `id` is non-empty. It SHALL emit a log event (`log::info!("[extraction] 删除记录 id={id}")`).

Deleting a non-existent record SHALL succeed silently (no error).

#### Scenario: Delete existing record
- **WHEN** `delete_extraction` is called with a valid existing `id`
- **THEN** the record SHALL be removed from the database and `Ok(())` returned

#### Scenario: Delete non-existent record
- **WHEN** `delete_extraction` is called with an `id` that does not exist
- **THEN** the command SHALL return `Ok(())` (idempotent)

#### Scenario: Delete with empty id
- **WHEN** `delete_extraction` is called with an empty string `id`
- **THEN** the command SHALL return `Err` with an `AppError::InvalidInput` message

### Requirement: extraction-completed event emission
After `insert_extraction` successfully writes a row, the system SHALL emit a Tauri event named `"extraction-completed"` with the full `Extraction` struct as payload (including `id`, `task_id`, `raw_text`, `result_json`, `created_at`).

The system SHALL log the emission before firing the event: `log::info!("[extraction] 发射提取完成事件 task_id={task_id}")`.

#### Scenario: Event emitted on insert
- **WHEN** `insert_extraction` successfully inserts a row
- **THEN** a `"extraction-completed"` event SHALL be emitted to all listeners
- **AND** the payload SHALL contain the complete `Extraction` struct

### Requirement: Frontend extraction API layer
The system SHALL provide a frontend module (`src/lib/extraction-api.ts`) exporting:

- `fetchExtractions(taskId: string, page: number, limit: number): Promise<{ rows: Extraction[]; total: number }>` — invokes `list_extractions` Tauri command
- `removeExtraction(id: string): Promise<void>` — invokes `delete_extraction` Tauri command
- `fetchExtractionCount(taskId: string): Promise<number>` — convenience wrapper returning only the total count

Each function SHALL bridge log events through the `log()` function:
- `fetchExtractions`: log call and result (success row count / error)
- `removeExtraction`: log success with id / error with reason

#### Scenario: fetchExtractions bridges to Tauri command
- **WHEN** `fetchExtractions("t1", 1, 50)` is called
- **THEN** it SHALL invoke the `list_extractions` Tauri command with matching parameters
- **AND** log the call and result via `log("info", "data-browser", ...)`

#### Scenario: removeExtraction bridges to Tauri command
- **WHEN** `removeExtraction("ext-123")` is called
- **THEN** it SHALL invoke the `delete_extraction` Tauri command
- **AND** log success or failure via `log()`

### Requirement: PAGE_SIZE constant
The system SHALL define `PAGE_SIZE = 50` in `src/lib/constants.ts`. The data grid SHALL reference this constant for the default page size. The constant MAY be overridden by an environment variable in a future iteration.

#### Scenario: Constant referenced by data grid
- **WHEN** the DataBrowser component initializes its TanStack Table
- **THEN** the page size SHALL default to `PAGE_SIZE` (50)

### Requirement: Array result_json cell rendering
When `result_json` is a JSON array, the DataBrowser cell renderer SHALL display a summary badge `[包含 N 项数据]` instead of rendering `—` for each field. The summary SHALL use the `text-muted-foreground` token and display the count of array elements.

#### Scenario: Array result_json shows summary badge
- **WHEN** a row's `result_json` is `[{"name":"A"},{"name":"B"},{"name":"C"}]`
- **THEN** each business field cell SHALL display `[包含 3 项数据]` instead of `—`

#### Scenario: Object result_json renders normally
- **WHEN** a row's `result_json` is `{"name":"张三","email":"a@b.com"}`
- **THEN** each business field cell SHALL display the field value as before (no behavioral change)

### Requirement: Array result_json expand panel drill-down
When `result_json` is a JSON array and the user expands the row, the expand panel SHALL render each array element as a numbered section. Each section SHALL display a `第 N 项` label followed by a `<dl>` key-value grid of the element's fields. Numbered sections SHALL be separated by a thin border.

#### Scenario: Array drill-down in expand panel
- **WHEN** a row with `result_json = [{"name":"张三","email":"a@b.com"}, {"name":"李四","email":"c@d.com"}]` is expanded
- **THEN** the expand panel SHALL show "第 1 项" with name/email key-value pairs followed by "第 2 项" with its key-value pairs

#### Scenario: Object result_json expand panel unchanged
- **WHEN** a row with object `result_json` is expanded
- **THEN** the expand panel SHALL render the existing `<dl>` key-value grid (no behavioral change)

### Requirement: Recursive field value rendering without pre blocks
The `renderFieldValue` function SHALL recursively format all JavaScript value types into inline readable strings without using `<pre>` JSON blocks:

- null/undefined → italic `—` with `text-muted-foreground/50`
- string/number/boolean → `String(value)` directly
- Array → comma-joined string of each element (recursively formatted)
- Object (non-array) → comma-separated `key: value` pairs (values recursively formatted)

#### Scenario: Nested object renders as comma-separated key-value
- **WHEN** a field value is `{"city":"NY","zip":"10001"}`
- **THEN** it SHALL render as `city: NY, zip: 10001`

#### Scenario: Nested array renders as comma-separated list
- **WHEN** a field value is `["tag1","tag2","tag3"]`
- **THEN** it SHALL render as `tag1, tag2, tag3`

#### Scenario: Deeply nested structure renders inline
- **WHEN** a field value is `{"tags":["a","b"],"addr":{"city":"NY"}}`
- **THEN** it SHALL render as `tags: a, b, addr: city: NY`
