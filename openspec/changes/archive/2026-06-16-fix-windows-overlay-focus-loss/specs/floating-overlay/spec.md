## MODIFIED Requirements

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

#### Scenario: Cursor position uses platform API with DPI consistency
- **WHEN** the shortcut B fires on macOS
- **THEN** cursor position SHALL be obtained via `NSEvent.mouseLocation` with Y-axis flipped using `NSScreen.mainScreen.frame`
- **WHEN** the shortcut B fires on Windows
- **THEN** cursor position SHALL be obtained via `GetCursorPos` and converted from physical pixels to logical pixels using `GetDpiForMonitor(MDT_EFFECTIVE_DPI)` before passing to `compute_overlay_position`，确保与 `set_size`/`set_position` 使用统一的逻辑坐标空间

### Requirement: Overlay hide on focus loss (Rust side)

The overlay SHALL hide when the window loses focus, with a 400ms debounce delay to prevent transient focus loss from triggering false hides. This behavior SHALL be implemented in Rust via `overlay_window.on_window_event(Focused(false))` during the setup phase.

When `Focused(false)` fires, the handler SHALL:
1. Skip immediately if the overlay is not currently visible (`is_visible() == false`)
2. Skip immediately if the overlay is in permission guidance state (`OverlayPermissionState` is true)
3. Otherwise, wait 400ms via `tokio::time::sleep`, then re-check `is_visible()` and `is_focused()`. If the overlay is still visible AND still unfocused after the delay, hide it. If focus was restored during the delay, cancel the hide.

#### Scenario: Blur hides overlay after debounce
- **WHEN** the overlay loses focus (user clicks another app, taskbar, etc.) and remains unfocused for 400ms
- **THEN** the overlay window is hidden

#### Scenario: Transient focus loss does not hide overlay
- **WHEN** the overlay briefly loses then regains focus within 400ms (e.g., Windows foreground permission handoff via `AllowSetForegroundWindow`)
- **THEN** the overlay window remains visible

#### Scenario: Permission guidance suppresses blur auto-hide
- **WHEN** the overlay is showing Accessibility/UIA permission guidance
- **THEN** blur auto-hide is temporarily suspended until the guidance flow completes or the user dismisses it
