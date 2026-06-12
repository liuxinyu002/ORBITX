# Window Shell

## Purpose

Define the main window configuration, header component contract (fixed 40px height, platform-aware padding, context-aware content), and window state behavior.

## Requirements

### Requirement: Main window configuration
The main Tauri window SHALL be configured with the following parameters:

| Parameter | Value |
|-----------|-------|
| label | `"main"` |
| title | `"OrbitX"` |
| default width | 1280 |
| default height | 800 |
| minimum width | 1024 |
| minimum height | 700 |
| resizable | true |
| fullscreen | false |
| maximized | false (start non-maximized) |
| center | true |
| decorations | true (native title bar, Phase-1) |
| transparent | false |
| visible | true |
| create | false (window created via WebviewWindowBuilder in setup hook) |

#### Scenario: Window opens at default size
- **WHEN** the app launches for the first time
- **THEN** the window is 1280×800 pixels and centered on screen

#### Scenario: Window respects minimum size constraint
- **WHEN** the user attempts to resize the window below 1024×700
- **THEN** the window stops resizing at the minimum dimensions

### Requirement: Header 40px height contract
The frontend header component SHALL have a fixed height of 40px (`h-10` in Tailwind). This height SHALL NOT change in any future Phase. When the project later switches to `decorations: false` + custom title bar, the header height and layout below it SHALL remain unchanged.

#### Scenario: Header height is exactly 40px
- **WHEN** inspecting the rendered header element
- **THEN** its computed height is exactly 40px

### Requirement: Platform-aware header padding
The header SHALL apply platform-specific padding via CSS `data-platform` attribute selectors:

- **macOS** (`data-platform="macos"`): `padding-left: 80px` (traffic light clearance), standard `padding-right`
- **Windows** (`data-platform="windows"`): standard `padding-left`, `padding-right: 120px` (window control button clearance)

#### Scenario: macOS header has traffic light clearance
- **WHEN** the app runs on macOS
- **THEN** `<html data-platform="macos">` is set
- **THEN** the header content starts 80px from the left edge

#### Scenario: Windows header has control button clearance
- **WHEN** the app runs on Windows
- **THEN** `<html data-platform="windows">` is set
- **THEN** the header content ends 120px from the right edge

### Requirement: Header context-aware content
The header SHALL display different content based on the current route:

- **`/` (Dashboard)**: No back button, title displays "ORBITX"
- **Sub-pages** (`/tools/extractor`, `/settings`): Back button visible (hover: light gray rounded background), title displays the current page name

#### Scenario: Dashboard route shows brand title
- **WHEN** the current route is `/`
- **THEN** the header shows "ORBITX" without a back button

#### Scenario: Sub-page route shows back button and page name
- **WHEN** the current route is a sub-page (e.g., `/tools/extractor`)
- **THEN** the header shows a back button (← Lobby) and the page name

### Requirement: Window state not persisted across sessions
In Phase-1, the window SHALL always open at default size (1280×800) on launch. Window position/size persistence is NOT required in Phase-1.

#### Scenario: Second launch opens at default size
- **WHEN** the user resized the window in a previous session and relaunches
- **THEN** the window opens at 1280×800 (not the previous custom size)
