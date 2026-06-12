# System Tray

## Purpose

Define the system tray icon, right-click menu topology, managed state for dynamic menu items, and tray event handling for OrbitX.

## Requirements

### Requirement: System tray icon present on launch
The app SHALL display a system tray icon upon launch. The icon SHALL be visible in both macOS menu bar and Windows system notification area.

#### Scenario: Tray icon visible after launch
- **WHEN** the app starts
- **THEN** a tray icon appears in the system tray area

### Requirement: Complete tray menu topology
The right-click tray menu SHALL contain all items defined in the full menu topology, with future-phase items visually gray-disabled:

1. **显示主窗口** — enabled, shows/focuses the main window
2. **全局设置** — disabled (Phase-2)
3. **静默提取: 已就绪** — disabled (Phase-5)
4. **当前任务: 无** — disabled (Phase-5)
5. --- (separator) ---
6. **关于 OrbitX** — enabled, shows app info
7. **退出** — enabled, quits the app (+ Cmd+Q on macOS)

#### Scenario: Right-click shows full menu
- **WHEN** the user right-clicks the tray icon
- **THEN** all 7 items (including disabled ones) appear in the menu

#### Scenario: Disabled items appear gray
- **WHEN** viewing the tray menu
- **THEN** items 2, 3, 4 (global settings, silent extract, current task) are grayed out and not clickable

#### Scenario: Show main window brings window to front
- **WHEN** the user clicks "显示主窗口"
- **THEN** the main window is shown and focused

#### Scenario: Quit exits the application
- **WHEN** the user clicks "退出"
- **THEN** the application process terminates cleanly

### Requirement: MenuItem references stored in Managed State
Menu items that require runtime updates (items 3 and 4: silent extract status, current task name) SHALL have their `MenuItem` references stored in a `TrayMenuRefs` struct registered in Tauri Managed State. Updates SHALL be performed by calling `.set_text()` on the cloned reference directly — no event bus.

#### Scenario: TrayMenuRefs accessible from commands
- **WHEN** a future Phase command needs to update a tray menu item text
- **THEN** it accesses `State<'_, TrayMenuRefs>`, retrieves the `MenuItem` reference, and calls `.set_text()`

### Requirement: Tray menu manager Rust module
The tray logic SHALL be encapsulated in a `src-tauri/src/tray/` module containing at minimum:
- A menu builder function (`build_tray_menu()`) that constructs the full `TrayMenu` topology
- A `TrayMenuRefs` struct holding `MenuItem` references for dynamic items (menu items 3, 4)
- A menu event handler that processes click events and dispatches actions

#### Scenario: Tray module is self-contained
- **WHEN** reviewing the tray implementation
- **THEN** all tray-related code resides in `src-tauri/src/tray/` with no business logic in `main.rs`
