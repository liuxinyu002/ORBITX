# Extraction Pipeline — Delta Spec

## Modified Requirements

### Requirement: Relevance routing — silent mode

**Change**: Replace sonner toast with toast overlay for both success and error feedback; show loading toast immediately upon shortcut trigger.

When the `ExtractionListener` receives `task:silent-extract`, it SHALL immediately invoke `show_toast({ payload: { state: "loading", message: "正在提取「<task_name>」…", ... } })` before starting the pipeline. This provides instant visual feedback that the shortcut was received.

When `mode` is `'silent'` and the parsed response has `is_relevant: true`, the system SHALL write the `data` portion to the `extractions` table via `invoke('insert_extraction', ...)` and display a success toast overlay via `invoke('show_toast_command', { payload: { state: "success", ... } })` with the task name, record count, and up to 3 preview fields from the first cleaned record.

When `mode` is `'silent'` and `is_relevant: false`, the system SHALL invoke `invoke('show_overlay', { payload })` with the `fallback` field populated (`reason`, `failedTaskId`) to trigger the fallback overlay flow.

When the pipeline encounters an error (model call failure, timeout, insert failure), the system SHALL display an error toast overlay via `invoke('show_toast_command', { payload: { state: "error", message: "<简短错误信息>" } })` instead of `toast.error(...)`.

#### Scenario: Loading toast appears immediately on shortcut trigger
- **WHEN** `task:silent-extract` event is received
- **THEN** a loading toast with Lottie ripple animation and task name SHALL appear at the cursor position before the pipeline begins

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
