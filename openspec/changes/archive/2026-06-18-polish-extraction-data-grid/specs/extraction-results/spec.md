## ADDED Requirements

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

## MODIFIED Requirements

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
