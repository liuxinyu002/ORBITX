## MODIFIED Requirements

### Requirement: Single-card tabbed settings layout

The `/settings` route SHALL render a two-panel layout with a left sidebar (w-64) and a right content area (flex-1 overflow-y-auto), replacing the previous single-card centered layout. Each provider (DeepSeek, OpenAI, 智谱 GLM, 自定义) SHALL have exactly one saved configuration.

#### Scenario: Settings page renders two-panel layout

- **WHEN** the user navigates to `/settings`
- **THEN** a horizontal flex container (`h-full flex`) fills the available height
- **THEN** the page background uses Warm Tinted Background (`bg-[#F3F4F7]`)
- **THEN** a left sidebar (w-64, border-r) and a right content area are displayed side by side
- **THEN** no Card, CardHeader, CardContent, or CardFooter component is present in the page

#### Scenario: Content area is scrollable

- **WHEN** the right content area content exceeds the viewport height
- **THEN** the content area scrolls independently (`overflow-y-auto`)
- **THEN** the sidebar remains fixed in position

#### Scenario: Content width constraint

- **WHEN** the settings page is rendered
- **THEN** the content area has padding `p-8 md:p-12`
- **THEN** an inner wrapper constrains content to `max-w-2xl`

### Requirement: Footer action bar

The settings page SHALL contain three action buttons at the bottom of the form, separated by a top border rather than inside a CardFooter.

#### Scenario: Button placement

- **WHEN** the action bar is rendered
- **THEN** it is wrapped in a container with `mt-12 pt-6 border-t border-slate-200`
- **THEN** "重置默认" is on the left side
- **THEN** "取消" and "保存并应用" are on the right side

#### Scenario: Button variants

- **WHEN** rendered
- **THEN** "重置默认" uses `variant="ghost"`
- **THEN** "取消" uses `variant="ghost"`
- **THEN** "保存并应用" uses `variant="default"` (Primary, Cool Slate)

### Requirement: Settings page title

The settings page SHALL display a page title as the header of the right content area.

#### Scenario: Title rendering

- **WHEN** the right content area is rendered
- **THEN** "AI 模型连接设置" is displayed as the page header
- **THEN** the title uses `text-2xl font-semibold`

## REMOVED Requirements

### Requirement: Card width constraint

**Reason**: Card component is removed; max-width constraint moved to inner content wrapper div.
**Migration**: Content area uses `<div className="max-w-4xl">` inside the scrollable right panel.
