# Settings UI

## Purpose

Define the settings page user interface for AI model connection configuration. Covers the two-panel sidebar + content layout, segmented control, dynamic form fields, model chip multi-select, connection test bar, footer action bar with border-t separator, and state buffer for cross-tab persistence.

## Requirements

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

### Requirement: Segmented control (Button Group tabs)
The card SHALL contain a 4-segment Button Group for provider switching.

#### Scenario: Active tab styled as primary
- **WHEN** a provider tab is active
- **THEN** it renders with `bg-primary text-primary-foreground` (Cool Slate)
- **THEN** the adjacent inactive tabs render with `variant="ghost"`

#### Scenario: Tab group uses rounded-lg corners
- **WHEN** the segmented control is rendered
- **THEN** the outer corners are `rounded-lg` (8px max, per DESIGN.md)
- **THEN** no full-rounded pill style is used

#### Scenario: Tab group has a subtle ring
- **WHEN** the segmented control is rendered
- **THEN** the container has `ring-1 ring-foreground/10`

### Requirement: Dynamic form fields per provider
The card body SHALL display the following fields for the active provider tab:

- **配置别名** (text input) — custom display name for this provider
- **API 密钥** (password input with eye toggle) — API key, masked by default
- **接口代理地址** (text input) — Base URL, pre-filled for preset providers, empty for custom
- **启用模型** (chip multi-select + manual input) — selected model IDs

#### Scenario: DeepSeek tab pre-fills base URL
- **WHEN** the DeepSeek tab is active
- **THEN** `base_url` is pre-filled with `https://api.deepseek.com/v1`
- **THEN** `api_key` is empty (user must provide)

#### Scenario: Custom tab has empty defaults
- **WHEN** the Custom tab is active
- **THEN** all fields are empty
- **THEN** `base_url` has placeholder text `http://localhost:11434/v1`

#### Scenario: API key visibility toggle
- **WHEN** viewing the API key field
- **THEN** the key is displayed as masked dots (password type)
- **THEN** an eye icon button toggles between masked and plain text

### Requirement: Model chip multi-select
The form SHALL display 3-5 common model chips per provider that can be toggled on/off, plus a small text input for adding custom model IDs.

#### Scenario: Chip selected state
- **WHEN** a model chip is selected
- **THEN** it renders with `bg-primary/10 text-primary ring-1 ring-primary/30`
- **THEN** a small × button allows deselection

#### Scenario: Chip unselected state
- **WHEN** a model chip is not selected
- **THEN** it renders with `bg-muted text-muted-foreground`
- **THEN** clicking it toggles it to selected state

#### Scenario: Manual model input
- **WHEN** the user types a model ID in the small text input and presses Enter or blurs
- **THEN** the model ID is appended to the selected modelIds array
- **THEN** the input clears for the next entry

### Requirement: Connection test bar
A connection test bar SHALL be displayed between the form and the footer, always visible to prevent layout shift.

#### Scenario: Status indicator states
- **WHEN** no test has been run → gray dot (`bg-muted-foreground/30`), text "未检测"
- **WHEN** a test is in progress → yellow pulsing dot (`bg-yellow-500 animate-pulse`), text "测试中..."
- **WHEN** a test succeeded → green dot (`bg-green-500`), text "连接成功 {latency}ms"
- **WHEN** a test failed → red dot (`bg-destructive`), text with error message

#### Scenario: Test button with empty API key
- **WHEN** the API key field is empty and user clicks "测试连接"
- **THEN** a toast message "请先填写 API 密钥" is shown
- **THEN** no network request is made

#### Scenario: Test result auto-clears
- **WHEN** a test result is displayed
- **THEN** it clears automatically after 10 seconds
- **THEN** the indicator returns to "未检测" state

### Requirement: Settings page title

The settings page SHALL display a page title as the header of the right content area.

#### Scenario: Title rendering

- **WHEN** the right content area is rendered
- **THEN** "AI 模型连接设置" is displayed as the page header
- **THEN** the title uses `text-2xl font-semibold`

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

### Requirement: State buffer for cross-tab persistence
The settings page SHALL maintain a local `configData` state object that buffers all providers' form data, preventing data loss when switching tabs.

#### Scenario: Tab switch saves current form to buffer
- **WHEN** the user switches from one tab to another
- **THEN** the current tab's form values are saved into the buffer before loading the new tab's data
- **THEN** the new tab's form fields populate from the buffer

#### Scenario: Save persists buffer to backend
- **WHEN** the user clicks "保存并应用"
- **THEN** the modified provider configs from the buffer are persisted via `save_model_config`
- **THEN** the saved config becomes the active model

#### Scenario: Reset restores only current tab
- **WHEN** the user clicks "重置默认"
- **THEN** only the current active tab's form is restored to its provider preset defaults
- **THEN** other tabs' data in the buffer remain unchanged

#### Scenario: Cancel discards all unsaved changes
- **WHEN** the user clicks "取消"
- **THEN** the buffer is restored to the snapshot taken at page load

#### Scenario: Page load initializes buffer from backend
- **WHEN** the settings page loads
- **THEN** saved configs are fetched from the backend and populated into the buffer by provider
- **THEN** providers without saved configs use preset defaults
