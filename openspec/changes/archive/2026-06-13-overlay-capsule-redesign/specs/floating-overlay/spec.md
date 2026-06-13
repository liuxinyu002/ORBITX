# Floating Overlay (Delta)

## MODIFIED Requirements

### Requirement: Overlay window pre-loaded in tauri.conf.json
The overlay window SHALL be declared in `tauri.conf.json` with the following configuration and SHALL NOT be dynamically created with `WebviewWindowBuilder` on each shortcut press:

```json
{
      "label": "overlay",
      "url": "/overlay",
      "visible": false,
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "center": false,
      "width": 480,
      "height": 48,
      "resizable": false,
      "shadow": false
}
```

The window SHALL have permission to be controlled by Rust commands (`.show()`, `.hide()`, `.set_focus()`, `.set_position()`, `.set_size()`) via the capabilities configuration.

#### Scenario: Overlay hidden at app launch
- **WHEN** the app starts
- **THEN** the overlay window exists but is not visible

#### Scenario: Overlay shown on shortcut B
- **WHEN** shortcut B is pressed
- **THEN** the overlay window appears near the mouse cursor within milliseconds (no creation overhead) without invalidating the selection being grabbed
- **THEN** the window height is reset to 48px (collapsed) before show

#### Scenario: Overlay always on top
- **WHEN** the overlay is visible
- **THEN** it SHALL remain above other application windows

### Requirement: Skeleton-to-content transition
The overlay frontend SHALL render a capsule skeleton state immediately on mount, then transition to content state when `grab-completed` event is received and text is successfully pulled via `invoke("consume_grabbed_result", { requestId })`.

The UI layout SHALL follow the horizontal capsule toolbar design:
- Left zone (flex-1, min-w:0): JS middle-truncated grabbed text with `*` marker
- Right zone (max-w:120px): active task indicator with dropdown trigger
- Additional slots: future tool placeholders (monochrome icons, opacity 0.4)

States:
1. **Skeleton**: pulsing placeholder in the text area, task zone shows last-known state or "选择任务"
2. **Content**: grabbed text displayed with JS middle truncation in left zone
3. **Empty**: muted hint text in left zone when grab returns NoSelection or UnsupportedElement
4. **PermissionRequired**: compact permission guidance with retry button

#### Scenario: Skeleton shown immediately
- **WHEN** the overlay window first becomes visible
- **THEN** the capsule skeleton SHALL render before any grab result arrives

#### Scenario: Content fills after grab completes
- **WHEN** the `grab-completed` event fires and `consume_grabbed_result(requestId)` returns text
- **THEN** the left zone SHALL transition from skeleton to showing the middle-truncated text

#### Scenario: Empty state shown on no selection
- **WHEN** `consume_grabbed_result(requestId)` returns `NoSelection`
- **THEN** the left zone SHALL display a muted empty hint

## ADDED Requirements

### Requirement: Window native shadow disabled
The overlay window SHALL disable native OS window shadow via `set_shadow(false)` after construction in Rust. Visual boundary SHALL be provided by capsule CSS `border: 1px solid` + `--border` token with an ultra-subtle `box-shadow: 0 1px 3px rgba(0,0,0,0.05)`.

#### Scenario: Native shadow off, CSS border on
- **WHEN** the overlay window is shown
- **THEN** the OS window has no native shadow, and the capsule element renders a solid border and subtle CSS box-shadow

### Requirement: Window positioned near cursor with smart flip
When the overlay is shown via shortcut B, the Rust handler SHALL first capture the global mouse cursor position, compute target coordinates near the cursor (20px below, horizontally centered relative to cursor), and call `set_position()` before `.show()`. If the space below the cursor is insufficient (cursor_y + 48px + 20px > screen_height), the window SHALL be placed above the cursor instead (cursor_y - 48px - 20px).

Window dimensions for positioning: 480×48 (collapsed).

#### Scenario: Overlay placed below cursor when room exists
- **WHEN** the cursor position allows the 48px window to fit below on screen
- **THEN** the overlay SHALL appear 20px below the cursor, horizontally centered (cursor_x - 240)

#### Scenario: Overlay flipped above cursor when no room below
- **WHEN** the cursor is near the bottom of the screen (cursor_y + 68px > screen_height)
- **THEN** the overlay SHALL appear above the cursor (cursor_y - 48px - 20px)

#### Scenario: Horizontal boundary clamp
- **WHEN** cursor_x - 240 < 0
- **THEN** window x SHALL be clamped to 0
- **WHEN** cursor_x + 240 > screen_width
- **THEN** window x SHALL be clamped to screen_width - 480

#### Scenario: Cursor position uses platform API
- **WHEN** the shortcut B fires on macOS
- **THEN** cursor position SHALL be obtained via `NSEvent.mouseLocation` with Y-axis flipped using `NSScreen.mainScreen.frame`
- **WHEN** the shortcut B fires on Windows
- **THEN** cursor position SHALL be obtained via `GetCursorPos` (no Y-flip needed)

### Requirement: Dynamic window resize for dropdown
The overlay window SHALL support runtime height changes via `WebviewWindow.setSize()` from the frontend, expanding when the task dropdown opens and collapsing back to 48px when the dropdown closes (after fade-out animation completes via `onTransitionEnd`).

#### Scenario: Window expands for dropdown
- **WHEN** the task button is clicked to open the dropdown
- **THEN** the window height SHALL increase from 48px to accommodate the dropdown list

#### Scenario: Window collapses after dropdown closes
- **WHEN** the dropdown close animation fires `onTransitionEnd`
- **THEN** the window height SHALL be set back to 48px

#### Scenario: Window reset on each show
- **WHEN** shortcut B triggers overlay display
- **THEN** the Rust handler SHALL call `set_size(LogicalSize::new(480.0, 48.0))` before `.show()` to ensure collapsed dimensions
