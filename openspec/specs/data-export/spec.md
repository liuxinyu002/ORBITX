# Data Export

## Purpose

Define the CSV/XLSX export capability: Rust-side file generation via Tauri command, native OS save dialog, current-page and full-dataset scopes, row count limit, async file writing, and frontend export trigger UI.

## Requirements

### Requirement: export_data Tauri command
The system SHALL expose a Tauri command `export_data(task_id: String, format: String, scope: String, page: Option<i64>, limit: Option<i64>) -> Result<String, String>`. The command SHALL:

1. Validate parameters: `format` ∈ `{"csv", "xlsx"}`, `scope` ∈ `{"current_page", "all"}`
2. When `scope = "current_page"`: require `page >= 1` and `limit` ∈ `[1, 200]`
3. Open a native save dialog via `tauri-plugin-dialog` with default filename `{task_name}_{YYYY-MM-DD}` and extension filter matching the chosen format
4. Query data from `extractions` by `task_id`: `scope=all` uses `LIMIT MAX_EXPORT_ROWS` (50000), `scope=current_page` uses the provided page/limit
5. Flatten `result_json` fields and map Schema field names as CSV/XLSX headers
6. Generate the file via `csv::Writer` (CSV) or `rust_xlsxwriter::Workbook` (XLSX) inside `tauri::async_runtime::spawn_blocking`
7. Return the saved file path on success

The command SHALL emit log events at entry (`log::info!("[export] 导出开始 task_id={task_id} format={format} scope={scope}")`) and exit (`log::info!("[export] 导出完成 path={path} rows={count}")`).

#### Scenario: Export current page as CSV
- **WHEN** `export_data` is called with `format="csv"`, `scope="current_page"`, `page=1`, `limit=50`
- **THEN** it SHALL query page 1 with 50 rows, open a save dialog for `.csv`, and write a CSV file with Schema headers

#### Scenario: Export all data as XLSX
- **WHEN** `export_data` is called with `format="xlsx"`, `scope="all"`
- **THEN** it SHALL query all rows (up to 50000), open a save dialog for `.xlsx`, and write an XLSX file

#### Scenario: Invalid format parameter
- **WHEN** `export_data` is called with `format="pdf"`
- **THEN** the command SHALL return `Err` with `AppError::InvalidInput`

#### Scenario: Invalid scope parameter
- **WHEN** `export_data` is called with `scope="selected"`
- **THEN** the command SHALL return `Err` with `AppError::InvalidInput`

#### Scenario: current_page scope missing page parameter
- **WHEN** `export_data` is called with `scope="current_page"` but `page` is `None`
- **THEN** the command SHALL return `Err` with `AppError::InvalidInput`

### Requirement: MAX_EXPORT_ROWS limit
The system SHALL enforce a hard limit of `MAX_EXPORT_ROWS = 50000` for `scope = "all"` queries. When the query count exceeds this limit, the command SHALL return `AppError::ExportTooLarge` instead of proceeding with the export.

#### Scenario: Export within limit
- **WHEN** a task has 30000 extraction records and `scope="all"` export is requested
- **THEN** all 30000 rows SHALL be exported

#### Scenario: Export exceeds limit
- **WHEN** a task has 60000 extraction records and `scope="all"` export is requested
- **THEN** the command SHALL return `AppError::ExportTooLarge`
- **AND** the frontend SHALL display a Toast "数据量过大，请分批导出或缩小范围"

### Requirement: JSON flattening and schema header mapping
When generating export files, the system SHALL flatten each row's `result_json` (parsed as a JSON object) into individual columns. Column headers SHALL be derived from the current task's Schema `fields[].name`. When a field is missing from a row's `result_json`, an empty string SHALL be written for that cell.

#### Scenario: Field-missing cell gets empty string
- **WHEN** a row's `result_json` is `{"name": "Alice"}` but the Schema defines fields `["name", "email"]`
- **THEN** the "name" column SHALL contain "Alice" and the "email" column SHALL be empty

#### Scenario: Headers match current schema
- **WHEN** the task Schema is updated after some extractions were already stored
- **THEN** export headers SHALL reflect the current Schema, not the Schema at the time each row was extracted

### Requirement: Async file writing
CSV and XLSX file generation SHALL execute inside `tauri::async_runtime::spawn_blocking` to avoid blocking the Tauri event loop.

#### Scenario: File write does not block UI
- **WHEN** a large export (e.g., 50000 rows) is in progress
- **THEN** the Tauri event loop SHALL remain responsive (window does not freeze)

### Requirement: IO error handling
File system errors (disk full, permission denied, path not writable) SHALL be caught and returned as `AppError` with a descriptive Chinese error message. The error SHALL be surfaced to the user via frontend Toast.

#### Scenario: Disk full during export
- **WHEN** the target disk has insufficient space
- **THEN** the command SHALL return an `AppError` with a descriptive message
- **AND** the frontend SHALL display a failure Toast

### Requirement: Frontend export UI
The DataBrowser toolbar SHALL render a single "导出" dropdown button (`DropdownMenu`). Expanding the dropdown SHALL reveal 4 options:

1. CSV（当前页）— `invoke('export_data', { taskId, format: 'csv', scope: 'current_page', page, limit })`
2. CSV（全部）— `invoke('export_data', { taskId, format: 'csv', scope: 'all' })`
3. XLSX（当前页）— `invoke('export_data', { taskId, format: 'xlsx', scope: 'current_page', page, limit })`
4. XLSX（全部）— `invoke('export_data', { taskId, format: 'xlsx', scope: 'all' })`

Each invocation SHALL log via `log("info", "data-browser", "发起导出请求 format={format} scope={scope}")`. Success and failure SHALL both trigger a Toast and log via `log("info"/"error", "data-browser", ...)`.

#### Scenario: Export dropdown shows 4 options
- **WHEN** the data grid has data rows
- **THEN** clicking the "导出" button SHALL show a dropdown with exactly 4 menu items as specified

#### Scenario: Export success Toast
- **WHEN** the export command returns `Ok(path)`
- **THEN** a success Toast with the file path SHALL be displayed

#### Scenario: Export failure Toast
- **WHEN** the export command returns `Err(message)`
- **THEN** a failure Toast with the error reason SHALL be displayed
