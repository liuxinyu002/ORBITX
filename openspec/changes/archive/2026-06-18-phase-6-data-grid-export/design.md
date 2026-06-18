# Phase 6 Design

## Context

Phase 5 已打通"抓取 → 派发 → AI 提取 → 相关性判定 → 入库"的完整链路。`extractions` 表拥有 `id, task_id, raw_text, result_json, created_at` 结构，`result_json` 存储去除 `is_relevant`/`reason` 后的纯净 `data` 对象。Phase 3 的任务 Schema（`tasks.fields`）定义了提取字段的元信息。

Phase 5 架构：主窗口持有 `AgentProvider`，负责所有 AI 调用和 DB 操作。悬浮窗是纯视图层，不挂载 Provider。

### Constraints
- 遵循项目 [DESIGN.md](../../../DESIGN.md)：Cool Slate accent ≤5%、所有交互状态覆盖、骨架屏优先于独立 Spinner、禁止 `console.log`
- 数据网格 13px body-compact，紧凑行高
- 展开面板背景 `bg-muted`（light）/ `dark:bg-background`（dark），建立"凹陷"深度感
- 操作交互仅限 Dropdown，严禁 Modal

## Goals / Non-Goals

**Goals:**
- 数据网格分页浏览、展开行查看、行内删除
- CSV/XLSX 导出（当前页 + 全部）
- Dashboard 响应式网格 + 配置化工具卡片
- 实时事件推送新提取数据到数据网格

**Non-Goals:**
- 不引入排序/筛选（MVP 后）
- 不引入数据编辑（MVP 后）
- 不引入多任务合并视图

## Decisions

### 1. 数据网格路由：嵌入工具内页 + Shadcn Tabs

**决策**：数据网格嵌入 `tools/structured-extractor`，与 Schema 编辑器通过 Shadcn Tabs（`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`）水平切换。Tab 标签：「字段配置」「数据浏览」。

**理由**：数据属于任务，在任务上下文内浏览是最短路径。无需新建路由页面。

### 2. 文件拆分：index.tsx + SchemaEditor.tsx + DataBrowser.tsx

**决策**：将当前 ~540 行的 `structured-extractor.tsx` 拆分为目录结构：

```
src/routes/tools/structured-extractor/
  index.tsx           → 入口：Sidebar + Tabs 骨架 + Context
  components/SchemaEditor.tsx → 字段配置、AI 生成、保存逻辑
  components/DataBrowser.tsx  → 数据网格、导出工具栏、分页器、事件监听
```

**理由**：避免单文件膨胀到 1000+ 行。Tab 边界是自然的组件边界。

### 3. 列解析：前端两次请求 + 动态组装

**决策**：前端分两次请求：
1. 已有 `get_task(id)` 获取 Schema 元信息
2. 新增 `list_extractions(task_id, page, limit)` 获取行数据

前端根据 `tasks.fields` 遍历生成中间业务列的 ColumnDef，两端固定列（Chevron 展开、原文本、时间、操作）为固定配置。

**理由**：Schema 定义与数据行独立获取，各自缓存策略清晰。避免 Rust 侧 JOIN 增加命令复杂度。

### 4. 列布局：系统列定宽 + 动态列弹性 + 粘性操作列

```
[▼ 展开 40px] [原文本 200-250px] [field_1 min-w-150px] ... [field_N min-w-150px] [时间 150px] [操作 80-100px sticky-right]
```

- 展开列：Chevron 箭头图标，40px 定宽
- 原文本列：`truncate` 截断 ~80 字符，点击 Chevron 展开
- 动态业务列：`minSize: 150`，由 TanStack Table 管理弹性
- 时间列：150px 定宽
- 操作列：80-100px，`sticky right-0 bg-white z-10`，暗色模式背景映射 `dark:bg-[#161C29]`

外层容器 `overflow-x-auto`，列宽总和超出时水平滚动。

暗色模式：粘性操作列背景 `dark:bg-[#161C29]`，文本 `dark:text-[#E2E4E7]`。骨架屏行背景 `dark:bg-[#161C29]`。

### 5. 物理分页：{ rows, total } + ORDER BY created_at DESC

**决策**：`list_extractions` 返回 `{ rows: Extraction[], total: number }`。SQL 硬编码 `ORDER BY created_at DESC`。每页 50 条（定义为 `PAGE_SIZE` 常量，位于 `src/lib/constants.ts`，后续可改为环境变量覆盖）。

分页器仅表格底部居中放置。不提供上方快捷导航。

**理由**：最新数据永远在第一页顶部，符合用户即时验证心理。总数支持完整分页 UI（« 1 … N »）。

### 5b. 数组展开：前端容错（当前实现）

**决策**：当前 `list_extractions` 不做 SQL 层 `json_each` 展开，`result_json` 按原始存储返回。前端容错策略：
- 单元格渲染（`getFieldValue`）：对数组类型 `result_json` 返回 `undefined`，单元格显示 `—`
- 展开面板：`Array.isArray()` 分支展示完整 JSON dump（`<pre>` + `JSON.stringify`）

**理由**：MVP 阶段避免 SQL 层复杂度（虚拟 ID、删除语义联动、分页 total 重算）。数组提取结果为低频场景，前端兜底渲染功能完备。`json_each` 展开方案延后至 MVP 后评估。

**写入层截断（Phase 5 范畴）**：`insert_extraction` 入库前检测数组长度 > 500 → 截断前 500 条，打 warn 日志并触发前端 Toast「提取结果已截断，仅保留前 500 条」。查询层不做截断限制。

### 6. 无排序/筛选

**决策**：MVP 不做列头排序箭头、不做搜索框、不做 TanStack `sorting`/`globalFilter` 状态。列头纯文本。

### 7. 展开行：独立切换 + 左右分栏 + 递归格式化

**决策**：使用 TanStack Table `expanded` state。多行可同时独立展开，不做手风琴限制。

展开面板布局：
```
┌───────────────────────────────────────────────────────────────────────┐
│ grid grid-cols-2 gap-6 p-4 bg-muted dark:bg-background               │
│ border-b border-border                                             │
│ ┌─────────────────────────┬─────────────────────────────────────────┐ │
│ │ 源数据                    │ 结构化结果                               │ │
│ │ ─ text-xs font-medium    │ ─ text-xs font-medium                  │ │
│ │   text-muted-foreground  │   text-muted-foreground                │ │
│ │                          │                                         │ │
│ │ font-mono text-[13px]    │ renderFieldValue() 递归渲染：            │ │
│ │ text-foreground          │   · null/undef → muted —                │ │
│ │ max-h-64 overflow-y-auto │   · string/number/bool → mono direct    │ │
│ │ whitespace-pre-wrap      │   · object/array → <pre> JSON block     │ │
│ └─────────────────────────┴─────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

`renderFieldValue(value)` 递归格式化函数：

| 值类型 | 渲染方式 |
|--------|---------|
| `null` / `undefined` | `<span class="text-muted-foreground/50 italic">—</span>` |
| `string` / `number` / `boolean` | `<span class="font-mono text-[13px] text-foreground">{String(value)}</span>` |
| `object` / `array` | `<pre class="font-mono text-xs bg-muted dark:bg-background rounded-md p-3 text-foreground overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>` |

`<dl>` 键值对渲染中，每个 `<dd>` 调用 `renderFieldValue()`，确保嵌套对象/数组不再被 `String()` 转为 `[object Object]`。

**理由**：`String(value)` 对嵌套对象/数组产生无意义的 `[object Object]`，信息完全丢失。递归类型判断保证所有值类型可读。`json_each` 展开后 `result_json` 变为单个对象，`<dl>` 键值对渲染成为主路径，嵌套值通过 `renderFieldValue` 兜底。

配色层级（利用主题变量建立"凹陷"深度感）：
- 主表格行：`bg-card dark:bg-card`（Card 层，最亮/最前）
- 展开面板：`bg-muted dark:bg-background`（Muted → hsl(220 14% 95%) / Background → #0E121C，比卡片深一级）
- 源数据文本：`font-mono text-foreground`，标签：`text-muted-foreground`
- `<pre>` 代码块：`bg-muted dark:bg-background`，文本：`text-foreground`
- 不使用左边框颜色指示器——DESIGN.md 禁止 >1px 的彩色边框，深度仅通过背景色层级差传递

### 8. 操作列：仅删除 + Dropdown 内二次确认

**决策**：查看 = 展开箭头触发。操作列仅保留一个「删除」按钮，点击后弹出 Dropdown，菜单项变为红色高亮「确认删除？」，再次点击执行。采用 Dropdown 带 fade-out 动画，严禁 Modal。

删除成功后从表格状态中移除该行，Toast 反馈「已删除」。

### 9. Schema 变更容错

**决策**：列头严格跟随当前 `tasks.fields` 渲染。cell 读取 `result_json[field.name]`，缺失时渲染 `<span class="text-gray-300">—</span>`。

展开面板不做 Schema 过滤，直接 `Object.entries(JSON.parse(result_json))` 全量展示。

导出时以当前 Schema 作为表头强对齐，缺失数据填空字符串。

### 10. 任务切换：重置第一页

**决策**：切换任务时重置 page=1，重新加载数据。不保留切换前的页码和展开状态。

### 11. 数据刷新：首次加载 + 事件监听 → 强制重载

**决策**：DataBrowser 组件 mount 时拉取首屏数据，同时注册 `extraction-completed` Tauri 事件监听器。

Rust 端 `insert_extraction` 成功后 emit 完整 `Extraction` 行数据（含 `parent_id`）。

前端接收逻辑：
- 校验 `payload.taskId === selectedTaskId`
- 在第一页：**调用 `loadData(page=1)` 强制重载**，让 SQLite `json_each` 负责展开新数据，新行与现有行自然混排（按 `created_at DESC, key ASC` 排序）
- 不在第一页：仅 `total += 1`，不跳页

**理由**：`json_each` 查询层展开后，一个 DB 父行可能对应 N 个虚拟行，前端 `unshift` 无法简单处理。重载确保展开逻辑统一收敛到 SQL 层，避免前端复制展开逻辑。

新行动画：重载后通过对比 `parent_id` + 时间戳识别新到达的虚拟行，附加 `bg-blue-50/50 dark:bg-blue-950/20 transition-colors duration-1000` 淡出动画。

组件 unmount 时执行 `unlisten()` 清理。

### 12. 加载态：骨架屏

**决策**：首次加载和分页切换时，使用 Shadcn `Skeleton` 组件渲染 5 行骨架行（`h-8` 条），匹配表格列布局。

遵循 DESIGN.md：「骨架屏优先于独立 Spinner」。

### 13. 空状态：极简引导占位

**决策**：任务无提取数据时，表格区域展示居中占位提示，含 Lucide 轻量图标 + 简短中文引导文字。

### 14. 导出：Rust 原生对话框 + 流式写入

**决策**：新增 `export_data(task_id, format, scope, page?, limit?)` Tauri Command。

流程：
1. `FileDialogBuilder` 设置默认文件名（`{task_name}_{YYYY-MM-DD}.csv|xlsx`）和扩展名过滤器
2. 唤起系统原生保存对话框 → 用户选择路径
3. 根据 scope 查询数据（`all` = 无 LIMIT/OFFSET，`current_page` = 使用 page/limit）
4. **复用 `json_each` 展开查询**（与 `list_extractions` 同一 SQL 模板），保证导出数据与 UI 所见完全一致
5. Schema 表头映射 → 流式写入目标文件
6. 成功/失败 Toast 反馈

**依赖**：`csv` crate、`rust_xlsxwriter` crate、`tauri-plugin-dialog`。

**行数上限**：`scope=all` 时硬限制 `MAX_EXPORT_ROWS = 50000`。超出时返回 `AppError::ExportTooLarge`，前端 Toast 提示「数据量过大，请分批导出或缩小范围」。

**异步写入**：CSV/XLSX 文件写入通过 `tauri::async_runtime::spawn_blocking` 执行，避免阻塞 Tauri 事件循环。

**导出 UX**：数据浏览 Tab 工具栏单个「导出▼」下拉按钮，展开 4 选项：
- CSV（当前页）
- CSV（全部）
- XLSX（当前页）
- XLSX（全部）

### 15. Dashboard：响应式网格 + 配置化架构

**决策**：
- 布局：`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6`
- 卡片：`shadow-sm ring-1 ring-foreground/10 rounded-lg bg-white`，hover 时 `shadow-md -translate-y-0.5 transition-all duration-200`
- 工具卡数组化：定义 `toolCards` 配置数组，每项含 `{ title, description, route, icon }`，`map()` 渲染
- 设置入口从工具网格中剥离，放在 Dashboard 右上角作为独立 `IconButton`（Lucide `Settings`）
- 移除 IPC 状态指示器（调试期产物）
- 严禁玻璃拟物材质、渐变高光

### 16. 交互状态覆盖

**决策**：所有交互元素（导出下拉按钮、分页控件、Tab 触发器、删除 Dropdown、展开 Chevron）均复用 Shadcn UI 默认状态体系，无需自定义。状态清单：

- **导出下拉按钮**（Button variant="ghost"）：default / hover(`bg-muted`) / focus-visible(`ring-3 ring-ring/50`) / active(`translate-y-px`) / disabled(`opacity-50`)
- **分页按钮**（Button variant="ghost" size="icon-sm"）：同上，当前页按钮加 `bg-primary text-primary-foreground`
- **Tab 触发器**（Shadcn TabsTrigger 默认）：default / hover(`bg-muted`) / active(`data-[state=active]:bg-background`)
- **删除 Dropdown**（DropdownMenuItem variant="destructive"）：default / hover(`bg-destructive/20`) / focus 同 hover
- **展开 Chevron**（Button variant="ghost" size="icon-xs"）：default / hover(`bg-muted`) / 点击旋转 90°

### 17. 参数校验

**决策**：所有 Tauri Command 入口执行参数校验，非法输入返回 `AppError::InvalidInput(String)`：

| 命令 | 参数 | 约束 |
|------|------|------|
| `list_extractions` | `page` | ≥1 |
| | `limit` | 1..200 |
| `delete_extraction` | `id` | 非空 |
| `export_data` | `format` | `"csv"` 或 `"xlsx"` |
| | `scope` | `"current_page"` 或 `"all"` |
| | `page` | scope=current_page 时必填且 ≥1 |
| | `limit` | scope=current_page 时必填且 1..200 |

### 18. 错误状态

**决策**：数据网格加载失败时，表格区域居中展示错误状态占位：Lucide `TriangleAlert` 图标（`size-5 text-destructive`）+ 中文错误摘要 +「重试」按钮（Button variant="ghost"）。重试按钮点击后重新调用 `fetchExtractions` 并重置为 loading 态。

空状态与错误状态共用同一占位区域，通过 `status` 状态切换渲染内容。

### 19. 日志覆盖

**决策**：以下关键路径需打日志（中文消息，target=`"extraction"` / `"data-browser"` / `"export"`）：

| 位置 | target | 日志内容 |
|------|--------|----------|
| `list_extractions` 入口 | extraction | `列出提取数据 task_id={id} page={p} limit={n}` |
| `list_extractions` 出口 | extraction | `列出完成 total={n} rows={m}` |
| `delete_extraction` | extraction | `删除记录 id={id}` |
| `export_data` 入口 | export | `导出开始 task_id={id} format={f} scope={s}` |
| `export_data` 出口 | export | `导出完成 path={p} rows={n}` |
| `insert_extraction` emit | extraction | `发射提取完成事件 task_id={id}` |
| 前端收到事件 | data-browser | `收到新提取数据 task_id={id}` |
| 前端导出调用 | data-browser | `发起导出请求 format={f} scope={s}` |
| 前端导出结果 | data-browser | `导出成功/导出失败：{原因}` |
| 前端删除结果 | data-browser | `删除成功 id={id}/删除失败：{原因}` |

## Risks / Trade-offs

- **result_json 可能是数组**：已通过 `json_each()` 在查询层展开（决策 5b），不再依赖前端/展开面板的 fallback 渲染。空数组注入占位 `{}` 保留 1 行。
- **`extraction-completed` 事件仅对当前选中任务生效**：事件携带 `task_id`，DataBrowser 需校验是否匹配当前任务。
- **`rust_xlsxwriter` 不支持流式追加**：大数据集需一次性构建 Workbook，内存占用与行数成正比。万级以内安全。
- **并发提取 + 事件**：Phase 5 允许并发提取，多个 `extraction-completed` 事件可能几乎同时到达。前端收到事件后直接 `loadData(page=1)` 重载，无竞态风险。
- **动态列过多**：15+ 列时水平滚动是唯一出路。`min-w-[150px]` 保证每列最低可读性。
- **`export_data` 职责集中**：当前命令承担查询+对话框+格式转换+文件写入四重职责，MVP 阶段可接受。后续大数据量场景可将格式转换提取为独立 `export/writer.rs` 模块。
- **性能埋点延后**：导出耗时、查询耗时等性能指标暂不埋点，待 MVP 验证后按需添加 `log::debug!` 计时日志。
