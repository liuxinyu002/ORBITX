# Phase 6 实施任务

## 执行约定

各 Step 内任务按编号顺序执行（D-1 → D-2 → D-3，BE-1 → BE-2 → BE-3 → BE-4，FE-1 → FE-2 → ... → FE-6，EX-1 → EX-2）。Step 间可并行推进（Step 1 / Step 2 可同步开工），但 Step 3 依赖 Step 1(D-3) + Step 2(BE-4) 完成，Step 4 依赖 Step 2(BE-1) + Step 3(FE-1) 完成。

## Step 1: 结构重组与依赖注入

### D-1: 挂载 Rust 依赖
- [x] `Cargo.toml` 添加 `csv = "=1.3.0"`、`rust_xlsxwriter = "=0.79.0"`、`tauri-plugin-dialog = "=2.2.0"`
- [x] `capabilities/default.json` 添加 `"dialog:default"` 权限
- [x] `lib.rs` 注册 `.plugin(tauri_plugin_dialog::init())`
- [x] 验证 `cargo build` 通过

### D-2: 挂载前端依赖
- [x] `pnpm add @tanstack/react-table@8.20.5 --save-exact`
- [x] 验证 `tsc --noEmit` 通过

### D-3: 拆分 structured-extractor 目录
- [x] 创建 `src/routes/tools/structured-extractor/` 目录（迁移原文件）
- [x] 创建 `index.tsx`：入口组件（Sidebar + Tabs 骨架 + Context）
- [x] 创建 `components/SchemaEditor.tsx`：迁移字段配置、AI 生成区、保存逻辑
- [x] 创建 `components/DataBrowser.tsx`：占位组件（Step 3 填充）
- [x] 更新 `src/App.tsx` 导入路径
- [x] 确认 `tsc --noEmit` + `pnpm dev` 正常

## Step 2: 后端管道与状态打通

### BE-1: list_extractions 命令
- [x] 定义 `ExtractionRow` 和 `ExtractionListResponse` 类型（`src-tauri/src/models/extraction.rs`）
- [x] 实现 `list_extractions(task_id, page, limit)` → `{ rows, total }`（`src-tauri/src/commands/extraction.rs`）
- [x] SQL: `SELECT ... FROM extractions WHERE task_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?` + `SELECT COUNT(*)` 总数
- [x] 参数校验：`page >= 1`，`limit` ∈ [1, 200]，非法输入返回 `AppError::InvalidInput`
- [x] 入口日志：`log::info!("[extraction] 列出提取数据 task_id={task_id} page={page} limit={limit}")`
- [x] 出口日志：`log::info!("[extraction] 列出完成 total={total} rows={rows_len}")`
- [x] 注册 Tauri command（`src-tauri/src/lib.rs` invoke_handler + `src-tauri/src/commands/mod.rs`）
- [x] 单元测试：分页查询、空任务查询、跨页边界

### BE-2: delete_extraction 命令
- [x] 实现 `delete_extraction(id)` → 删除单条记录
- [x] 参数校验：`id` 非空
- [x] 日志：`log::info!("[extraction] 删除记录 id={id}")`
- [x] 注册 Tauri command
- [x] 单元测试：删除存在/不存在记录

### BE-3: Tauri 事件发射
- [x] 修改 `insert_extraction` 命令：插入成功后 `app_handle.emit("extraction-completed", Extraction)` 发射完整行数据
- [x] 日志：emit 前 `log::info!("[extraction] 发射提取完成事件 task_id={task_id}")`
- [x] 验证事件 payload 包含完整 `Extraction` 结构（id, task_id, raw_text, result_json, created_at）

### BE-4: 前端数据层
- [x] 定义前端 `Extraction` 类型（`src/lib/task-types.ts` 或独立文件）
- [x] 封装 `fetchExtractions(taskId, page, limit)` → `{ rows, total }` + `fetchExtractionCount(taskId)` + `removeExtraction(id)`
- [x] 各方法内部通过 `log()` 桥接记录调用和结果（成功/失败）
- [x] `src/lib/constants.ts` 定义 `PAGE_SIZE = 50`

## Step 3: 视图映射与交互雕琢


### FE-1: 数据网格核心渲染
- [x] `src/lib/constants.ts` 定义 `PAGE_SIZE = 50`
- [x] `DataBrowser.tsx`：TanStack Table `useReactTable` 初始化，引用 `PAGE_SIZE` 常量
- [x] 固定列定义：Chevron 展开列、原文本列、操作列
- [x] 动态列生成：遍历 `task.fields` 构建 ColumnDef
- [x] 列宽配置：系统列定宽 + 动态列 `minSize: 150`
- [x] 容器 `overflow-x-auto` + 操作列 `sticky right-0 bg-white z-10`
- [x] 单元格渲染：`result_json[field.name]` 取值，缺失显示 `<span class="text-gray-300">—</span>`

### FE-2: 分页器
- [x] 底部居中分页组件（« 上一页  1 ... N  下一页 »）
- [x] 首次加载骨架屏（5 行 `Skeleton`，匹配列布局，含暗色模式 `dark:bg-[#161C29]`）
- [x] 空状态：极简占位（图标 + 引导文字）
- [x] 错误状态：居中 `TriangleAlert` 图标 + 中文错误摘要 +「重试」按钮（ghost variant），暗色模式文本 `dark:text-[#E2E4E7]`
- [x] 空状态与错误状态共用占位区域，通过 `status` 切换

### FE-3: 展开行
- [x] 展开列渲染 Chevron 图标（`ChevronRight`/`ChevronDown`，根据展开状态切换）
- [x] TanStack Table `expanded` state，独立切换（无手风琴限制）
- [x] 展开面板：`grid grid-cols-2 gap-6 p-4 bg-[#F7F8FA] border-b border-gray-100`
- [x] 左栏：raw_text，`max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-gray-700`
- [x] 右栏：result_json 解析
  - 对象 → `<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">` 键值对
  - 数组/其他 → `<pre className="font-mono text-xs bg-gray-50 rounded-md p-3 text-gray-900">` + JSON.stringify

### FE-4: 行内删除
- [x] 操作列渲染 Dropdown（`MoreHorizontal` 图标触发）
- [x] Dropdown 内「删除」项，点击后变为红色高亮「确认删除？」
- [x] 二次点击执行 `delete_extraction(id)`，成功后 `removeRow` + Toast
- [x] `log("info", "data-browser", \`删除成功 id=${id}\`)` / `log("error", "data-browser", \`删除失败：${reason}\`)` 记录结果
- [x] fade-out 动画（Tailwind `animate-out fade-out-0 duration-100`）

### FE-5: 实时事件监听
- [x] `useEffect` 注册 `extraction-completed` 事件监听器
- [x] 校验 `event.payload.task_id === currentTaskId`
- [x] 首页 → `unshift` 新行 + `bg-blue-50/50 dark:bg-blue-950/20 transition-colors duration-1000` 淡出动画
- [x] 非首页 → `total += 1`
- [x] `log("info", "data-browser", \`收到新提取数据 task_id=${taskId}\`)` 记录事件接收
- [x] 组件 unmount `unlisten()` 清理

### FE-6: 任务/视图切换
- [x] `index.tsx`：Tabs 状态管理（`defaultValue="schema"`）
- [x] 切换任务时 DataBrowser 重置 page=1，重新加载
- [x] Tab 切换时保留各自滚动位置

## Step 4: 原生导出与大厅收尾

### EX-1: Rust 导出命令
- [x] 实现 `export_data(task_id, format, scope, page?, limit?)` Tauri Command
- [x] 参数校验：`format` ∈ {"csv", "xlsx"}，`scope` ∈ {"current_page", "all"}，scope=current_page 时 page≥1 且 limit∈[1,200]
- [x] FileDialogBuilder：默认文件名 `{task_name}_{YYYY-MM-DD}` + 扩展名过滤器
- [x] 唤起保存对话框 → 获取路径
- [x] 根据 scope 查询数据（all = LIMIT `MAX_EXPORT_ROWS=50000`，current_page = page/limit）
- [x] 超出 MAX_EXPORT_ROWS 时返回 `AppError::ExportTooLarge`，前端 Toast 提示
- [x] JSON 展平 + Schema 表头映射
- [x] CSV/XLSX 写入在 Tauri command 线程池中执行（不阻塞事件循环）
- [x] CSV: `csv::Writer` 流式写入
- [x] XLSX: `rust_xlsxwriter::Workbook` 写入
- [x] 入口日志：`log::info!("[export] 导出开始 task_id={task_id} format={format} scope={scope}")`
- [x] 出口日志：`log::info!("[export] 导出完成 path={path} rows={count}")`
- [x] IO 错误/磁盘满/权限异常捕获，封装为 AppError 返回
- [x] 单元测试：CSV/XLSX 生成内容验证、行数上限拦截

### EX-2: 导出前端
- [x] DataBrowser 工具栏渲染「导出▼」下拉按钮（`DropdownMenu`）
- [x] 4 选项：CSV（当前页）/ CSV（全部）/ XLSX（当前页）/ XLSX（全部）
- [x] 调用 `invoke('export_data', { taskId, format, scope, page, limit })`
- [x] `log("info", "data-browser", \`发起导出请求 format=${format} scope=${scope}\`)` 记录操作
- [x] 成功 Toast + 失败 Toast（含错误原因）
- [x] `log("info"/"error", "data-browser", ...)` 记录导出结果

### DB-1: Dashboard 改造
- [x] 工具卡片数组化配置（`const toolCards = [{...}]`）
- [x] 响应式网格：`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- [x] 卡片样式：`shadow-sm ring-1 ring-foreground/10 rounded-lg bg-white`，hover `shadow-md -translate-y-0.5 transition-all duration-200`
- [x] 布局：Header 区域含「OrbitX」标题 + 右上角 Settings IconButton
- [x] 移除 IPC 状态指示器
- [x] 确保无玻璃拟物材质、无渐变高光

## Step 5: UI 渲染修正（审查驱动）

审查发现展开行渲染存在 4 项质量问题：嵌套对象渲染损坏、暗色模式层级缺失、颜色硬编码、排版变量不一致。以下任务按顺序执行。

### UI-1: 修复嵌套对象渲染
- [x] `DataBrowser.tsx`：新增 `renderFieldValue(value)` 递归格式化函数，替代 `<dl>` 内的 `String(value)`
- [x] 原子值（string/number/boolean）→ `font-mono text-foreground` 直接渲染
- [x] 对象/数组 → `<pre>` + `JSON.stringify(val, null, 2)`，`font-mono text-xs bg-muted rounded-md p-3 text-foreground`
- [x] null/undefined → `text-muted-foreground/50` 渲染 `—`
- [x] 验证：构造含嵌套对象的 result_json 测试数据，确认不再出现 `[object Object]`

### UI-2: 修正展开面板空间层级
- [x] 主表格行背景使用 `bg-card`（替代 `bg-white`）
- [x] 展开面板背景改为 `bg-muted dark:bg-[#0E121C]`（比表格行深一级，传递"凹陷"深度感）
- [x] 左栏文本：`text-foreground`（替代硬编码 `text-gray-700`）
- [x] 标签文字："源数据"/"结构化结果" 使用 `text-muted-foreground`（替代 `text-slate-500`）
- [x] 验证：亮/暗模式下展开面板与主表格行有明显层级区分

### UI-3: 替换硬编码颜色为主题变量
- [x] `<pre>` 背景：`bg-muted`（替代 `bg-gray-50`）
- [x] `<pre>` 暗色背景：`dark:bg-[#0E121C]`（替代 `dark:bg-[#0E121C]`，已正确）
- [x] 缺失值占位符：`text-muted-foreground/50`（替代 `text-gray-300 dark:text-gray-600`）
- [x] 时间列：`text-muted-foreground`（替代 `text-slate-500`）
- [x] 验证：所有颜色值映射到 `globals.css` 中已定义的主题变量

### UI-4: Dropdown 动画微调
- [x] `dropdown-menu.tsx`：`DropdownMenuContent` 及 `DropdownMenuSubContent` 的 `data-open:zoom-in-95` / `data-closed:zoom-out-95` 改为 `zoom-in-98` / `zoom-out-98`，降低 zoom 幅度
- [x] 验证：Dropdown 呼出/隐藏过渡平滑，无突兀缩放跳跃
