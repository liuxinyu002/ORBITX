# Extraction Pipeline

## Purpose

Define the AI-powered structured data extraction pipeline: prompt assembly, model invocation, relevance determination, force mode, and result routing.

## ADDED Requirements

### Requirement: Extraction prompt assembly
The system SHALL assemble extraction prompts by injecting the task's Schema fields as JSON directly into the system prompt template. The prompt SHALL instruct the model to output a JSON object with `is_relevant` (boolean) and `reason` (string|null) appearing before the nested `data` object containing extracted field values.

The system SHALL use `Temperature: 0` for all extraction requests.

The system SHALL reuse the existing `parseAIResponse()` function from `src/agent/extractor.ts` to parse model responses from both normal and force modes. The return type of `parseAIResponse()` SHALL be generalized from `{ fields: unknown[] } | null` to `Record<string, unknown> | null` to accommodate both Schema parsing (Phase 3) and extraction response parsing (Phase 5).

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
The system SHALL support a `force: true` extraction mode. When `force` is true, the system SHALL use a separate system prompt that contains no `is_relevant` instructions, instead commanding the model to extract data without refusing or performing relevance judgment. The model SHALL return only the bare `data` object (no `is_relevant`/`reason` wrapper).

Temperature SHALL remain at 0 in force mode (no parameter change).

#### Scenario: Force prompt has no relevance instruction
- **WHEN** `runExtraction` is called with `force: true`
- **THEN** the system prompt SHALL NOT contain `is_relevant`, `reason`, or any relevance determination instruction

#### Scenario: Force mode returns bare data
- **WHEN** the model responds in force mode
- **THEN** the response SHALL be parsed as a plain `data` object without an outer `is_relevant`/`reason` wrapper

#### Scenario: Force mode uses same temperature
- **WHEN** `runExtraction` is called with `force: true`
- **THEN** the model invocation SHALL still use `Temperature: 0`

### Requirement: Relevance routing — silent mode
When `mode` is `'silent'` and the parsed response has `is_relevant: true`, the system SHALL write the `data` portion to the `extractions` table via `invoke('insert_extraction', ...)` and display a success Toast.

When `mode` is `'silent'` and `is_relevant: false`, the system SHALL invoke `invoke('show_overlay', { payload })` with the `fallback` field populated (`reason`, `failedTaskId`) to trigger the fallback overlay flow.

#### Scenario: Relevant data silently stored
- **WHEN** silent extraction yields `is_relevant: true`
- **THEN** the `data` object SHALL be written to SQLite and a success Toast displayed ("已提取")

#### Scenario: Irrelevant data triggers fallback
- **WHEN** silent extraction yields `is_relevant: false`
- **THEN** the system SHALL invoke `show_overlay` with fallback payload and no data SHALL be written to the database

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
