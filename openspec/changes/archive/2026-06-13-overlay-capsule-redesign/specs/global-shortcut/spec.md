# Global Shortcut (Delta)

## MODIFIED Requirements

### Requirement: Shortcut B triggers overlay
When the user presses CmdOrCtrl+Shift+Space in any application, the shortcut handler SHALL:
1. Execute `GrabEngine::grab_selected_text()` in `spawn_blocking`
2. Update `GrabState`
3. Emit `grab-completed` with `{ requestId, source: "shortcut-b" }`
4. Capture the global mouse cursor position using platform-specific API
5. Reset overlay window size to collapsed (480×48) via `set_size()`
6. Compute overlay target position (smart flip: 20px below cursor, or above if insufficient space; window dimensions 480×48)
7. Call `set_position()` on the overlay window
8. Show the overlay window in a way that does not steal focus before the grab completes

#### Scenario: Shortcut B triggers grab then positions overlay
- **WHEN** the user presses CmdOrCtrl+Shift+Space
- **THEN** the shortcut handler executes grab, resets window to 480×48, captures cursor position, positions the overlay near cursor, and shows it
- **THEN** the overlay position and size are set BEFORE showing the window to avoid visual flicker

#### Scenario: Shortcut B positioning does not block grab pipeline
- **WHEN** the shortcut B fires
- **THEN** the cursor capture, window resize, and window positioning SHALL happen in the async task alongside the grab, not blocking the hotkey callback

#### Scenario: Window always resets to collapsed on show
- **WHEN** shortcut B is pressed after a previous session where the dropdown was opened
- **THEN** the overlay SHALL appear at the collapsed 48px height, not the previous expanded height
