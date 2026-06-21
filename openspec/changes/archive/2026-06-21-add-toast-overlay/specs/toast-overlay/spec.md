# Toast Overlay

## Purpose

Define the standalone toast overlay window for non-interactive message notifications, displayed near the cursor with auto-dismiss. The toast supports three states — loading, success, and error — driven by a single `state` field in the render payload.

## Requirements

### Requirement: Toast state machine model
The toast SHALL operate as a three-state state machine driven by `ToastPayload.state`:

- `"loading"` — Lottie ripple animation + task name, no auto-dismiss timer
- `"success"` — checkmark + message + record count + field previews, 2.5s auto-dismiss
- `"error"` — cross mark + error message, 2.5s auto-dismiss

The Rust `show_toast_command` command SHALL emit a single `toast:render` event with a `ToastPayload` containing a `state` field. The frontend SHALL render the appropriate UI by switching on `state`.

#### Scenario: Loading state has no auto-dismiss
- **WHEN** `toast:render` event has `state: "loading"`
- **THEN** the toast SHALL remain visible indefinitely until the next `toast:render` event transitions to another state

#### Scenario: Success state transitions from loading
- **WHEN** `toast:render` event has `state: "success"` after a previous `state: "loading"` event
- **THEN** the toast SHALL switch from loading UI to success UI and start the 2.5s auto-dismiss timer

#### Scenario: Error state transitions from loading
- **WHEN** `toast:render` event has `state: "error"` after a previous `state: "loading"` event
- **THEN** the toast SHALL switch from loading UI to error UI and start the 2.5s auto-dismiss timer

### Requirement: ToastState Rust enum
The system SHALL define `ToastState` enum in `grab/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToastState {
    Loading,
    Success,
    Error,
}
```

The `ToastPayload` struct SHALL include a `state: ToastState` field.

#### Scenario: ToastState serializes to camelCase lowercase
- **WHEN** `ToastState::Loading` is serialized to JSON
- **THEN** it SHALL produce the string `"loading"`
The toast window SHALL be declared in `tauri.conf.json` with the following configuration and SHALL NOT be dynamically created:

```json
{
  "label": "toast",
  "url": "/#/toast",
  "visible": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "center": false,
  "create": false,
  "width": 480,
  "height": 48,
  "resizable": false,
  "shadow": false
}
```

The window SHALL NOT auto-hide on focus loss.

#### Scenario: Toast hidden at app launch
- **WHEN** the app starts
- **THEN** the toast window exists but is not visible

#### Scenario: Toast shown on show_toast command
- **WHEN** `show_toast_command` Tauri command is invoked
- **THEN** the toast window appears near the mouse cursor

#### Scenario: Toast always on top
- **WHEN** the toast is visible
- **THEN** it SHALL remain above other application windows

### Requirement: show_toast_command Tauri command
The system SHALL expose a Tauri command `show_toast_command` accepting `payload: ToastPayload` where `ToastPayload` includes `state: ToastState`, `message: String`, `task_name: Option<String>`, `record_count: u32`, and `preview_fields: Vec<FieldPreview>`.

The command SHALL:
1. Hide the toast window if currently visible (reset state)
2. Get cursor position and compute window location (reuse existing `overlay_position` module); if cursor position cannot be obtained, fall back to screen center
3. Truncate each `preview_field.value` to 20 characters before emitting the event
4. Emit `toast:render` event with the full payload to the toast window
5. Set window size, position, and show it
6. **If `state` is `"success"` or `"error"`**: after 2500ms (or `TOAST_DURATION_MS` env var if set), hide the toast window
7. **If `state` is `"loading"`**: do NOT start any auto-dismiss timer; return immediately after showing
8. If the toast window does not exist, return an error without panicking

Log points: debug on invocation (state + message), warn on cursor/screen fallback, info on show (with "无定时器" for loading state), error on missing window.

#### Scenario: show_toast positions near cursor
- **WHEN** `show_toast_command` is called
- **THEN** the toast window SHALL appear near the cursor using the same smart-flip logic as the overlay

#### Scenario: show_toast auto-hides for success state
- **WHEN** `show_toast_command` is called with `state: "success"`
- **THEN** the toast window SHALL automatically hide after 2500ms

#### Scenario: show_toast auto-hides for error state
- **WHEN** `show_toast_command` is called with `state: "error"`
- **THEN** the toast window SHALL automatically hide after 2500ms

#### Scenario: show_toast does not auto-hide for loading state
- **WHEN** `show_toast_command` is called with `state: "loading"`
- **THEN** the toast window SHALL remain visible and SHALL NOT start an auto-dismiss timer

#### Scenario: Rapid re-trigger resets state
- **WHEN** `show_toast_command` is called while a previous toast is still visible
- **THEN** the window SHALL hide immediately and re-show with the new content; if the new `state` is `"loading"`, no auto-dismiss timer; if `"success"` or `"error"`, a fresh 2.5s timer

#### Scenario: Window missing — error returned without panic
- **WHEN** `show_toast_command` is called but the toast window does not exist
- **THEN** the command SHALL return an error and log at error level, without panicking

#### Scenario: Cursor position unavailable — falls back to screen center
- **WHEN** `show_toast_command` is called but cursor position cannot be obtained
- **THEN** the toast window SHALL appear at the screen center

### Requirement: Toast capsule rendering
The toast frontend (`src/routes/toast-overlay.tsx`) SHALL render a rounded capsule with the same width (480px) across all states to avoid layout jumps. The capsule SHALL use design tokens (`--popover` background, `--foreground` text), inheriting dark mode automatically. Strictly avoid glassmorphism or visual embellishments.

**Loading state** (`state: "loading"`):
- Single row: Lottie ripple animation (`lottie-react`, 24×24px, `loop={true}`) + message text (e.g., "正在提取「简历库」…")
- Animation color SHALL inherit from container's `text-foreground` via CSS `stroke: currentColor`, adapting to light/dark theme automatically

**Success state** (`state: "success"`):
- First row: green checkmark (`✓`) + message text + record count badge (e.g., "· 3 条")
- Second row (if `preview_fields` is non-empty): up to 3 field previews, each as `key: value`, separated by `|`, with values truncated to ~20 characters

**Error state** (`state: "error"`):
- Single row: red cross mark (`✗`) + message text

The capsule SHALL use the same design tokens as the command panel overlay for border and shadow: `border: 1px solid` + `--border` token, `border-radius: --radius` (8px), `box-shadow: 0 1px 3px rgba(0,0,0,0.05)`.

#### Scenario: Loading state renders Lottie ripple animation
- **WHEN** `toast:render` event has `state: "loading"` and `message: "正在提取「简历库」…"`
- **THEN** the toast SHALL render a single row with a looping Lottie ripple animation icon (24×24px) and the message text
- **AND** the animation color SHALL follow `currentColor` derived from the container's `text-foreground`

#### Scenario: Success state renders with field previews
- **WHEN** `toast:render` event has `state: "success"` and `preview_fields: [{key:"姓名", value:"张三"}, {key:"电话", value:"13812345678"}]`
- **THEN** the second row SHALL display `姓名: 张三  |  电话: 13812345678`

#### Scenario: Success state renders without field previews
- **WHEN** `toast:render` event has `state: "success"` with empty `preview_fields`
- **THEN** only the first row SHALL be displayed

#### Scenario: Success state renders with message containing task name
- **WHEN** `toast:render` event has `state: "success"`, `message: "已提取到「简历库」"` and `record_count: 3`
- **THEN** the first row SHALL display `✓  已提取到「简历库」  ·  3 条`

#### Scenario: Error state renders error message
- **WHEN** `toast:render` event has `state: "error"` and `message: "AI 提取失败: 调用超时"`
- **THEN** the toast SHALL render a single row with red `✗` and the error message

### Requirement: Toast fade-out animation
The toast frontend SHALL apply a CSS fade-out animation (`opacity: 1 → 0`, 200ms ease-in) before the window hides, only for `state: "success"` and `state: "error"`. The frontend SHALL read `duration_ms` from `ToastPayload` and start the fade-out at `duration_ms - 200` milliseconds after receiving `toast:render`, so that the fade animation completes as the Rust side hides the window.

When `state` is `"loading"`, the frontend SHALL NOT start any fade-out timer.

#### Scenario: Fade-out timing derived from payload duration_ms
- **WHEN** `toast:render` event has `duration_ms: 2500` and `state: "success"`
- **THEN** the frontend SHALL start fade-out at `2500 - 200 = 2300ms` after receiving the event

#### Scenario: Success state fades out before hiding
- **WHEN** the toast has been visible in success state for `duration_ms - 200` milliseconds
- **THEN** the capsule SHALL begin a 200ms opacity fade-out

#### Scenario: Loading state does not fade out
- **WHEN** the toast is in loading state
- **THEN** the capsule SHALL NOT fade out

#### Scenario: State transition resets fade-out timer
- **WHEN** `toast:render` event arrives and the component already has a pending fade-out timer
- **THEN** the pending timer SHALL be cleared and (if new state is success/error) a fresh timer SHALL be set

### Requirement: Toast route registered in frontend
The React router SHALL register a route at `/toast` that renders the toast overlay component. This route SHALL NOT use the root layout.

#### Scenario: Toast route accessible
- **WHEN** navigating to `/#/toast`
- **THEN** the toast component renders without the main app header/sidebar chrome

### Requirement: ToastPayload Rust struct
The system SHALL define `ToastPayload`, `FieldPreview`, and `ToastState` in `grab/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToastState {
    Loading,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastPayload {
    pub state: ToastState,
    pub message: String,
    pub task_name: Option<String>,
    pub record_count: u32,
    pub preview_fields: Vec<FieldPreview>,
    /// 自动消失时间（毫秒），前端据此计算 fade-out 动画起点
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldPreview {
    pub key: String,
    pub value: String,
}
```

#### Scenario: ToastPayload serializes to camelCase
- **WHEN** `ToastPayload` is serialized to JSON
- **THEN** field names SHALL use camelCase (`recordCount`, `taskName`, `previewFields`, `durationMs`)

#### Scenario: Field values truncated to 20 characters
- **WHEN** a `FieldPreview` value exceeds 20 characters
- **THEN** the value SHALL be truncated to 20 characters with "…" appended before the event is emitted

### Requirement: Toast duration configurable via environment variable
The toast display duration SHALL be configurable via the `TOAST_DURATION_MS` environment variable (default: 2500ms). The `show_toast_command` command SHALL read this value at invocation time.

#### Scenario: Default duration used when env var absent
- **WHEN** `TOAST_DURATION_MS` is not set
- **THEN** the toast SHALL auto-hide after 2500ms

#### Scenario: Custom duration applied from env var
- **WHEN** `TOAST_DURATION_MS` is set to `1500`
- **THEN** the toast SHALL auto-hide after 1500ms

### Requirement: Method to set no-shadow on toast window
The toast window SHALL disable native OS shadow via `window.set_shadow(false)` in Rust setup. Visual boundary SHALL be provided by CSS border + box-shadow.

#### Scenario: Toast has no native shadow
- **WHEN** the toast window is shown
- **THEN** it SHALL have no OS-level window shadow
