# Capsule Overlay (Delta)

**UI 约束**: 本 spec 中所有 UI 实现必须遵循项目根目录 [DESIGN.md](../../../DESIGN.md) 的组件规范，包括但不限于：Cool Slate accent ≤5% 覆盖规则、所有交互元素覆盖 default/hover/focus/active/disabled 态、骨架屏优先于独立 spinner、禁止 `console.log`（使用 `log()` 桥接）。

**色彩约束**: 悬浮窗主卡片 `#FFFFFF`，底层承载区域 `#F7F8FA`，常规文字 `#111827`（暗色模式下通过 CSS 变量对应反转）。禁止在此视图使用渐变、玻璃态（`backdrop-blur`）或装饰性阴影。

**交互范式约束**: 降级模式下的"任务重新选择"与"强制入库"操作仅限在下拉列表（Dropdown）内通过选项切换+确认按钮完成，严禁在此视图链路中挂载全局弹窗（Modal）。

## Overlay 交互元素态表

所有按钮和交互控件必须覆盖以下态：

| 组件 | Default | Hover | Focus | Active | Disabled |
|------|---------|-------|-------|--------|----------|
| 派发按钮 | `bg-primary text-primary-foreground` | `bg-primary/80` | `ring-3 ring-ring/50` | `translate-y-px` | `opacity-50 cursor-not-allowed` |
| 丢弃按钮 | `variant="ghost"` | `bg-muted` | `ring-3 ring-ring/50` | `translate-y-px` | — |
| 强制入库 | `variant="destructive"` | `bg-destructive/20` | `ring-3 ring-destructive/20` | `translate-y-px` | — |
| 展开/折叠原文 | `variant="ghost" text-xs` | `bg-muted` | `ring-2 ring-ring/30` | — | — |
| 重试按钮 | `bg-primary text-primary-foreground` | `bg-primary/80` | `ring-3 ring-ring/50` | `translate-y-px` | — |
| 任务下拉项 | `bg-transparent` | `bg-accent text-accent-foreground` | `bg-accent` | — | `opacity-40 cursor-not-allowed` |
| 下拉 trigger | `bg-transparent border-border` | `bg-muted` | `ring-2 ring-ring/30` | — | `opacity-50` |

## MODIFIED Requirements

### Requirement: State rendering in capsule format
The capsule SHALL render one of five states in the left text zone:
1. **Skeleton**: pulsing placeholder (`bg-muted animate-pulse rounded h-5 w-3/4`)
2. **Content**: JS middle-truncated text in `--foreground` token color, sourced from `view:render-overlay` payload (text field)
3. **Empty**: `"未发现选中文本"` in `--muted-foreground` token color
4. **PermissionRequired**: `"请在系统设置中授权辅助功能"` with a retry button using the DESIGN.md primary token (`--primary`)
5. **Timeout**: toast notification, UI falls back to empty state

Each state SHALL replace the left zone content; the right zone and tool slots SHALL remain stable across state transitions.

The overlay SHALL transition from skeleton to content upon receiving the `view:render-overlay` event (replacing the removed `grab-completed`/`consume_grabbed_result` pattern).

#### Scenario: Skeleton shown immediately
- **WHEN** the overlay window first becomes visible
- **THEN** the left zone SHALL render a pulsing skeleton placeholder

#### Scenario: Content fills after view:render-overlay
- **WHEN** the overlay receives the `view:render-overlay` event with a `text` field
- **THEN** the left zone SHALL transition from skeleton to middle-truncated text

#### Scenario: Permission guidance in capsule
- **WHEN** `view:render-overlay` payload indicates accessibility denial context
- **THEN** the left zone SHALL display compact permission hint with retry button, and blur-auto-hide is suppressed

### Requirement: Task data refreshed on each overlay visibility cycle
The overlay SHALL invoke `list_tasks` each time a `view:render-overlay` event is received.

#### Scenario: Tasks reloaded on render event
- **WHEN** the overlay receives `view:render-overlay` event
- **THEN** the overlay SHALL invoke `list_tasks` before any other state transition

## ADDED Requirements

### Requirement: Fallback mode rendering
When the `view:render-overlay` payload includes a `fallback` field (`{ reason: string, failedTaskId: string }`), the overlay SHALL render fallback mode:

1. A warning indicator showing the rejection reason
2. The original captured text in a collapsed preview (default: `line-clamp-3`, approximately 80-100 characters), with a `▸ 展开原文` button to expand; if `truncated: true`, a gray suffix `... (内容受字符阈值限制已在抓取时截断)` SHALL be appended
3. The task dropdown with the `failedTaskId` task pre-selected as default and marked with a `⚠` indicator (NOT disabled or grayed out)
4. Three action buttons: force-insert, discard, and re-select (via dropdown + confirm)

#### Scenario: Fallback mode shows rejection reason
- **WHEN** overlay receives payload with `fallback.reason: "文本内容与任务定义不相关"`
- **THEN** the overlay SHALL display the reason text prominently

#### Scenario: Failed task pre-selected in dropdown
- **WHEN** overlay is in fallback mode with `failedTaskId: "task-123"`
- **THEN** the dropdown SHALL show "task-123" as the selected task with a `⚠` indicator beside its name

#### Scenario: Failed task not disabled
- **WHEN** overlay is in fallback mode
- **THEN** the `failedTaskId` task SHALL remain selectable in the dropdown with full interactivity

#### Scenario: Text preview collapsed by default
- **WHEN** fallback mode renders
- **THEN** the captured text SHALL display at most 3 lines via `line-clamp-3` with an expand button

#### Scenario: Truncated indicator shown
- **WHEN** fallback mode renders with `truncated: true` in the payload
- **THEN** a gray suffix note about character truncation SHALL be appended after the text

### Requirement: Fallback actions
In fallback mode, the overlay SHALL support three user actions:

**Discard**: When the user clicks discard, call `getCurrentWebviewWindow().hide()` and clear React state. No database write occurs.

**Reselect & Extract**: When the user selects a different task in the dropdown and clicks confirm, emit `task:manual-extract` with the new `taskId` and `force: false`.

**Force Insert**: When the user clicks force-insert, emit `task:manual-extract` with `force: true` and the currently selected `taskId` (which may be the failed task).

All actions SHALL apply the standard fade-out + hide lifecycle.

#### Scenario: Discard closes overlay silently
- **WHEN** user clicks discard in fallback mode
- **THEN** the overlay SHALL hide with fade-out animation and no extraction occurs

#### Scenario: Force insert emits with force flag
- **WHEN** user clicks force-insert in fallback mode
- **THEN** the overlay SHALL emit `task:manual-extract` with `force: true`

#### Scenario: Reselect emits with new task
- **WHEN** user switches task in dropdown and clicks confirm in fallback mode
- **THEN** the overlay SHALL emit `task:manual-extract` with the newly selected `taskId` and `force: false`

### Requirement: Normal mode dispatch button
In normal mode (no `fallback` field in payload), the overlay SHALL display a confirm/dispatch button. When the user selects a task and clicks dispatch, the overlay SHALL emit `task:manual-extract` with the selected `taskId`, `force: false`, and the captured text.

#### Scenario: Normal dispatch emits manual extract
- **WHEN** user selects a task and clicks dispatch in normal mode
- **THEN** the overlay SHALL emit `task:manual-extract` with `force: false` and the selected `taskId`
