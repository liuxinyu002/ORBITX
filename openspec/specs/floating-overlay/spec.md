# Floating Overlay

## Purpose

Define the independent webview overlay window for the command palette (Phase 4 shell, Phase 5 business logic).

## Requirements

### Requirement: Overlay window pre-loaded in tauri.conf.json
The overlay window SHALL be declared in `tauri.conf.json` with the following configuration and SHALL NOT be dynamically created with `WebviewWindowBuilder` on each shortcut press:

```json
{
      "label": "overlay",
      "url": "/overlay",
      "visible": false,
      "decorations": false,
      "transparent": false,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "center": true,
  "width": 760,
  "height": 480,
  "resizable": false
}
```

The window SHALL have permission to be controlled by Rust commands (`.show()`, `.hide()`, `.set_focus()`) via the capabilities configuration.

#### Scenario: Overlay hidden at app launch
- **WHEN** the app starts
- **THEN** the overlay window exists but is not visible

#### Scenario: Overlay shown on shortcut B
- **WHEN** shortcut B is pressed
- **THEN** the overlay window appears centered on screen within milliseconds (no creation overhead) without invalidating the selection that is being grabbed

#### Scenario: Overlay always on top
- **WHEN** the overlay is visible
- **THEN** it SHALL remain above other application windows

### Requirement: Skeleton-to-content transition
The overlay frontend SHALL render a skeleton state immediately on mount, then transition to content state when `grab-completed` event is received and text is successfully pulled via `invoke("consume_grabbed_result", { requestId })`.

The UI layout SHALL follow Direction A (segmented):
- Top section: command input box placeholder (preparation for Phase 5)
- Divider
- Bottom section: grabbed text preview area

States:
1. **Skeleton**: blinking placeholder blocks in preview area, command input disabled with placeholder text
2. **Content**: grabbed text displayed in preview area
3. **Empty**: "未发现选中文本" message when grab returns NoSelection or UnsupportedElement

#### Scenario: Skeleton shown immediately
- **WHEN** the overlay window first becomes visible
- **THEN** the skeleton placeholder blocks SHALL render before any grab result arrives

#### Scenario: Content fills after grab completes
- **WHEN** the `grab-completed` event fires and `consume_grabbed_result(requestId)` returns text
- **THEN** the preview area SHALL transition from skeleton to showing the grabbed text

#### Scenario: Empty state shown on no selection
- **WHEN** `consume_grabbed_result(requestId)` returns `NoSelection`
- **THEN** the preview area SHALL display "未发现选中文本"

### Requirement: Overlay close via Esc key
The overlay SHALL hide when the user presses the Escape key. This behavior SHALL be implemented in the React frontend via a `keydown` event listener that calls `getCurrentWebviewWindow().hide()`.

#### Scenario: Esc hides overlay
- **WHEN** the overlay is visible and the user presses Escape
- **THEN** `getCurrentWebviewWindow().hide()` is called and the overlay disappears

#### Scenario: Esc listener cleanup
- **WHEN** the overlay component unmounts
- **THEN** the keydown event listener SHALL be removed

### Requirement: Event listeners are Strict Mode safe
The overlay frontend SHALL tolerate React Strict Mode double mount in development. Any Tauri `listen()` registration SHALL be awaited and cleaned up exactly once, even if the component mounts, unmounts, and mounts again immediately.

#### Scenario: Strict Mode does not duplicate `grab-completed` handlers
- **WHEN** the overlay route mounts under React Strict Mode
- **THEN** there is at most one active `grab-completed` listener after the final mount settles

### Requirement: Overlay hide on focus loss (Rust side)
The overlay SHALL hide when the window loses focus. This behavior SHALL be implemented in Rust via `overlay_window.on_window_event(Focused(false))` during the setup phase.

#### Scenario: Blur hides overlay
- **WHEN** the overlay loses focus (user clicks another app, taskbar, etc.)
- **THEN** the overlay window is hidden

#### Scenario: Permission guidance suppresses blur auto-hide
- **WHEN** the overlay is showing Accessibility/UIA permission guidance
- **THEN** blur auto-hide is temporarily suspended until the guidance flow completes or the user dismisses it

### Requirement: Overlay route registered in frontend
The React router SHALL register a route at `/overlay` that renders the overlay page component (`src/routes/overlay.tsx`). This route SHALL NOT use the root layout (no header, no sidebar).

#### Scenario: Overlay route accessible
- **WHEN** navigating to `/#/overlay`
- **THEN** the overlay component renders without the main app header/sidebar chrome

### Requirement: Overlay route is isolated from network-capable providers
The overlay route SHALL mount only the minimal UI/IPC providers required for Phase 4. It SHALL NOT inherit providers that can initiate remote model calls, connection tests, or telemetry.

#### Scenario: Overlay remains island-local
- **WHEN** the overlay route is rendered
- **THEN** no network-capable provider is initialized as part of that route
