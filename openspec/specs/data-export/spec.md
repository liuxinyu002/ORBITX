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

### Requirement: Array result_json export flattening
When generating export files, the system SHALL detect whether a row's `result_json` parses as a JSON array. If it is an array, the system SHALL write one export row per array element instead of one export row per database row.

- Each element that is a JSON object SHALL be flattened against Schema field names as column headers
- Elements that are not objects SHALL result in a row with all columns empty
- An empty array `[]` SHALL produce zero export data rows for that database row
- Non-array `result_json` SHALL continue to produce exactly one export row (existing behavior)

#### Scenario: Array result_json flattened to multiple rows in CSV
- **WHEN** a database row has `result_json = [{"name":"张三","email":"a@b.com"}, {"name":"李四","email":"c@d.com"}]`
- **AND** the Schema defines fields `["name", "email"]`
- **THEN** the CSV SHALL contain 2 data rows: one for 张三 and one for 李四

#### Scenario: Array element missing a field gets empty cell
- **WHEN** a database row has `result_json = [{"name":"张三"}, {"name":"李四","email":"c@d.com"}]`
- **AND** the Schema defines fields `["name", "email"]`
- **THEN** the first export row SHALL have "张三" for name and empty string for email

#### Scenario: Empty array produces no data rows
- **WHEN** a database row has `result_json = []`
- **AND** there are other database rows with object `result_json`
- **THEN** the empty array row SHALL contribute zero rows; other rows SHALL export normally

#### Scenario: Non-object array elements produce empty rows
- **WHEN** a database row has `result_json = [1, 2, 3]`
- **AND** the Schema defines fields `["name", "email"]`
- **THEN** 3 rows SHALL be written, each with all columns empty

#### Scenario: Object result_json exports as before
- **WHEN** a database row has `result_json = {"name":"张三"}`
- **THEN** exactly 1 export row SHALL be written (no behavioral change)

### Requirement: JSON flattening and schema header mapping
When generating export files, the system SHALL process each database row's `result_json` as follows:

1. Parse `result_json` as a JSON value
2. If the value is a JSON object: flatten its fields against the Schema's `fields[].name` headers, writing 1 export row. When a field is missing from the object, write an empty string for that cell.
3. If the value is a JSON array: iterate over each element, writing 1 export row per element. Each object element SHALL be flattened against Schema headers. Non-object elements SHALL produce rows with all cells empty. An empty array SHALL produce zero rows.
4. Column headers SHALL be derived from the current task's Schema `fields[].name`.

#### Scenario: Field-missing cell gets empty string
- **WHEN** a row's `result_json` is `{"name": "Alice"}` but the Schema defines fields `["name", "email"]`
- **THEN** the "name" column SHALL contain "Alice" and the "email" column SHALL be empty

#### Scenario: Headers match current schema
- **WHEN** the task Schema is updated after some extractions were already stored
- **THEN** export headers SHALL reflect the current Schema, not the Schema at the time each row was extracted

#### Scenario: Array result_json flattened to multiple export rows
- **WHEN** a row's `result_json` is a JSON array of 3 objects
- **THEN** 3 export rows SHALL be written, each object flattened against the Schema headers

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
