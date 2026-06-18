## MODIFIED Requirements

### Requirement: Extraction prompt assembly
The system SHALL assemble extraction prompts by injecting the task's Schema fields as JSON directly into the system prompt template. The prompt SHALL instruct the model to output a JSON object with `is_relevant` (boolean) and `reason` (string|null) appearing before the nested `data` field, which SHALL be a JSON array of objects — even for single-record extractions, `data` SHALL be a single-element array.

The system SHALL use `Temperature: 0` for all extraction requests.

The system SHALL reuse the existing `parseAIResponse()` function from `src/agent/extractor.ts` to parse model responses from both normal and force modes. The return type of `parseAIResponse()` SHALL be generalized to `Record<string, unknown> | unknown[] | null` to accommodate both object and array responses.

#### Scenario: Normal extraction prompt includes relevance preamble
- **WHEN** `runExtraction` is called with `force: false` or `force: undefined`
- **THEN** the system prompt SHALL instruct the model to first output `is_relevant` and `reason`, then output `data` as an array of objects matching the task Schema

#### Scenario: Schema injected as JSON string
- **WHEN** assembling a prompt for a task with fields `[{name: "email", type: "String", required: true, description: "用户邮箱"}]`
- **THEN** the prompt SHALL contain the JSON-serialized fields array as a verbatim JSON block

#### Scenario: Schema generation logic unavailable for extraction
- **WHEN** assembling an extraction prompt
- **THEN** the existing `SCHEMA_GENERATION_PROMPT` (Phase 3) SHALL NOT be used; extraction uses its own separate prompt template

### Requirement: Force extraction mode
The system SHALL support a `force: true` extraction mode. When `force` is true, the system SHALL use a separate system prompt that contains no `is_relevant` instructions, instead commanding the model to extract data without refusing or performing relevance judgment. The model SHALL return a JSON array of objects — even for single-record extractions, the output SHALL be a single-element array.

Temperature SHALL remain at 0 in force mode (no parameter change).

#### Scenario: Force prompt has no relevance instruction
- **WHEN** `runExtraction` is called with `force: true`
- **THEN** the system prompt SHALL NOT contain `is_relevant`, `reason`, or any relevance determination instruction

#### Scenario: Force mode returns bare data array
- **WHEN** the model responds in force mode
- **THEN** the response SHALL be parsed as a JSON array of objects without an outer `is_relevant`/`reason` wrapper

#### Scenario: Force mode uses same temperature
- **WHEN** `runExtraction` is called with `force: true`
- **THEN** the model invocation SHALL still use `Temperature: 0`

## ADDED Requirements

### Requirement: Defensive data normalization
The system SHALL apply a normalization step after `parseAIResponse()` succeeds: if the `data` field (normal mode) or the top-level parsed result (force mode) is a single object rather than an array, it SHALL be automatically wrapped into a single-element array via `Array.isArray(x) ? x : [x]`. This ensures downstream consumers always receive an array regardless of AI output variance.

#### Scenario: AI returns object instead of array in normal mode
- **WHEN** `parseAIResponse` returns `{ is_relevant: true, reason: null, data: { name: "Alice" } }` (data is an object, not array)
- **THEN** `data` SHALL be normalized to `[{ name: "Alice" }]` before cleaning and storage

#### Scenario: AI returns object instead of array in force mode
- **WHEN** `parseAIResponse` returns `{ name: "Alice" }` (top-level object, not array) in force mode
- **THEN** the parsed result SHALL be normalized to `[{ name: "Alice" }]` before cleaning and storage

#### Scenario: AI returns array correctly — no change
- **WHEN** `parseAIResponse` returns `{ is_relevant: true, reason: null, data: [{ name: "Alice" }] }`
- **THEN** `data` SHALL pass through normalization unchanged

#### Scenario: Normalization logs when wrapping triggered
- **WHEN** the normalization step wraps a non-array value into a single-element array
- **THEN** the system SHALL emit a debug-level log with target "pipeline" indicating the wrapping occurred

### Requirement: Cleaner supports array input
The `cleanExtractedData` function SHALL accept both `Record<string, unknown>` and `Record<string, unknown>[]` as input. For array input, it SHALL:
1. Apply the existing per-field cleaning logic to each element
2. Remove elements where all field values are null after cleaning
3. Return the cleaned array, or null if the array is empty after filtering

#### Scenario: Array of valid records
- **WHEN** `cleanExtractedData` receives `[{ name: "Alice", email: "  a@b.com  " }, { name: "Bob", email: null }]`
- **THEN** it SHALL return `[{ name: "Alice", email: "a@b.com" }, { name: "Bob", email: null }]`

#### Scenario: Array with one fully-null element
- **WHEN** `cleanExtractedData` receives `[{ name: null, email: null }, { name: "Bob", email: "b@c.com" }]`
- **THEN** the fully-null element SHALL be removed, returning `[{ name: "Bob", email: "b@c.com" }]`

#### Scenario: All elements fully null
- **WHEN** `cleanExtractedData` receives `[{ name: null }, { email: null }]`
- **THEN** it SHALL return null

#### Scenario: Log when null elements are filtered
- **WHEN** `cleanExtractedData` filters out one or more fully-null elements from an array input
- **THEN** the system SHALL emit a debug-level log with target "cleaner" indicating how many records were filtered

#### Scenario: Single object input (backward compatibility)
- **WHEN** `cleanExtractedData` receives a single `Record<string, unknown>` object
- **THEN** it SHALL clean and return it as before (unchanged behavior)

### Requirement: parseAIResponse supports array fallback
The `parseAIResponse` function's fallback JSON extraction SHALL handle both `{...}` (object) and `[...]` (array) top-level JSON structures. When the primary code-block extraction fails, it SHALL attempt to match the first `[` to the last `]` in addition to the existing `{...}` matching.

#### Scenario: Array JSON wrapped in markdown
- **WHEN** the model response is ` ```json\n[{"name":"Alice"}]\n``` `
- **THEN** `parseAIResponse` SHALL return `[{ name: "Alice" }]`

#### Scenario: Array JSON without markdown
- **WHEN** the model response is `[{"name":"Alice"}]`
- **THEN** `parseAIResponse` SHALL return `[{ name: "Alice" }]`
