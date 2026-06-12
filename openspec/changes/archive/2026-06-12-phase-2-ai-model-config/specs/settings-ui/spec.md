## ADDED Requirements

### Requirement: Single-card tabbed settings layout
The `/settings` route SHALL render a single card (`max-w-4xl`, centered) with a two-column layout (credentials left, model management right) and tabbed provider switching, replacing the Phase-1 placeholder. Each provider (DeepSeek, OpenAI, 智谱 GLM, 自定义) SHALL have exactly one saved configuration.

#### Scenario: Settings page renders single card
- **WHEN** the user navigates to `/settings`
- **THEN** a single card titled "AI 模型连接设置" with subtitle "配置您的 API 密钥以启用智能功能" is displayed
- **THEN** a 4-segment Button Group (DeepSeek / OpenAI / 智谱 GLM / 自定义) appears below the header
- **THEN** the form for the active tab is displayed in the card body

#### Scenario: Card width constraint
- **WHEN** the settings page is rendered
- **THEN** the card width is constrained to `max-w-4xl` and centered horizontally

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

### Requirement: Footer action bar
The card footer SHALL contain three action buttons.

#### Scenario: Button placement
- **WHEN** the card footer is rendered
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
