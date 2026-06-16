## 1. 数据库迁移与 Rust 模型

- [ ] 1.1 创建 V4 数据库迁移：`extractions` 表（`id TEXT PK, task_id TEXT, raw_text TEXT, result_json TEXT, created_at TEXT`）及 `(task_id, created_at)` 联合索引
- [ ] 1.2 定义 `Extraction` 和 `ExtractionInput` Rust struct（`src-tauri/src/models/extraction.rs`）
- [ ] 1.3 实现 `insert_extraction` Tauri command：`serde_json::from_str` 校验 `result_json` 合法性 → 生成 UUID → 设 ISO 8601 时间戳 → 写入 DB → 返回 `Result<String, String>`。校验失败返回 `Err("result_json 不是合法 JSON: {e}")`，防止脏数据落盘
- [ ] 1.4 在 `lib.rs` 注册 `insert_extraction` 命令，在 `models/mod.rs` 和 `commands/mod.rs` 导出新模块

## 2. Rust 侧事件协议改造

- [ ] 2.1 删除 `GrabState` 及其 Mutex 队列（`src-tauri/src/grab/state.rs`），删除 `grab-completed` 事件发射
- [ ] 2.2 删除 `consume_grabbed_result` 和 `set_overlay_permission_state` Tauri command
- [ ] 2.3 改造 Shortcut A handler：grab → truncate_by_tokens → `emit_to("main", "task:silent-extract", { text, truncated })`
- [ ] 2.4 实现核心 `show_overlay` 函数（Rust 内部，窗口存在性检查 → 根据 payload tag 设置 `OverlayPermissionState`（`"permission-required"` → `true`，其他 → `false`）→ compute_overlay_position → `emit_to("overlay", "view:render-overlay", payload)` → show + focus）
- [ ] 2.5 改造 Shortcut B handler：grab → truncate_by_tokens → 调用核心 `show_overlay({ text, truncated })`
- [ ] 2.6 实现 `show_overlay` Tauri command（薄包装调用核心 `show_overlay` 函数），在 `lib.rs` 注册
- [ ] 2.7 清理 `GrabState` 相关 import 和 `grab/mod.rs` 中的 pub 导出
- [ ] 2.8 Rust 侧关键路径中文日志（target 统一使用 `"grab"` / `"overlay"` / `"extraction"`）：
  - Shortcut A handler: `log("info", "grab", "静默提取事件已发射至主窗口")`
  - Shortcut B handler: `log("info", "grab", "面板派发事件已发射至悬浮窗")`
  - `show_overlay_core`: `log("info", "overlay", "悬浮窗已唤起，tag={tag}")` + `log("debug", "overlay", "OverlayPermissionState={suppress}")`
  - `insert_extraction`: `log("info", "extraction", "写入提取结果，record_id={id}，task_id={tid}")`

## 3. 提取管线核心（pipeline.ts）

- [ ] 3.1 创建 `src/agent/pipeline.ts`，实现 `runExtraction(text, mode, currentModel, taskId?, force?, truncated?)` 函数签名。内部使用命名子函数 `assemblePrompt()` 和 `routeResult()` 保持高内聚与可读性
- [ ] 3.2 实现 Prompt 组装逻辑：
  - 正常/手动模式：包含 `is_relevant` + `reason` + `data` 结构，Schema JSON 直出注入
  - force 模式：去掉 `is_relevant` 指令，换强硬语气，输出纯 `data`
  - Temperature 锁定 0
- [ ] 3.3 实现模型调用与解析：调 `complete()` → 复用 `parseAIResponse()` → 提取 JSON
- [ ] 3.4 实现路由逻辑：
  - `is_relevant: true` → `invoke('insert_extraction', ...)` + Toast("已提取")
  - `is_relevant: false` 且 silent → `invoke('show_overlay', { payload: { text, fallback: { reason, failedTaskId } } })`
  - `is_relevant: false` 且 manual → Toast 错误
  - `force: true` → 跳过判定，直接 `invoke('insert_extraction', ...)`
  - 解析失败 → 等同 `is_relevant: false`
- [ ] 3.5 实现无激活任务检测：silent 模式无激活任务 → Toast("静默失败：无激活任务")，不调模型
- [ ] 3.6 实现模型调用失败处理：`complete()` 调用超时由环境变量 `EXTRACTION_TIMEOUT_MS`（默认 30_000ms）控制，超时或网络错误统一零重试，Toast 错误信息。同步更新 `.env.example` 添加 `EXTRACTION_TIMEOUT_MS` 注释项
- [ ] 3.7 导出函数并通过 `src/agent/index.ts` 暴露
- [ ] 3.8 插入关键路径中文日志（统一通过 `log(level, target, message)` 桥接，禁止 `console.log`）：
  - `log("info", "pipeline", "开始提取，模式=${mode}，taskId=${id}")`
  - `log("info", "pipeline", "Prompt 组装完成")`
  - `log("info", "pipeline", "调用 AI 模型...")`
  - `log("info", "pipeline", "模型响应已解析，is_relevant=${r}")`
  - `log("info", "pipeline", "提取结果已入库，record_id=${id}")`
  - `log("warn", "pipeline", "不相关文本触发降级，reason=${reason}，failedTaskId=${id}")`
  - `log("error", "pipeline", "模型调用失败: ${errMsg}")`
- [ ] 3.9 插入性能耗时日志：提取开始记录 `Date.now()`，结束时输出 `log("info", "pipeline", "提取完成，耗时=${elapsed}ms")`（仅本地控制台输出，不接入任何远端遥测）

## 4. 无头监听组件（ExtractionListener）

- [ ] 4.1 创建 `src/components/ExtractionListener.tsx`：无头组件（return null）
- [ ] 4.2 监听 `task:silent-extract` 事件 → 从 AgentContext 获取 currentModel → `runExtraction(text, 'silent', model, undefined, false, truncated)`
- [ ] 4.3 监听 `task:manual-extract` 事件 → `runExtraction(text, 'manual', model, taskId, force, truncated)`
- [ ] 4.4 在 `App.tsx` 的 `<AgentProvider>` 内部挂载 `<ExtractionListener />`
- [ ] 4.5 Toast 调用直接在 ExtractionListener 或 pipeline 内部 `import { toast } from 'sonner'` 处理

## 5. 悬浮窗改造（Overlay）

- [ ] 5.1 将事件监听从 `grab-completed` 改为 `view:render-overlay`
- [ ] 5.2 移除 `consume_grabbed_result` 调用，改为直接从 `view:render-overlay` payload 中读取 `text`
- [ ] 5.3 实现双模式渲染：
  - 载荷无 `fallback` → 正常模式：文本预览 + 任务下拉 + 派发按钮
  - 载荷有 `fallback` → 降级模式：警告原因 + 折叠原文（`line-clamp-3`）+ 下拉（failedTaskId 默认选中+⚠标识）
- [ ] 5.4 实现降级模式原文折叠/展开交互（`▸ 展开原文` 按钮，`truncated: true` 时追加灰字截断说明）
- [ ] 5.5 实现降级模式三个操作：
  - **丢弃**：hide + 清空状态
  - **重新选任务+确认**：emit `task:manual-extract`（新 taskId）
  - **强制入库**：emit `task:manual-extract`（`force: true`）
- [ ] 5.6 实现正常模式派发按钮：emit `task:manual-extract` + fade-out (`animate-out fade-out duration-200`) + hide + 清空状态
- [ ] 5.7 保持现有任务下拉动态 resize、Esc 关闭、失焦隐藏等行为不受影响

## 6. 集成验证与清理

- [ ] 6.1 端到端验证：快捷键 A → silent 提取 → 相关入库 / 不相关降级
- [ ] 6.2 端到端验证：快捷键 B → overlay 显示 → 选任务派发 → 入库
- [ ] 6.3 清理所有 `GrabState`、`grab-completed`、`consume_grabbed_result`、GrabEnvelope 的引用和 import
- [ ] 6.4 清理 TypeScript 侧残留的 grab-completed 事件监听和 consume_grabbed_result 调用
- [ ] 6.5 确保编译通过（`cargo build` + `pnpm build`），无死代码警告
