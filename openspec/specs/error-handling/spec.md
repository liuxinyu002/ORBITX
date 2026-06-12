# Error Handling

## Purpose

Define the Rust error type architecture, serializable error DTOs for frontend consumption, type-safe error conversion, and the frontend discriminated union pattern for handling errors.

## Requirements

### Requirement: AppError enum with thiserror
The Rust crate SHALL define an `AppError` enum using `thiserror::Error` derive macro, covering at minimum the following variants:

- `Database(#[from] rusqlite::Error)` — database operation failures
- `NotFound { source_id: String }` — resource not found
- `InvalidState(String)` — invalid runtime state (e.g., poisoned mutex)
- `Io(#[from] std::io::Error)` — filesystem IO errors
- `DuplicateModelLabel(String)` — duplicate model configuration label

#### Scenario: Database error propagated as AppError
- **WHEN** a `rusqlite::Error` occurs in a DAO function
- **THEN** it is automatically converted to `AppError::Database` via `From` impl

#### Scenario: Invalid state error returned
- **WHEN** a Mutex lock is poisoned
- **THEN** an `AppError::InvalidState("DB mutex lock poisoned")` is returned

#### Scenario: Duplicate model label error
- **WHEN** saving a model config with a label that already exists
- **THEN** an `AppError::DuplicateModelLabel("label 'xxx' already exists")` is returned

### Requirement: SerializableError DTO (tagged union)
The Rust crate SHALL define a `SerializableError` enum that serializes as a tagged union:

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum SerializableError {
    Database(String),
    NotFound { source_id: String },
    InvalidState(String),
    Network(String),
    Duplicate(String),
}
```

The JSON representation SHALL be `{ "type": "<variant>", "message": "..." }`.

#### Scenario: SerializableError JSON format
- **WHEN** a `SerializableError::Database("table not found")` is serialized
- **THEN** the JSON is `{"type":"Database","message":"table not found"}`

#### Scenario: NotFound variant includes source_id
- **WHEN** a `SerializableError::NotFound { source_id: "task-123" }` is serialized
- **THEN** the JSON is `{"type":"NotFound","message":"{\"source_id\":\"task-123\"}"}`

### Requirement: From<AppError> for SerializableError conversion
Every `AppError` variant SHALL be convertible to `SerializableError` via a `From<AppError> for SerializableError` implementation. The conversion SHALL preserve error semantics:

| `AppError` variant | `SerializableError` variant | Notes |
|---|---|---|
| `Database(e)` | `Database(e.to_string())` | Direct mapping |
| `NotFound { source_id }` | `NotFound { source_id }` | Preserves context about which resource |
| `InvalidState(msg)` | `InvalidState(msg)` | Direct mapping |
| `Io(e)` | `InvalidState(format!("IO error: {e}"))` | IO errors (file ops, config read) are runtime state issues, not database failures |
| `DuplicateModelLabel(msg)` | `Duplicate(msg)` | Duplicate label conflict |

#### Scenario: AppError::Database converts to SerializableError::Database
- **WHEN** `AppError::Database(rusqlite_error)` is converted via `.into()`
- **THEN** the result is `SerializableError::Database(rusqlite_error.to_string())`

#### Scenario: AppError::Io converts to SerializableError::InvalidState
- **WHEN** `AppError::Io(io_error)` is converted via `.into()`
- **THEN** the result is `SerializableError::InvalidState("IO error: {details}")`
- **THEN** the error is NOT misclassified as a database error

#### Scenario: AppError::DuplicateModelLabel converts to SerializableError::Duplicate
- **WHEN** `AppError::DuplicateModelLabel("label 'xxx' already exists")` is converted via `.into()`
- **THEN** the result is `SerializableError::Duplicate("label 'xxx' already exists")`

#### Scenario: Duplicate variant
- **WHEN** a `SerializableError::Duplicate("label 'My Model' already exists")` is serialized
- **THEN** the JSON is `{"type":"Duplicate","message":"label 'My Model' already exists"}`

### Requirement: CommandResult<T> type alias
All Tauri Commands SHALL return `CommandResult<T>` where `CommandResult<T> = Result<T, SerializableError>`. The use of bare `Result<T, String>` or manual `.map_err(|e| e.to_string())` in any Tauri Command is PROHIBITED.

#### Scenario: Command uses CommandResult type alias
- **WHEN** reviewing any Tauri Command signature
- **THEN** the return type is `CommandResult<SomeType>`
- **THEN** no bare `Result<T, String>` or manual string error conversion exists

### Requirement: TypeScript discriminated union consumption
The frontend SHALL consume `CommandResult<T>` responses by discriminating on the `type` field of the error object:

```typescript
type SerializableError =
  | { type: "Database"; message: string }
  | { type: "NotFound"; message: { source_id: string } }
  | { type: "InvalidState"; message: string }
  | { type: "Network"; message: string }
  | { type: "Duplicate"; message: string };
```

#### Scenario: Frontend handles Database error
- **WHEN** a Tauri Command returns a Database error
- **THEN** the frontend displays a toast with the error message
- **THEN** the error is logged for debugging

#### Scenario: Frontend handles NotFound error
- **WHEN** a Tauri Command returns a NotFound error
- **THEN** the frontend displays context about which resource was not found
