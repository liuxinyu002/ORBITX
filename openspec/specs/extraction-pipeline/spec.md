# Extraction Pipeline

## Purpose

Define the AI-powered structured data extraction pipeline: prompt assembly, model invocation, relevance determination, force mode, and result routing.

## Requirements

### Requirement: Extraction prompt assembly
The system SHALL assemble extraction prompts by injecting the task's Schema fields as JSON directly into the system prompt template. The prompt SHALL instruct the model to output a JSON object with `is_relevant` (boolean) and `reason` (string|null) appearing before the nested `data` field, which SHALL be a JSON array of objects — even for single-record extractions, `data` SHALL be a single-element array.

The system SHALL use `Temperature: 0` for all extraction requests.

The system SHALL reuse the existing `parseAIResponse()` function from `src/agent/extractor.ts` to parse model responses from both normal and force modes. The return type of `parseAIResponse()` SHALL be generalized to `Record<string, unknown> | unknown[] | null` to accommodate both object and array responses.

#### Scenario: Normal extraction prompt includes relevance preamble
- **WHEN** `runExtraction` is called with `force: false` or `force: undefined`
- **THEN** the system prompt SHALL instruct the model to first output `is_relevant` and `reason`, then output `data` fields matching the task Schema

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

### Requirement: Relevance routing — silent mode

When the `ExtractionListener` receives `task:silent-extract`, it SHALL immediately invoke `show_toast({ payload: { state: "loading", message: "正在提取…", ... } })` before starting the pipeline. This provides instant visual feedback that the shortcut was received.

When `mode` is `'silent'` and the parsed response has `is_relevant: true`, the system SHALL write the `data` portion to the `extractions` table via `invoke('insert_extraction', ...)` and display a success toast overlay via `invoke('show_toast_command', { payload: { state: "success", ... } })` with the task name, record count, and up to 3 preview fields from the first cleaned record.

When `mode` is `'silent'` and `is_relevant: false`, the system SHALL invoke `invoke('show_overlay', { payload })` with the `fallback` field populated (`reason`, `failedTaskId`) to trigger the fallback overlay flow.

When the pipeline encounters an error (model call failure, timeout, insert failure), the system SHALL display an error toast overlay via `invoke('show_toast_command', { payload: { state: "error", message: "<简短错误信息>" } })` instead of `toast.error(...)`.

#### Scenario: Loading toast appears immediately on shortcut trigger
- **WHEN** `task:silent-extract` event is received
- **THEN** a loading toast with Lottie ripple animation and message SHALL appear at the cursor position before the pipeline begins

#### Scenario: Relevant data silently stored with success toast overlay
- **WHEN** silent extraction yields `is_relevant: true`
- **THEN** the `data` object SHALL be written to SQLite and the loading toast SHALL transition to a success toast showing task name, record count, and field preview

#### Scenario: Irrelevant data triggers fallback
- **WHEN** silent extraction yields `is_relevant: false`
- **THEN** the system SHALL invoke `show_overlay` with fallback payload and no data SHALL be written to the database

#### Scenario: Force mode success shows success toast overlay
- **WHEN** force extraction succeeds
- **THEN** the loading toast SHALL transition to a success toast (instead of `toast.success("已强制提取")`)

#### Scenario: Model call failure shows error toast
- **WHEN** the AI model call fails (error, timeout, abort)
- **THEN** the loading toast SHALL transition to an error toast with a brief error message and 2.5s auto-dismiss

#### Scenario: Insert failure shows error toast
- **WHEN** `insert_extraction` fails
- **THEN** the loading toast SHALL transition to an error toast with "入库失败，请重试" and 2.5s auto-dismiss

#### Scenario: Error toast degrades to sonner on failure
- **WHEN** `show_toast_command` invocation itself fails
- **THEN** the system SHALL fall back to `toast.success()` or `toast.error()` to ensure feedback is never lost

### Requirement: Relevance routing — manual mode
When `mode` is `'manual'` and `is_relevant: false` or JSON parsing fails, the system SHALL NOT trigger fallback overlay. Instead, the main window SHALL display an error Toast indicating the extraction result. If `force` is `true`, the system SHALL skip relevance checks entirely and write the extracted data directly.

#### Scenario: Manual extraction with is_relevant false shows error Toast
- **WHEN** manual mode extraction yields `is_relevant: false`
- **THEN** the main window SHALL display an error Toast, and no data SHALL be written unless the user re-triggers with force

#### Scenario: Force flag bypasses relevance for manual extraction
- **WHEN** manual mode extraction runs with `force: true`
- **THEN** relevance checking SHALL be skipped and extracted `data` SHALL be written directly to SQLite

### Requirement: No active task handling
When `runExtraction` is called in silent mode and no task is currently active, the system SHALL display a Toast "静默失败：无激活任务" and abort without attempting extraction.

#### Scenario: Silent extraction with no active task
- **WHEN** silent mode is triggered and `active_task_id` is null
- **THEN** a Toast "静默失败：无激活任务" SHALL display and no API call SHALL be made

### Requirement: Model failure — zero retry
When the AI model call fails (network timeout, rate limit, API key error), the system SHALL display an error Toast immediately and abort. No retry SHALL be attempted.

The `complete()` call timeout SHALL be controlled by the `EXTRACTION_TIMEOUT_MS` environment variable (default `30000` ms). Timeout and network errors are treated identically to other failures: instant Toast, no retry.

#### Scenario: Network timeout aborts immediately
- **WHEN** the model API call times out (exceeds `EXTRACTION_TIMEOUT_MS`)
- **THEN** an error Toast SHALL display and no retry SHALL occur

#### Scenario: Timeout value from environment variable
- **WHEN** `EXTRACTION_TIMEOUT_MS` is set to `15000`
- **THEN** the `complete()` call SHALL time out after 15 seconds

### Requirement: JSON parse failure equals irrelevant
When `parseAIResponse()` fails to extract valid JSON from the model response, the system SHALL treat it identically to `is_relevant: false`:
- Silent mode: invoke fallback overlay
- Manual mode: display error Toast

#### Scenario: Malformed JSON in silent mode triggers fallback
- **WHEN** the model response cannot be parsed as JSON in silent mode
- **THEN** the system SHALL invoke `show_overlay` with fallback payload (this may produce a second Toast alongside the first)

### Requirement: Pure function signature
The `runExtraction` function SHALL accept all dependencies as explicit parameters. It SHALL NOT import or use any React hooks, context, or global mutable state. It SHALL return `Promise<void>`.

#### Scenario: Function accepts explicit dependencies
- **WHEN** `runExtraction` is imported and called
- **THEN** all required parameters (text, mode, currentModel, taskId, force, truncated) SHALL be passed as arguments

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
