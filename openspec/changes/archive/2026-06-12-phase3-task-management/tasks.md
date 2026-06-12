## 1. 数据库迁移与 Rust 模型

- [x] 1.1 创建 `src-tauri/src/models/task.rs`，定义 `Task`、`TaskSimple`（含 `updated_at`）、`TaskListResponse` 结构体
- [x] 1.2 重构 `src-tauri/src/models/mod.rs`：将 `ModelConfig` 拆分到 `models/model_config.rs`，`pub mod` 统一导出
- [x] 1.3 V3 迁移：创建 `tasks` 表（含 `schema TEXT` 列，ISO 8601 时间戳默认值；`ORDER BY updated_at DESC` 索引可选）
- [x] 1.4 V3 迁移：重建 `model_configs` 表统一时间戳默认值为 ISO 8601（存量数据不转换，仅改 DEFAULT）
- [x] 1.5 编写 V3 迁移的单元测试（创建 tasks 表、model_configs 时间戳默认值、幂等、数据保留）
- [x] 1.6 新增 `db::delete_kv()` 函数；修复 `db::set_kv` 的 `updated_at` 为 ISO 8601 格式

## 2. Tauri Command 实现

- [x] 2.1 创建 `src-tauri/src/commands/task.rs`，实现 `create_task` command
- [x] 2.2 实现 `list_tasks` command（`ORDER BY updated_at DESC`；`get_kv("active_task_id")` NotFound 时返回 `None`）
- [x] 2.3 实现 `get_task` command
- [x] 2.4 实现 `update_task` command（PATCH 语义，`name`、`description`、`schema` 三个参数均为 `Option<String>`，全部使用 `COALESCE` 跳过 NULL）
- [x] 2.5 实现 `delete_task` command（先清除 `app_kv.active_task_id` 再物理删除；使用事务确保原子性）
- [x] 2.6 实现 `set_active_task_id` command（`Option<String>` 参数，`None` 时调用 `delete_kv` 删除键）
- [x] 2.7 在 `commands/mod.rs` 中导出，在 `lib.rs` 中注册 6 个新 command
- [x] 2.8 编写 task commands 的单元测试（CRUD 完整覆盖 + PATCH 语义 + 删除激活任务清除 KV）

## 3. AgentProvider 提升到 App 级别

- [x] 3.1 在 `App.tsx` 中包裹 `AgentProvider`，移除 `/settings` 路由内的局部包裹
- [x] 3.2 验证 `/settings` 页面模型配置功能正常，`/tools/extractor` 可调用 `useAgent()`

## 4. 前端类型与 hooks

- [x] 4.1 定义 `Field`、`TaskSchema` TypeScript 类型（`src/lib/types.ts` 或内联于 task hooks）
- [x] 4.2 定义 Zod 校验 schema（`fieldSchema` + `taskSchemaValidator`，含字段名重复检测）
- [x] 4.3 创建 `useTaskList` hook：管理任务列表、搜索关键词、激活状态切换、CRUD 操作
- [x] 4.4 创建 `useTaskDraft` hook：管理字段列表 draft、isDirty 标记、AI 生成状态、保存流程、任务名自动保存失败时回退到旧值
- [x] 4.5 实现脏检测确认弹窗逻辑（`isDirty=true` 时切换任务弹出确认）
- [x] 4.6 编写 `useTaskList` 和 `useTaskDraft` 的单元测试（dirty 状态机、脏检测弹窗、AI 生成状态、自动保存回退）

## 5. 左侧栏 UI（Sidebar）

- [x] 5.1 实现任务搜索框（Search Bar）
- [x] 5.2 实现任务列表渲染（Task Item Row：激活 Switch + 任务名 + 删除按钮）
- [x] 5.3 实现激活 Switch 排他单选行为（Radio 逻辑，Switch 视觉）
- [x] 5.4 实现 `window.confirm` 删除确认 + 调用 `delete_task`
- [x] 5.5 实现底部"新建任务"按钮
- [x] 5.6 选中任务行高亮样式 + 点击触发 `onSelectTask(id)`

## 6. 右侧主面板 UI（Main Content Panel）

- [x] 6.1 实现任务基本信息区域（Task Base Info Area）：任务名输入（失焦自动保存）+ 任务描述输入
- [x] 6.2 实现 AI Generation Zone：自然语言输入框 + "生成草稿"按钮（loading 状态）
- [x] 6.3 实现 Schema Editor Zone 表头行（字段名、类型、必填、说明、操作）
- [x] 6.4 实现 Field Row 循环渲染：字段名 input（实时重复校验提示）、类型 Select、必填 Switch、说明 input、删除按钮
- [x] 6.5 实现"添加字段"按钮
- [x] 6.6 实现底部 Action Bar："保存修改"按钮（触发 Zod 校验 + `update_task` + Toast 反馈）
- [x] 6.7 实现空状态占位（`selectedTaskId` 为 null 时右侧面板仅显示居中提示"请在左侧选择一个任务"，不渲染编辑器、AI Generation Zone、Action Bar）

## 7. AI 草稿生成

- [x] 7.1 创建 `src/agent/extractor.ts`，实现 System Prompt 模板（按工具模块命名，后续 Phase-5 数据提取 prompt 也存放于此）
- [x] 7.2 实现 AI 调用流程：获取活跃模型 → `resolveModel` → `complete()` → 解析响应
- [x] 7.3 实现 JSON 容错解析（剥离 markdown 代码块 → JSON.parse）
- [x] 7.4 实现 Fail Fast：解析失败 → Toast "AI 返回格式异常，请重试"
- [x] 7.5 实现生成成功 → 覆盖 draft state（`isDirty = true`）
- [x] 7.6 处理无激活模型情况（Toast + 不发起请求）

## 8. UI 组件优化

- [x] 8.0a 字段类型选择器改用 Button + DropdownMenuRadioGroup，替换原生 `<select>`
- [x] 8.0b 创建 `src/lib/navigation-guard.tsx`，实现 `NavigationGuardProvider` + `useNavigationGuard`
- [x] 8.0c `App.tsx` 包裹 `NavigationGuardProvider`，`Header.tsx` 返回按钮调用 `checkGuard()` 拦截导航
- [x] 8.0d `StructuredExtractor` 注册导航守卫：`draft.isDirty` 时弹出确认弹窗

## 9. 集成验证

- [x] 9.1 端到端验证：创建任务 → AI 生成字段 → 手动调整 → 保存 → 列表刷新（需启动应用手动测试）
- [x] 9.2 边界测试：空字段名保存、重复字段名、description 超长、切换任务脏弹窗、Header 返回按钮脏弹窗（需启动应用手动测试）
- [x] 9.3 验证 V3 迁移幂等性（多次启动不报错）— 已通过 `v3_migration_is_idempotent` 测试验证
- [x] 9.4 验证 `model_configs` 时间戳格式已统一为 ISO 8601 — 已通过 `v3_model_configs_uses_iso8601_default` 测试验证
