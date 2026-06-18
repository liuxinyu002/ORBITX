## ADDED Requirements

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

## MODIFIED Requirements

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
