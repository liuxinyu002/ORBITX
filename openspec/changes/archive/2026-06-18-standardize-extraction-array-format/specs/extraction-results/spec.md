## MODIFIED Requirements

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
