## ADDED Requirements

### Requirement: Settings sidebar navigation

The settings page SHALL render a left sidebar containing navigation menu items for settings categories. The sidebar SHALL be rendered inside the settings page layout, not at the app root level.

#### Scenario: Sidebar renders with fixed width

- **WHEN** the settings page is rendered
- **THEN** a sidebar with width `w-64` is displayed on the left side
- **THEN** the sidebar has a right border (`border-r border-slate-200`)
- **THEN** the sidebar is independently scrollable (`overflow-y-auto`) with padding `p-4`

#### Scenario: Sidebar contains navigation items

- **WHEN** the sidebar is rendered
- **THEN** it contains a vertical list of navigation items
- **THEN** "AI 模型连接" is displayed as a navigation item

#### Scenario: Active navigation item is highlighted

- **WHEN** "AI 模型连接" is the current active section
- **THEN** it renders with `bg-white shadow-sm text-primary` and bold font weight
- **THEN** it is visually distinct from inactive items

#### Scenario: Sidebar displays active model name

- **WHEN** a model is currently active (`activeModel` is set)
- **THEN** the sidebar displays "当前使用模型：{modelName}" below the navigation item
- **THEN** the text uses `text-xs text-slate-500 truncate`

#### Scenario: Sidebar does not shrink

- **WHEN** the settings page layout is rendered
- **THEN** the sidebar uses `shrink-0` to prevent compression by the content area
