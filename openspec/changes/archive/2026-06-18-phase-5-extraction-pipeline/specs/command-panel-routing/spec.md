# Command Panel Routing

## Purpose

Define the three dispatch routing chains (silent, panel, fallback), the event protocol, and the overlay window lifecycle management.

## OverlayPayload Discriminated Union

The `view:render-overlay` event payload SHALL be a discriminated union with the following variants:

| Tag | Fields | 用途 |
|-----|--------|------|
| `"content"` | `text: String`, `truncated: bool`, `fallback?: { reason: String, failedTaskId: String }` | 正常文本展示 / 降级模式 |
| `"empty"` | *(无)* | 未选中文本 |
| `"permission-required"` | *(无)* | 辅助功能权限被拒绝 |
| `"timeout"` | *(无)* | 抓取超时 |

The Rust side SHALL construct the appropriate variant based on the grab result. The overlay frontend SHALL use `tag` to determine which UI state to render, eliminating ambiguity.

## ADDED Requirements

### Requirement: Silent extract chain (Shortcut A)
When the user presses the global shortcut `CmdOrCtrl+Shift+E` (Shortcut A), the system SHALL:

1. Grab selected text via the existing degradation pipeline
2. Apply Phase 4 token truncation (`MAX_GRAB_TOKENS`)
3. Emit `task:silent-extract` event to the main window (`label: "main"`) with payload `{ text: String, truncated: bool }`
4. NOT show the overlay window
5. NOT store results in any queue

#### Scenario: Shortcut A emits to main window only
- **WHEN** user presses Shortcut A with text selected
- **THEN** the Rust backend SHALL `emit_to("main", "task:silent-extract", payload)` and the overlay window SHALL remain hidden

#### Scenario: Truncated text marked in payload
- **WHEN** grabbed text exceeds the token limit and is truncated
- **THEN** the `task:silent-extract` payload SHALL have `truncated: true`

### Requirement: Panel extract chain (Shortcut B)
When the user presses `CmdOrCtrl+Shift+K` (Shortcut B), the system SHALL:

1. Grab selected text via the degradation pipeline
2. Apply Phase 4 token truncation
3. Compute overlay position via `compute_overlay_position()`
4. Call the core `show_overlay` function with payload `{ text, truncated, fallback?: undefined }`
5. The core function SHALL emit `view:render-overlay` to the overlay window and show/focus it

#### Scenario: Shortcut B shows overlay with text
- **WHEN** user presses Shortcut B with text selected
- **THEN** the overlay window SHALL appear near the cursor and display the captured text

#### Scenario: Shortcut B does not emit to main window
- **WHEN** user presses Shortcut B
- **THEN** the `task:silent-extract` event SHALL NOT be emitted

### Requirement: Fallback overlay chain
When the main window invokes `invoke('show_overlay', { payload })` with `fallback` populated, the system SHALL:

1. Check if overlay window exists (create if not)
2. Show and focus the overlay window
3. Emit `view:render-overlay` to the overlay window with the full payload including `fallback: { reason, failedTaskId }`

The `show_overlay` command SHALL be idempotent — repeated calls with the same or different payloads SHALL not create duplicate windows.

#### Scenario: Fallback payload delivered to overlay
- **WHEN** `show_overlay` is invoked with fallback payload
- **THEN** the overlay window SHALL receive `view:render-overlay` with `fallback` field populated

#### Scenario: Overlay created if not exists
- **WHEN** `show_overlay` is invoked and the overlay window does not exist
- **THEN** the window SHALL be created before showing

### Requirement: Manual extract chain (overlay confirmation)
When the user confirms dispatch in the overlay (selects task and clicks confirm, or clicks force-insert in fallback mode), the overlay SHALL:

1. Apply a fade-out animation using Tailwind CSS utility classes (`animate-out fade-out duration-200`)
2. After animation, call `getCurrentWebviewWindow().hide()`
3. Clear local React state
4. Emit `task:manual-extract` as a global Tauri event with payload `{ text: String, taskId: String, force?: bool, truncated?: bool }`

#### Scenario: Overlay hides after emit
- **WHEN** the user confirms dispatch in the overlay
- **THEN** the overlay SHALL fade out within 200ms and call `hide()`

#### Scenario: Main window receives manual extract event
- **WHEN** the overlay emits `task:manual-extract`
- **THEN** the `<ExtractionListener>` in the main window SHALL receive the event and call `runExtraction` with the payload

### Requirement: Removal of legacy grab queue
The system SHALL remove:
- The `GrabState` struct and its Mutex-wrapped queue
- The `grab-completed` event emission
- The `consume_grabbed_result` Tauri command
- The `set_overlay_permission_state` Tauri command (permission state now handled within overlay rendering)

No code in the codebase SHALL reference these removed items after the change.

#### Scenario: Legacy items no longer exist
- **WHEN** the change is fully implemented
- **THEN** searching for `GrabState`, `grab-completed`, `consume_grabbed_result` across the codebase SHALL yield zero results

### Requirement: ExtractionListener headless component
The system SHALL include a `<ExtractionListener />` component mounted inside `<AgentProvider>` in the main window. It SHALL:

1. Listen for `task:silent-extract` events — call `runExtraction` with `mode: 'silent'`
2. Listen for `task:manual-extract` events — call `runExtraction` with `mode: 'manual'`
3. Derive the active model from `AgentContext` and pass it to `runExtraction`
4. Render no DOM elements (return `null`)

#### Scenario: Listener renders nothing
- **WHEN** `<ExtractionListener />` is mounted
- **THEN** it SHALL return `null` (no DOM output)

#### Scenario: Listener passes model from context
- **WHEN** a `task:silent-extract` event is received
- **THEN** the listener SHALL read the active model config from `AgentContext` and pass it as `currentModel` to `runExtraction`
