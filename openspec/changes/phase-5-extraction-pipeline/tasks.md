# Phase 5: 提取管线 — 阶段任务

> **推进规则**：按阶段顺序执行，前序阶段未完成不进入下一阶段。每阶段末尾标注验证方式，验证通过后方可推进。

---

## 阶段一：Rust 数据基础设施

**目标**：建立 `extractions` 表与 Rust 侧写入能力，为后续管线提供持久化落盘入口。

**依赖**：无（纯增量，不影响现有功能）

| # | 任务 | 涉及文件 |
|---|------|----------|
| 1.1 | 创建 V4 数据库迁移：`extractions` 表（`id TEXT PK, task_id TEXT, raw_text TEXT, result_json TEXT, created_at TEXT`）及 `(task_id, created_at)` 联合索引，追加 `UPDATE app_kv SET value = '4' WHERE key = 'schema_version'` | `src-tauri/src/db/migrations.rs`（或现有迁移文件） |
| 1.2 | 定义 `Extraction` 和 `ExtractionInput` Rust struct | `src-tauri/src/models/extraction.rs`（新建） |
| 1.3 | 实现 `insert_extraction` Tauri command：校验 `result_json` 合法性 + `raw_text` 长度防御（> 50KB 拒绝）→ 生成 UUID → ISO 8601 时间戳 → 写入 DB → 返回 `Result<String, String>` | `src-tauri/src/commands/extraction.rs`（新建） |
| 1.4 | 在 `lib.rs` 注册命令，在 `models/mod.rs` 和 `commands/mod.rs` 导出新模块 | `lib.rs`, `models/mod.rs`, `commands/mod.rs` |
| 1.5 | 关键路径日志：`insert_extraction` 写入成功后 `log("info", "extraction", "写入提取结果，record_id={id}，task_id={tid}")` | 同 1.3 |

- [x] 1.1 V4 数据库迁移：`extractions` 表 + 索引 + schema_version
- [x] 1.2 定义 `Extraction` 和 `ExtractionInput` Rust struct
- [x] 1.3 实现 `insert_extraction` Tauri command
- [x] 1.4 在 `lib.rs` / `models/mod.rs` / `commands/mod.rs` 注册导出
- [x] 1.5 关键路径日志

**验证**：`cargo build` 通过，启动应用后 `extractions` 表自动创建，手动调用 `insert_extraction` 写入一条合法 JSON 记录并确认落盘。

---

## 阶段二：Rust 事件协议重构

**目标**：废弃 `GrabState` 队列暂存模式，建立三条专用事件通道（`task:silent-extract` / `view:render-overlay` / `task:manual-extract`），实现核心 `show_overlay` 函数。

**依赖**：阶段一（无编译依赖，但逻辑上通道的终点——`insert_extraction`——在阶段一建立）

| # | 任务 | 涉及文件 |
|---|------|----------|
| 2.1 | 删除 `GrabState` 及其 Mutex 队列，删除 `grab-completed` 事件发射 | `src-tauri/src/grab/state.rs` |
| 2.2 | 删除 `consume_grabbed_result` 和 `set_overlay_permission_state` Tauri command | 命令注册文件 + `lib.rs` |
| 2.3 | 改造 Shortcut A handler：grab → truncate_by_tokens → `emit_to("main", "task:silent-extract", { text, truncated })` | `src-tauri/src/grab/mod.rs` |
| 2.4 | 实现核心 `show_overlay_core` 函数：窗口存在性检查 → 根据 payload tag 设置 `OverlayPermissionState`（`"permission-required"` → `true`，其他 → `false`）→ `compute_overlay_position` → `emit_to("overlay", "view:render-overlay", payload)` → show + focus | `src-tauri/src/grab/mod.rs` |
| 2.5 | 改造 Shortcut B handler：grab → truncate_by_tokens → 调用 `show_overlay_core({ text, truncated })` | `src-tauri/src/grab/mod.rs` |
| 2.6 | 实现 `show_overlay` Tauri command（薄包装调用 `show_overlay_core`），在 `lib.rs` 注册 | `src-tauri/src/commands/` + `lib.rs` |
| 2.7 | 清理 `GrabState` 相关 import 和 `grab/mod.rs` 中的 pub 导出 | `src-tauri/src/grab/mod.rs` |
| 2.8 | 关键路径中文日志（target 统一 `"grab"` / `"overlay"`）：Shortcut A 发射日志、Shortcut B 发射日志、`show_overlay_core` 唤起日志（含 tag）、仅 `permission-required` tag 时记录 debug 权限态 | 同 2.3-2.5 |

- [x] 2.1 删除 GrabState 及其 Mutex 队列，删除 grab-completed 事件发射
- [x] 2.2 删除 consume_grabbed_result 和 set_overlay_permission_state Tauri command
- [x] 2.3 改造 Shortcut A handler：emit_to("main", "task:silent-extract", { text, truncated })
- [x] 2.4 实现核心 show_overlay_core 函数
- [x] 2.5 改造 Shortcut B handler：调用 show_overlay_core({ text, truncated })
- [x] 2.6 实现 show_overlay Tauri command（薄包装）
- [x] 2.7 清理 GrabState 相关 import 和 pub 导出
- [x] 2.8 关键路径中文日志

**验证**：`cargo build` 通过，`cargo clippy` 无死代码警告。GrabState / grab-completed / consume_grabbed_result 全仓库零引用。

---

## 阶段三：前端提取管线

**目标**：实现 `runExtraction()` 管线函数（Prompt 组装 → AI 调用 → 相关性判定 → 路由分发），并通过无头组件 `ExtractionListener` 挂载到主窗口，使两条事件通道（静默/手动）均可触达管线。

**依赖**：阶段一（`insert_extraction` 命令）、阶段二（`show_overlay` 命令 + 事件协议）

| # | 任务 | 涉及文件 |
|---|------|----------|
| 3.1 | 创建 `src/agent/pipeline.ts`，实现 `runExtraction(text, mode, currentModel, taskId?, force?, truncated?)` 函数签名，内部使用命名子函数 `assemblePrompt()` 和 `routeResult()` | `src/agent/pipeline.ts`（新建） |
| 3.2 | 实现 Prompt 组装：正常/手动模式含 `is_relevant`+`reason`+`data` 结构；force 模式去掉 `is_relevant`，输出纯 `data`；Temperature 锁定 0 | 同 3.1 |
| 3.3 | 实现模型调用与解析：调 `complete()` → 复用 `parseAIResponse()` → 提取 JSON | 同 3.1 |
| 3.4 | 实现路由逻辑：`is_relevant: true` → `insert_extraction` + Toast；`is_relevant: false` + silent → `show_overlay` 降级；`is_relevant: false` + manual → Toast 错误；`force: true` → 直接入库；解析失败 → 等同不相关 | 同 3.1 |
| 3.5 | 无激活任务检测：silent 模式无激活任务 → Toast("静默失败：无激活任务")，不调模型 | 同 3.1 |
| 3.6 | 模型调用失败处理：`EXTRACTION_TIMEOUT_MS` 环境变量（默认 30_000ms），超时/网络错误零重试，Toast 报错。同步更新 `.env.example` | 同 3.1 + `.env.example` |
| 3.7 | 导出 `runExtraction` 并通过 `src/agent/index.ts` 暴露 | `src/agent/pipeline.ts`, `src/agent/index.ts` |
| 3.8 | 关键路径中文日志：开始提取、Prompt 完成、调用模型、响应解析、入库成功、降级打断、模型失败（均通过 `log()` 桥接） | 同 3.1 |
| 3.9 | 性能耗时日志：提取开始记录 `Date.now()`，结束时输出 `log("info", "pipeline", "提取完成，耗时=${elapsed}ms")` | 同 3.1 |
| 3.10 | 创建 `src/components/ExtractionListener.tsx`：无头组件（`return null`），监听 `task:silent-extract` / `task:manual-extract`，从 `AgentContext` 获取 `currentModel`，调用 `runExtraction()`。useEffect cleanup 中调用 `unlisten()` | `src/components/ExtractionListener.tsx`（新建） |
| 3.11 | 在 `App.tsx` 的 `<AgentProvider>` 内部挂载 `<ExtractionListener />` | `src/App.tsx` |

- [x] 3.1 创建 `src/agent/pipeline.ts`，实现 `runExtraction()` 函数签名
- [x] 3.2 实现 Prompt 组装（正常/手动模式 + force 模式）
- [x] 3.3 实现模型调用与解析
- [x] 3.4 实现路由逻辑
- [x] 3.5 无激活任务检测
- [x] 3.6 模型调用失败处理（EXTRACTION_TIMEOUT_MS）
- [x] 3.7 导出 `runExtraction` 并通过 `src/agent/index.ts` 暴露
- [x] 3.8 关键路径中文日志
- [x] 3.9 性能耗时日志
- [x] 3.10 创建 `src/components/ExtractionListener.tsx`
- [x] 3.11 在 `App.tsx` 的 `<AgentProvider>` 内部挂载 `<ExtractionListener />`

**验证**：`pnpm build` 通过。快捷键 A 触发后日志输出 "静默提取事件已发射至主窗口"，前端日志输出 "开始提取，模式=silent" 及后续管线日志。

---

## 阶段四：悬浮窗双模式改造

**目标**：悬浮窗从 `grab-completed` 迁移到 `view:render-overlay` 事件，实现正常派发与降级打断两套渲染/交互模式。

**依赖**：阶段二（`view:render-overlay` 事件）、阶段三（`task:manual-extract` 事件及 `ExtractionListener` 已就位）

| # | 任务 | 涉及文件 |
|---|------|----------|
| 4.1 | 将事件监听从 `grab-completed` 改为 `view:render-overlay` | Overlay 组件 |
| 4.2 | 移除 `consume_grabbed_result` 调用，改为直接从 `view:render-overlay` payload 中读取 `text` | Overlay 组件 |
| 4.3 | 实现双模式渲染：无 `fallback` → 正常模式（文本预览 + 任务下拉 + 派发按钮）；有 `fallback` → 降级模式（警告原因 + 折叠原文 `line-clamp-3` + 下拉 `failedTaskId` 默认选中 + ⚠ 标识） | Overlay 组件 |
| 4.4 | 降级模式原文折叠/展开交互（`▸ 展开原文` 按钮，`truncated: true` 时追加灰字截断说明） | Overlay 组件 |
| 4.5 | 降级模式三个操作：**丢弃**（hide + 清空状态）、**重新选任务+确认**（emit `task:manual-extract` 新 taskId）、**强制入库**（emit `task:manual-extract` force:true） | Overlay 组件 |
| 4.6 | 正常模式派发按钮：emit `task:manual-extract` + fade-out (`animate-out fade-out duration-200`) + hide + 清空状态 | Overlay 组件 |
| 4.7 | 保持现有交互不受影响：任务下拉动态 resize、Esc 关闭、失焦隐藏 | Overlay 组件 |

- [x] 4.1 将事件监听从 `grab-completed` 改为 `view:render-overlay`
- [x] 4.2 移除 `consume_grabbed_result` 调用，改为直接从 `view:render-overlay` payload 中读取 `text`
- [x] 4.3 实现双模式渲染
- [x] 4.4 降级模式原文折叠/展开交互
- [x] 4.5 降级模式三个操作按钮
- [x] 4.6 正常模式派发按钮
- [x] 4.7 保持现有交互不受影响

**验证**：`pnpm build` 通过。快捷键 B → 悬浮窗弹出并显示抓取文本 → 选任务点派发 → 悬浮窗消失 → 数据库中可见提取记录。构造不相关内容触发降级模式 → 悬浮窗显示警告 + 折叠原文 → 三个操作均正常。

---

## 阶段五：端到端集成验证与清理

**目标**：全链路验证两条派发路径，清理所有遗留代码，确保零死代码。

**依赖**：阶段一～四全部完成

| # | 任务 |
|---|------|
| 5.1 | 端到端：快捷键 A → silent 提取 → 相关内容入库 / 不相关内容降级至悬浮窗 |
| 5.2 | 端到端：快捷键 B → overlay 显示 → 选任务派发 → 入库 |
| 5.3 | 清理 Rust 侧遗留：`GrabState`、`grab-completed`、`consume_grabbed_result`、`GrabEnvelope` 的引用和 import |
| 5.4 | 清理 TypeScript 侧遗留：`grab-completed` 事件监听、`consume_grabbed_result` 调用 |
| 5.5 | 编译验证：`cargo build` + `cargo clippy` + `pnpm build` 全部通过，无死代码警告 |

- [ ] 5.1 端到端：快捷键 A 链路
- [ ] 5.2 端到端：快捷键 B 链路
- [x] 5.3 清理 Rust 侧遗留引用
- [x] 5.4 清理 TypeScript 侧遗留引用
- [x] 5.5 编译验证

**验证**：全量编译零警告，两条派发链路手动验证均可走通，全仓库 `grep -r "GrabState\|grab-completed\|consume_grabbed_result\|GrabEnvelope"` 仅剩注释/文档引用（无代码引用）。
