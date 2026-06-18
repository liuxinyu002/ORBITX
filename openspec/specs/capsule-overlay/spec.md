# Capsule Overlay

## Purpose

Define the horizontal capsule toolbar UI for the overlay window, including multi-tool slot layout, JS middle-truncated text preview, task switcher dropdown with dynamic window resize, and future tool placeholders.

## Requirements

### Requirement: Horizontal capsule toolbar layout
The overlay frontend SHALL render a horizontal toolbar (48px height) instead of the previous segmented panel. The toolbar SHALL follow the global DESIGN.md token system: `border-radius: 8px` (`--radius`), `background: --popover`, `border: 1px solid` + `--border` token, and `box-shadow: 0 1px 3px rgba(0,0,0,0.05)`. No `backdrop-filter` or glassmorphism SHALL be used. Dark mode SHALL be supported via CSS custom property overrides (`.dark` class in `globals.css`). The layout SHALL be a single-row flex container with horizontal padding `px-6` (24px). Multiple tool slots SHALL be separated by `1px` vertical dividers using `--border` token.

#### Scenario: Capsule renders on mount
- **WHEN** the overlay route mounts
- **THEN** a 48px tall, rounded horizontal toolbar is visible

#### Scenario: Capsule uses solid white background
- **WHEN** the overlay is visible
- **THEN** the capsule background SHALL follow the `--popover` token with no transparency or blur

#### Scenario: Capsule uses border for boundary
- **WHEN** the overlay is visible against a white background
- **THEN** the capsule SHALL be distinguishable via `1px solid` border using `--border` token

### Requirement: JS middle-truncated text preview (left zone)
The left zone of the capsule SHALL display the grabbed selected text in a single line, using `flex: 1; min-width: 0` to fill available space. When text exceeds available pixel width, it SHALL be truncated in the middle with a `*` marker using JavaScript Canvas `measureText()`, producing the format `"prefix...*...suffix"`. When Canvas is unavailable, a character-count fallback SHALL be used. Short text that fits SHALL NOT be modified.

#### Scenario: Text displayed after grab without truncation
- **WHEN** `consume_grabbed_result` returns text short enough to fit within the left zone
- **THEN** the left zone SHALL display the full text as-is

#### Scenario: Long text truncated in middle
- **WHEN** `consume_grabbed_result` returns text exceeding the available pixel width
- **THEN** the left zone SHALL render the text in `"prefix...*...suffix"` format with both prefix and suffix retaining at least 3 characters

#### Scenario: Canvas fallback on character count
- **WHEN** Canvas `measureText()` is unavailable
- **THEN** the truncation SHALL fall back to splitting text by character ratio (roughly 40% prefix + 40% suffix)

### Requirement: Multi-tool slot layout
The capsule SHALL contain multiple tool slots separated by `1px` vertical dividers. Slot 1 (structured extractor) SHALL contain the text preview (flex-1) and task switcher button (auto-width, max 120px). Additional slots SHALL be reserved for future tools, displaying only a monochrome SVG icon at `opacity: 0.4` with no text label. On hover or focus, reserved icon slots SHALL transition to `opacity: 1` and show a tooltip. Reserved slots SHALL be keyboard-reachable via `tabindex: 0`.

#### Scenario: Slot 1 contains text and task button
- **WHEN** the capsule renders
- **THEN** the first tool slot SHALL display the left text zone and right task button, separated by a divider

#### Scenario: Future tool slots show dimmed icons
- **WHEN** the capsule renders
- **THEN** reserved tool slots after slot 1 SHALL display monochrome icons at `opacity: 0.4`

#### Scenario: Future tool slot hover reveals tooltip
- **WHEN** the user hovers over a reserved tool slot icon
- **THEN** the icon SHALL transition to `opacity: 1` and display a tooltip

#### Scenario: Future tool slot focus reveals tooltip
- **WHEN** a reserved tool slot icon receives keyboard focus
- **THEN** the icon SHALL transition to `opacity: 1` and display a tooltip (same behavior as hover)

### Requirement: Active task indicator (right zone)
The right zone of slot 1 SHALL display the currently active task name (self-sized, `max-width: 120px` with CSS `text-overflow: ellipsis` fallback), or guide text when no task is active. Clicking this zone SHALL toggle a dropdown list of all available tasks with a chevron icon rotation.

#### Scenario: Active task shown
- **WHEN** `list_tasks` returns an `activeTaskId` matching an existing task
- **THEN** the right zone SHALL display that task's name

#### Scenario: No task shows guide text
- **WHEN** `list_tasks` returns `activeTaskId: null`
- **THEN** the right zone SHALL display `"选择任务"` in muted color

#### Scenario: Click opens task dropdown
- **WHEN** the user clicks the right zone
- **THEN** the chevron icon SHALL rotate 180°, and a dropdown list SHALL fade in below the capsule

### Requirement: Task switcher dropdown with dynamic resize
The task switcher dropdown SHALL list all tasks from the database ordered by `updated_at` descending. Before rendering the dropdown, the frontend SHALL call `getCurrentWebviewWindow().setSize()` to expand the window height from 48px to accommodate the dropdown below the capsule. The window height SHALL be reduced back to 48px AFTER the close animation completes (via `onTransitionEnd` callback).

The dropdown SHALL be positioned `absolute; left: 0; top: 100%` relative to the task button (left-aligned). Width SHALL be `min-width: 100%` of the task button, with a max-width constrained to not exceed the capsule's right boundary. The dropdown SHALL have `border-radius: 8px` (`--radius`), `background: --popover`, `border: 1px solid` + `--border` token, and `box-shadow: 0 4px 12px rgba(0,0,0,0.08)`. It SHALL have `max-height: 216px` (6 items visible) with `overflow-y: auto` for longer lists.

#### Scenario: Window expands on dropdown open
- **WHEN** the task button is clicked
- **THEN** `setSize(480, expandedHeight)` is called BEFORE the dropdown becomes visible
- **THEN** `expandedHeight = 48 + min(tasks.length, 6) * 36 + 8`

#### Scenario: Window shrinks after dropdown close animation
- **WHEN** the dropdown close animation completes (`onTransitionEnd`)
- **THEN** `setSize(480, 48)` is called to restore collapsed window height

#### Scenario: Fallback timer ensures resize
- **WHEN** close animation is started but `onTransitionEnd` does not fire within 300ms
- **THEN** a fallback timer SHALL call `setSize(480, 48)`

#### Scenario: Tasks listed in dropdown
- **WHEN** the dropdown is open
- **THEN** all tasks from `list_tasks` SHALL be displayed with the active task marked by `✓` and `font-weight: 500`

#### Scenario: Select a task
- **WHEN** the user clicks a task in the dropdown
- **THEN** `set_active_task_id` is invoked, the dropdown closes with fade-out, and after `onTransitionEnd` the window shrinks back to 48px

#### Scenario: Deselect active task
- **WHEN** the user clicks the currently active task in the dropdown
- **THEN** `set_active_task_id(null)` is invoked, the dropdown closes, and the right zone shows `"选择任务"`

#### Scenario: Click outside closes dropdown
- **WHEN** the dropdown is open and the user clicks outside it
- **THEN** the dropdown closes with fade-out animation, followed by window resize

#### Scenario: Dropdown fade-in animation
- **WHEN** the dropdown opens
- **THEN** it SHALL transition from `opacity: 0; transform: translateY(-4px)` to `opacity: 1; transform: translateY(0)` over 150ms ease-out

#### Scenario: Dropdown fade-out animation
- **WHEN** the dropdown closes
- **THEN** it SHALL transition to `opacity: 0; transform: translateY(-4px)` over 150ms ease-in

### Requirement: State rendering in capsule format
The capsule SHALL render one of five states in the left text zone:
1. **Skeleton**: pulsing placeholder (`bg-muted animate-pulse rounded h-5 w-3/4`)
2. **Content**: JS middle-truncated text in `--foreground` token color, sourced from `view:render-overlay` payload (text field)
3. **Empty**: `"未发现选中文本"` in `--muted-foreground` token color
4. **PermissionRequired**: `"请在系统设置中授权辅助功能"` with a retry button using the DESIGN.md primary token (`--primary`). Retry button SHALL call `getCurrentWebviewWindow().hide()` to dismiss the overlay — the user must fix system settings first; the next shortcut press will re-attempt the grab.
5. **Timeout**: toast notification, UI falls back to empty state

Each state SHALL replace the left zone content; the right zone and tool slots SHALL remain stable across state transitions.

The overlay SHALL transition from skeleton to content upon receiving the `view:render-overlay` event (replacing the removed `grab-completed`/`consume_grabbed_result` pattern).

#### Scenario: Skeleton shown immediately
- **WHEN** the overlay window first becomes visible
- **THEN** the left zone SHALL render a pulsing skeleton placeholder

#### Scenario: Content fills after view:render-overlay
- **WHEN** the overlay receives the `view:render-overlay` event with a `text` field
- **THEN** the left zone SHALL transition from skeleton to middle-truncated text

#### Scenario: Permission guidance in capsule
- **WHEN** `view:render-overlay` payload indicates accessibility denial context
- **THEN** the left zone SHALL display compact permission hint with retry button, and blur-auto-hide is suppressed

### Requirement: Overlay close via Esc key (preserved)
The overlay SHALL hide when the user presses Escape, with two-tier handling: if the dropdown is open, close it first (with fade-out + resize); if already closed, hide the entire overlay window.

#### Scenario: Esc closes dropdown first
- **WHEN** the task dropdown is open and the user presses Escape
- **THEN** the dropdown SHALL close with fade-out animation, followed by window resize

#### Scenario: Esc hides overlay when dropdown closed
- **WHEN** the overlay is visible (dropdown closed) and the user presses Escape
- **THEN** `getCurrentWebviewWindow().hide()` is called

### Requirement: Overlay hide on focus loss (preserved)
The overlay SHALL hide when the window loses focus (Rust `on_window_event(Focused(false))`), unless permission guidance is active.

#### Scenario: Blur hides overlay
- **WHEN** the overlay loses focus
- **THEN** the overlay window is hidden, unless permission guidance state is active

### Requirement: Task operation failure degradation
When `list_tasks` or `set_active_task_id` invocation fails, the overlay SHALL degrade gracefully: `list_tasks` failure → dropdown does not open, toast `"任务列表加载失败"`; `set_active_task_id` failure → toast `"任务切换失败"` + local state rollback.

#### Scenario: list_tasks fails
- **WHEN** `list_tasks` invocation rejects or times out (2s)
- **THEN** the dropdown SHALL NOT open, a toast displays `"任务列表加载失败"`, and the right zone retains previous state

#### Scenario: set_active_task_id fails
- **WHEN** `set_active_task_id` invocation rejects or times out (2s)
- **THEN** a toast displays `"任务切换失败"` and the right zone reverts to the previous active task name

### Requirement: Task data refreshed on each overlay visibility cycle
The overlay SHALL invoke `list_tasks` each time a `view:render-overlay` event is received.

#### Scenario: Tasks reloaded on render event
- **WHEN** the overlay receives `view:render-overlay` event
- **THEN** the overlay SHALL invoke `list_tasks` before any other state transition

### Requirement: Fallback mode rendering
When the `view:render-overlay` payload includes a `fallback` field (`{ reason: string, failedTaskId: string }`), the overlay SHALL render fallback mode:

1. A warning indicator showing the rejection reason
2. The original captured text in a collapsed preview (default: `line-clamp-3`, approximately 80-100 characters), with a `▸ 展开原文` button to expand; if `truncated: true`, a gray suffix `... (内容受字符阈值限制已在抓取时截断)` SHALL be appended
3. The task dropdown with the `failedTaskId` task pre-selected as default and marked with a `⚠` indicator (NOT disabled or grayed out)
4. Three action buttons: force-insert, discard, and re-select (via dropdown + confirm)

#### Scenario: Fallback mode shows rejection reason
- **WHEN** overlay receives payload with `fallback.reason: "文本内容与任务定义不相关"`
- **THEN** the overlay SHALL display the reason text prominently

#### Scenario: Failed task pre-selected in dropdown
- **WHEN** overlay is in fallback mode with `failedTaskId: "task-123"`
- **THEN** the dropdown SHALL show "task-123" as the selected task with a `⚠` indicator beside its name

#### Scenario: Failed task not disabled
- **WHEN** overlay is in fallback mode
- **THEN** the `failedTaskId` task SHALL remain selectable in the dropdown with full interactivity

#### Scenario: Text preview collapsed by default
- **WHEN** fallback mode renders
- **THEN** the captured text SHALL display at most 3 lines via `line-clamp-3` with an expand button

#### Scenario: Truncated indicator shown
- **WHEN** fallback mode renders with `truncated: true` in the payload
- **THEN** a gray suffix note about character truncation SHALL be appended after the text

### Requirement: Fallback actions
In fallback mode, the overlay SHALL support three user actions:

**Discard**: When the user clicks discard, call `getCurrentWebviewWindow().hide()` and clear React state. No database write occurs.

**Reselect & Extract**: When the user selects a different task in the dropdown and clicks confirm, emit `task:manual-extract` with the new `taskId` and `force: false`.

**Force Insert**: When the user clicks force-insert, emit `task:manual-extract` with `force: true` and the currently selected `taskId` (which may be the failed task).

All actions SHALL apply the standard fade-out + hide lifecycle.

#### Scenario: Discard closes overlay silently
- **WHEN** user clicks discard in fallback mode
- **THEN** the overlay SHALL hide with fade-out animation and no extraction occurs

#### Scenario: Force insert emits with force flag
- **WHEN** user clicks force-insert in fallback mode
- **THEN** the overlay SHALL emit `task:manual-extract` with `force: true`

#### Scenario: Reselect emits with new task
- **WHEN** user switches task in dropdown and clicks confirm in fallback mode
- **THEN** the overlay SHALL emit `task:manual-extract` with the newly selected `taskId` and `force: false`

### Requirement: Normal mode dispatch button
In normal mode (no `fallback` field in payload), the overlay SHALL display a confirm/dispatch button. When the user selects a task and clicks dispatch, the overlay SHALL emit `task:manual-extract` with the selected `taskId`, `force: false`, and the captured text.

#### Scenario: Normal dispatch emits manual extract
- **WHEN** user selects a task and clicks dispatch in normal mode
- **THEN** the overlay SHALL emit `task:manual-extract` with `force: false` and the selected `taskId`
