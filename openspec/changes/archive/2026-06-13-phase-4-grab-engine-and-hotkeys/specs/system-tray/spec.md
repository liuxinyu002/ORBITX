# System Tray (Delta)

## MODIFIED Requirements

### Requirement: Complete tray menu topology
The right-click tray menu SHALL contain all items defined in the full menu topology:

1. **显示主窗口** — enabled, shows/focuses the main window
2. **全局设置** — enabled, navigates to settings page (Phase 2 complete)
3. **静默提取: 已注册** — enabled, displays current shortcut A registration status. When shortcuts fail to register, displays "静默提取: 未注册"
4. **当前任务: 无** — disabled (Phase 5)
5. --- (separator) ---
6. **关于 OrbitX** — enabled, shows app info
7. **退出** — enabled, quits the app (+ Cmd+Q on macOS)

Items 2 (全局设置) and 3 (静默提取状态) SHALL be enabled and reflect their actual state. Item 3 SHALL be dynamically updated via `TrayMenuRefs` managed state when shortcut registration succeeds or fails at startup.

#### Scenario: Right-click shows full menu
- **WHEN** the user right-clicks the tray icon
- **THEN** all 7 items appear in the menu

#### Scenario: Shortcut status reflects registration
- **WHEN** shortcuts are successfully registered at startup
- **THEN** item 3 displays "静默提取: 已注册"

#### Scenario: Shortcut registration failure reflected
- **WHEN** shortcut registration fails at startup
- **THEN** item 3 displays "静默提取: 未注册"

#### Scenario: Show main window brings window to front
- **WHEN** the user clicks "显示主窗口"
- **THEN** the main window is shown and focused

#### Scenario: Global settings navigates to settings
- **WHEN** the user clicks "全局设置"
- **THEN** the main window is shown and navigated to the settings page

#### Scenario: Quit exits the application
- **WHEN** the user clicks "退出"
- **THEN** the application process terminates cleanly
