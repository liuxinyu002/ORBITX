# Extraction Results

## Purpose

Define the persistence model for AI extraction results: database schema, insert command, and the contract for Phase 6 consumption.

## ADDED Requirements

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

#### Scenario: result_json contains only business data
- **WHEN** an extraction record is inserted
- **THEN** `result_json` SHALL contain the pure `data` object only, with `is_relevant` and `reason` stripped

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
