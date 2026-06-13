# Background Mode

## Purpose

Define the system tray resident background mode that keeps the app alive with global shortcut responsiveness when the main window is closed.

## Requirements

### Requirement: App stays alive when main window is closed
When the user closes the main window (via close button or Cmd+W/Ctrl+W), the Tauri app SHALL NOT terminate. The main window SHALL hide but the process SHALL continue running with the system tray icon visible and global shortcuts responsive.

#### Scenario: Close button hides window, doesn't quit
- **WHEN** the user clicks the close button on the main window
- **THEN** the main window hides, but the app process remains running and global shortcuts continue to work

#### Scenario: Tray icon visible in background mode
- **WHEN** the main window is hidden
- **THEN** the tray icon SHALL remain visible, indicating the app is still running

### Requirement: App quits via tray menu only
The application SHALL only terminate when the user explicitly clicks "退出" in the tray menu or presses Cmd+Q (macOS). Cmd+W (macOS) or Alt+F4 (Windows) SHALL only hide the window.

#### Scenario: Tray quit exits app
- **WHEN** the user clicks "退出" in the tray menu
- **THEN** the application process terminates cleanly with WAL checkpoint

### Requirement: GrabState accessible across windows
The `GrabState` managed in Tauri State SHALL be accessible from both the main window and the overlay window through request-scoped result consumption.

#### Scenario: GrabState shared across windows
- **WHEN** a grab is performed (from any shortcut, in any application context)
- **THEN** the backend stores the result envelope once and the intended consumer retrieves it with `consume_grabbed_result(request_id)` without racing unrelated windows

### Requirement: App shutdown uses a single cleanup path
The application SHALL unregister global shortcuts, checkpoint SQLite WAL, release event listeners, and clear temporary grab data from a single shutdown path.

#### Scenario: Quit path is deterministic
- **WHEN** the user quits via tray menu or Cmd+Q
- **THEN** all cleanup steps run once in the same order before process exit
