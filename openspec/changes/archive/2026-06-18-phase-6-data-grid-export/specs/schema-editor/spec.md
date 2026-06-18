# Schema Editor

## Purpose

Update the Schema Editor to coexist with the new Data Browser tab inside a Tabs component, and restructure the route from a single file to a directory with separated concerns.

## MODIFIED Requirements

### Requirement: 可视化表单编辑器布局
Schema 编辑器 SHALL 采用表格行式布局：

```
[Header Row]    字段名 | 类型 | 必填 | 说明 | 操作
[Field Row 1]   [input] [Button+Dropdown] [switch] [input] [delete btn]
[Field Row 2]   [input] [Button+Dropdown] [switch] [input] [delete btn]
...
[Add Field Button]
```

The Schema Editor SHALL reside inside a Shadcn `Tabs` component with two tabs: "字段配置" (Schema Editor) and "数据浏览" (Data Browser). The Tabs state SHALL default to `"schema"`.

The route file SHALL be restructured from a single file `src/routes/tools/structured-extractor.tsx` to a directory:

```
src/routes/tools/structured-extractor/
  index.tsx                    → Entry: Sidebar + Tabs skeleton + Context
  components/SchemaEditor.tsx  → Field config, AI generation, save logic
  components/DataBrowser.tsx   → Data grid, export toolbar, paginator, event listener
```

#### Scenario: 空 Schema 显示
- **WHEN** 任务尚未定义任何字段
- **THEN** 仅显示表头行 + "添加字段"按钮
- **THEN** 表头下方无数据行

#### Scenario: 多行字段展示
- **WHEN** 任务有 5 个字段
- **THEN** 表头下方渲染 5 行 Field Row

#### Scenario: Tabs render both panels
- **WHEN** the structured-extractor page renders
- **THEN** the Tabs component SHALL show two triggers: "字段配置" and "数据浏览"
- **AND** the Schema Editor SHALL render inside the "字段配置" TabContent
- **AND** the Data Browser SHALL render inside the "数据浏览" TabContent

#### Scenario: Default tab is schema editor
- **WHEN** the structured-extractor page first loads
- **THEN** the active tab SHALL be "字段配置" (`defaultValue="schema"`)

#### Scenario: Tab switch preserves scroll position
- **WHEN** the user switches between "字段配置" and "数据浏览" tabs
- **THEN** each tab's scroll position SHALL be preserved independently

## ADDED Requirements

### Requirement: DataBrowser tab — data grid rendering
The DataBrowser component SHALL render a TanStack Table (`useReactTable`) with the following column structure:

1. **Chevron expand column** — 40px fixed width, renders `ChevronRight`/`ChevronDown` icons based on expand state
2. **Raw text column** — 200-250px, truncated text with `truncate` class
3. **Dynamic field columns** — one per `task.fields[].name`, `minSize: 150`, cell value from `result_json[field.name]`
4. **Timestamp column** — 150px fixed width
5. **Actions column** — 80-100px, `sticky right-0`, contains a `MoreHorizontal`-triggered DropdownMenu

The outer container SHALL use `overflow-x-auto`. Cells with missing `result_json` values SHALL render `<span class="text-muted-foreground/50">—</span>`.

Row background SHALL use `bg-card`. The sticky actions column SHALL use `dark:bg-[#161C29]` in dark mode.

#### Scenario: Dynamic columns from task fields
- **WHEN** the task has fields `[{name: "email"}, {name: "phone"}]`
- **THEN** the table SHALL render "email" and "phone" columns between the raw text and timestamp columns

#### Scenario: Missing field value placeholder
- **WHEN** a row's `result_json` does not contain a value for a schema field
- **THEN** the cell SHALL display `—` with `text-muted-foreground/50`

### Requirement: DataBrowser tab — paginator
The DataBrowser SHALL render a bottom-centered paginator with: « (first page), Previous, page numbers, Next, » (last page). The paginator SHALL use `PAGE_SIZE` (50) from `src/lib/constants.ts`.

#### Scenario: Paginator for multi-page data
- **WHEN** the task has 120 extraction records
- **THEN** the paginator SHALL show 3 pages
- **AND** the current page button SHALL use `bg-primary text-primary-foreground`

### Requirement: DataBrowser tab — loading skeleton
During initial load and page transitions, the DataBrowser SHALL render 5 skeleton rows (`Skeleton` component, `h-8`) matching the table column layout. In dark mode, skeleton rows SHALL use `dark:bg-[#161C29]`.

#### Scenario: Skeleton shown on first load
- **WHEN** the DataBrowser mounts and data has not yet loaded
- **THEN** 5 skeleton rows SHALL be displayed

### Requirement: DataBrowser tab — empty state
When a task has zero extraction records, the data grid area SHALL display a centered placeholder with a Lucide lightweight icon and brief Chinese guidance text.

#### Scenario: Empty state for new task
- **WHEN** the selected task has no extraction records
- **THEN** a centered placeholder with icon and guidance text SHALL replace the table

### Requirement: DataBrowser tab — error state
When data loading fails, the data grid area SHALL display a centered error state with a Lucide `TriangleAlert` icon (`size-5 text-destructive`), a Chinese error summary, and a "重试" button (Button variant="ghost"). In dark mode, text SHALL use `dark:text-[#E2E4E7]`.

Clicking "重试" SHALL re-invoke `fetchExtractions` and reset to loading state.

The error state and empty state SHALL share the same placeholder area, toggled by a `status` state variable.

#### Scenario: Error state with retry
- **WHEN** `fetchExtractions` rejects with a network error
- **THEN** the error placeholder SHALL display with the error message and a "重试" button

#### Scenario: Retry reloads data
- **WHEN** the user clicks "重试"
- **THEN** `fetchExtractions` SHALL be called again and the UI SHALL return to skeleton loading state

### Requirement: DataBrowser tab — expandable row
The Chevron column SHALL toggle a per-row expanded state. Multiple rows MAY be expanded simultaneously (no accordion restriction).

The expanded panel SHALL use the following layout:

```
grid grid-cols-2 gap-6 p-4 bg-muted dark:bg-background border-b border-border
├── Left: "源数据" label + raw_text in font-mono text-foreground, max-h-64 overflow-y-auto whitespace-pre-wrap
└── Right: "结构化结果" label + renderFieldValue() recursive rendering
```

`renderFieldValue(value)` SHALL render by type:
- `null`/`undefined` → `<span class="text-muted-foreground/50 italic">—</span>`
- `string`/`number`/`boolean` → `<span class="font-mono text-[13px] text-foreground">{String(value)}</span>`
- `object`/`array` → `<pre class="font-mono text-xs bg-muted dark:bg-background rounded-md p-3 text-foreground overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>`

#### Scenario: Expand row shows raw text and parsed JSON
- **WHEN** the user clicks a row's Chevron icon
- **THEN** the expand panel SHALL render with raw_text on the left and field-by-field parsed result_json on the right

#### Scenario: Nested object renders as JSON block
- **WHEN** a field value is a nested object `{street: "Main St", city: "NYC"}`
- **THEN** `renderFieldValue` SHALL render it as a `<pre>` JSON block, NOT as `[object Object]`

### Requirement: DataBrowser tab — inline delete
The actions column SHALL render a `MoreHorizontal` icon button that triggers a `DropdownMenu`. The dropdown SHALL contain a "删除" item. On first click, the item SHALL turn red and display "确认删除？". On second click, it SHALL invoke `delete_extraction(id)`.

After successful deletion, the row SHALL be removed from local state and a success Toast displayed. The component SHALL log via `log("info", "data-browser", "删除成功 id={id}")` or `log("error", "data-browser", "删除失败：{reason}")`.

The row removal SHALL include a fade-out animation (`animate-out fade-out-0 duration-100`).

#### Scenario: Two-click delete confirmation
- **WHEN** the user clicks "删除" in the dropdown
- **THEN** the item SHALL turn red and change text to "确认删除？"
- **WHEN** the user clicks "确认删除？"
- **THEN** `delete_extraction` SHALL be invoked and the row removed from the table

### Requirement: DataBrowser tab — real-time event listener
The DataBrowser SHALL register a `listen("extraction-completed", ...)` event listener on mount. The listener SHALL verify `event.payload.task_id === currentTaskId` before acting.

- When the user is on page 1: SHALL call `loadData(page=1)` to force-reload, with new rows receiving `bg-blue-50/50 dark:bg-blue-950/20 transition-colors duration-1000` highlight animation
- When the user is on any other page: SHALL increment `total += 1` without page jump

The component SHALL call `unlisten()` on unmount to clean up the listener.

The component SHALL log via `log("info", "data-browser", "收到新提取数据 task_id={taskId}")` when an event is received.

#### Scenario: New extraction on page 1 triggers reload
- **WHEN** the user is viewing page 1 and an `extraction-completed` event fires for the current task
- **THEN** the data grid SHALL reload page 1, with new rows highlighted in blue

#### Scenario: New extraction on page 3 only increments total
- **WHEN** the user is viewing page 3 and an `extraction-completed` event fires for the current task
- **THEN** the total count SHALL increment by 1
- **AND** the page SHALL NOT change

#### Scenario: Event for different task is ignored
- **WHEN** an `extraction-completed` event fires with `task_id` not matching the current task
- **THEN** the DataBrowser SHALL ignore the event

### Requirement: DataBrowser tab — task switch reset
When the selected task changes, the DataBrowser SHALL reset `page = 1` and reload data from the new task. The previous task's page and expand state SHALL NOT be preserved.

#### Scenario: Task switch resets to first page
- **WHEN** the user selects a different task from the sidebar
- **THEN** the DataBrowser SHALL load page 1 of the new task's extraction data
