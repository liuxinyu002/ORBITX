## MODIFIED Requirements

### Requirement: Windows grab via UI Automation

The Windows implementation SHALL use the official `windows` crate (`windows::Win32::UI::Accessibility`). COM initialization (`CoInitializeEx`) SHALL run inside `spawn_blocking` to ensure thread safety.

The call chain SHALL be a multi-level strategy:

**Level 1 — Direct extraction:**
1. `CUIAutomation::new()` → UIA client
2. `GetFocusedElement()` → focused element
3. `GetCurrentPattern(UIA_TextPatternId)` → text pattern
4. `GetSelection()` → selection array; if empty → `NoSelection`
5. `selection[0].GetText(max_length)` → text; if non-empty and non-whitespace → return

**Level 2 — TreeWalker fallback (new):**
6. If the Level 1 result passes `should_activate_treewalker` (i.e. is `UnsupportedElement` or empty/whitespace-only text) → acquire `ControlViewWalker` from UIA client. Results that do NOT trigger TreeWalker include `NoSelection`, `System`, `AccessibilityDenied`, `ClipboardTimeout`, `ClipboardLockFailed`, `Internal`, and any non-empty text — these are returned directly from Level 1.
7. Depth-first traverse child elements from the focused element using `GetFirstChildElement` / `GetNextSiblingElement`; the focused element itself is visited as node 1 before descending into children
8. For each visited node: check `GetCurrentPattern(UIA_TextPatternId)`, then `GetSelection()`, then `GetText(max_length)`
9. Return text from the first matching node; stop traversal immediately
10. Enforce `MAX_TREEWALKER_NODES` (500) hard limit; if exhausted → `UnsupportedElement`

HRESULT errors SHALL be mapped via a private `fn map_uia_error(err: windows::core::Error) -> GrabError`.
COM initialization and cleanup SHALL be paired inside the same blocking thread via an RAII guard. UIA interfaces SHALL NOT be stored in Tauri State or moved across threads.

#### Scenario: Selected text successfully grabbed on Windows via Level 1

- **WHEN** a user selects text in a supported Windows app (e.g., Notepad) and presses the shortcut
- **THEN** Level 1 (direct GetFocusedElement) SHALL succeed; TreeWalker SHALL NOT be invoked

#### Scenario: Selected text grabbed via TreeWalker from child node

- **WHEN** a user selects text in an Electron/Chromium app (e.g., WeChat) where the focused element lacks TextPattern, and presses the shortcut
- **THEN** Level 1 SHALL return `UnsupportedElement`; Level 2 TreeWalker SHALL traverse child nodes and return the selected text from the first text-bearing node

#### Scenario: Control does not support TextPattern at any level

- **WHEN** the focused control and all traversed descendants (up to 500 nodes) do not support `UIA_TextPatternId`
- **THEN** the engine SHALL return `GrabError::UnsupportedElement`
