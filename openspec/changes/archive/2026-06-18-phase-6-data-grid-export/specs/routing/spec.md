# Routing

## Purpose

Update the React Router v7 route tree to reflect the structured-extractor directory restructure.

## MODIFIED Requirements

### Requirement: Nested React Router directory tree
The frontend routing SHALL use React Router v7 with a nested directory tree structure:

```
src/routes/
├── __root.tsx           # Root layout: Header (h-10) + <Outlet />
├── dashboard.tsx         # / → Dashboard (Tool Lobby)
├── tools/
│   └── structured-extractor/
│       ├── index.tsx              # /tools/extractor → Extractor interior
│       ├── components/
│       │   ├── SchemaEditor.tsx   # Field config tab
│       │   └── DataBrowser.tsx    # Data grid tab
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
- **THEN** the Structured Extractor component renders with Tabs (Schema Editor + Data Browser)

#### Scenario: Settings route
- **WHEN** navigating to `/settings`
- **THEN** the Settings component renders
