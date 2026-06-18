# Extraction Results

## Purpose

Extend the extraction persistence layer with paginated queries, single-record deletion, real-time event emission on insert, and a frontend data-access layer for Phase 6 data grid consumption.

## ADDED Requirements

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
