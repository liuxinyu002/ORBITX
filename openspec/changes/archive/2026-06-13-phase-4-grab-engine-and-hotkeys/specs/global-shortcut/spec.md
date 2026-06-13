# Global Shortcut

## Purpose

Define the dual global shortcut system for silent text extraction and command palette invocation, using `tauri-plugin-global-shortcut`.

## ADDED Requirements

### Requirement: Global shortcut registration via Rust
The system SHALL register two global shortcuts at startup via `app.global_shortcut().register()` in Rust (not `tauri.conf.json` static config):

- Shortcut A: `CmdOrCtrl+Shift+E` — silent extraction (dispatch to active task)
- Shortcut B: `CmdOrCtrl+Shift+Space` — summon command palette (show overlay window)

Shortcut A SHALL be active when the app is in background mode. Shortcut B SHALL be active when the app is in background mode.

#### Scenario: Shortcut A triggers grab
- **WHEN** the user presses CmdOrCtrl+Shift+E in any application
- **THEN** the shortcut handler executes `GrabEngine::grab_selected_text()`, updates `GrabState`, emits `grab-completed` with `{ source: "shortcut-a" }`

#### Scenario: Shortcut B triggers overlay
- **WHEN** the user presses CmdOrCtrl+Shift+Space in any application
- **THEN** the shortcut handler executes `GrabEngine::grab_selected_text()`, updates `GrabState`, emits `grab-completed` with `{ requestId, source: "shortcut-b" }`, and only then shows the overlay in a way that does not steal focus before the grab completes

#### Scenario: Shortcuts hardcoded in Phase 4
- **WHEN** reviewing the shortcut registration code
- **THEN** the key combinations SHALL be defined as `const DEFAULT_SHORTCUT_A` and `const DEFAULT_SHORTCUT_B` in a Rust module constants section

### Requirement: Shortcut handler runs in async context
The shortcut callback SHALL immediately spawn an async task via `tauri::async_runtime::spawn` and delegate all system API calls to `tokio::task::spawn_blocking`. This prevents blocking the Tauri main thread or the OS-level hotkey hook queue.

#### Scenario: Grab runs on blocking thread
- **WHEN** a shortcut fires
- **THEN** the `grab_selected_text` call SHALL execute on a `spawn_blocking` thread, NOT the main thread or the hotkey callback thread

#### Scenario: Non-blocking handler returns immediately
- **WHEN** the shortcut callback is invoked
- **THEN** the callback SHALL return control to the OS within microseconds, before the grab completes

### Requirement: Shortcut debounce and in-flight gating
The system SHALL process only `Pressed` events and SHALL ignore `Released` or auto-repeat notifications. Each shortcut SHALL maintain an independent in-flight flag and a minimum debounce interval.

#### Scenario: Repeated keypresses do not enqueue overlapping grabs
- **WHEN** the user rapidly presses the same shortcut multiple times
- **THEN** the system runs at most one grab task for that shortcut at a time

### Requirement: Shortcuts are explicitly unregistered on shutdown
The system SHALL unregister all registered shortcuts during the app shutdown path before process exit.

#### Scenario: Tray quit releases hotkeys
- **WHEN** the user quits via tray menu or Cmd+Q
- **THEN** all hotkeys are unregistered before the process terminates

### Requirement: Shortcut keys defined as constants
The system SHALL define shortcut key combinations as Rust constants:
- `const SHORTCUT_SILENT_EXTRACT: &str = "CmdOrCtrl+Shift+E"`
- `const SHORTCUT_COMMAND_PALETTE: &str = "CmdOrCtrl+Shift+Space"`

These constants SHALL be used in the `register()` call and referenced from any logging/status display.

#### Scenario: Constants used for registration
- **WHEN** the app starts up
- **THEN** both shortcuts are registered using the constant values
