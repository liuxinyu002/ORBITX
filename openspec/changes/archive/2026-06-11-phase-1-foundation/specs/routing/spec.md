## ADDED Requirements

### Requirement: Nested React Router directory tree
The frontend routing SHALL use React Router v7 with a nested directory tree structure:

```
src/routes/
├── __root.tsx           # Root layout: Header (h-10) + <Outlet />
├── dashboard.tsx         # / → Dashboard (Tool Lobby)
├── tools/
│   └── structured-extractor.tsx  # /tools/extractor → Extractor interior
└── settings.tsx          # /settings → Global Settings
```

#### Scenario: Root layout wraps all pages
- **WHEN** navigating to any route
- **THEN** the Header (40px) is rendered above the page content
- **THEN** the page content renders inside the `<Outlet />`

#### Scenario: Dashboard is the index route
- **WHEN** navigating to `/`
- **THEN** the Dashboard component renders

#### Scenario: Tool interior route
- **WHEN** navigating to `/tools/extractor`
- **THEN** the Structured Extractor component renders

#### Scenario: Settings route
- **WHEN** navigating to `/settings`
- **THEN** the Settings component renders

### Requirement: Header as navigation and breadcrumbs carrier
The `__root.tsx` layout SHALL render the Header component which SHALL display:
- Context-aware breadcrumbs based on current route (see window-shell spec)
- Dashboard route: no back button, brand title "ORBITX"
- Sub-page routes: back button + dynamic page title

#### Scenario: Back button navigates to Dashboard
- **WHEN** the user clicks the back button (← Lobby) on a sub-page
- **THEN** the app navigates to `/` (Dashboard)

### Requirement: React Error Boundary for render crash protection
The `__root.tsx` layout route SHALL wrap `<Outlet />` in a React Error Boundary component (`src/components/ErrorBoundary.tsx`). When a descendant component throws an uncaught rendering error, the Error Boundary SHALL catch it and render a fallback UI instead of allowing the Tauri webview to go blank.

The fallback UI SHALL:
- Display the Header (40px) at the top — tray menu remains the primary exit path
- Show centered text: "应用遇到问题" as title, "请通过系统托盘退出并重启应用" as description
- NOT display raw error details or stack traces

The Error Boundary SHALL be implemented as a React class component (the only way to implement `componentDidCatch`).

#### Scenario: Child component crashes, fallback UI shown
- **WHEN** a route component throws an uncaught render error
- **THEN** the fallback UI replaces only the crashed subtree
- **THEN** the Header and system tray remain functional
- **THEN** the user can exit gracefully via tray menu

#### Scenario: Error Boundary itself does not crash
- **WHEN** the Error Boundary itself throws during rendering
- **THEN** the app falls back to Tauri's native error behavior (blank webview)
- **THEN** the system tray menu still works (it lives in Rust, not React)

### Requirement: Router integration with Tauri
The application SHALL use `MemoryRouter` or `HashRouter` (not `BrowserRouter`) to avoid server-side URL handling conflicts in Tauri's webview context.

#### Scenario: Direct URL access does not trigger 404
- **WHEN** the app is running in Tauri's webview
- **THEN** route navigation works without server-side fallback
