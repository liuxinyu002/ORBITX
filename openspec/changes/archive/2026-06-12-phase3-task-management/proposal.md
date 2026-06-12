## Why

Phase-2 完成后，用户可以配置 AI 模型端点，但还没有"任务"和"Schema"的概念来连接"用户意图"与"AI 提取行为"。Phase-3 是连接"用户说什么"和"AI 提取什么"的纽带——需要提供任务 CRUD、AI 辅助生成表头、可视化 Schema 编辑器三大能力，为 Phase-5 的数据提取管线提供严格的结构化字段定义。

## What Changes

- 新增 `tasks` 表（Schema 以 JSON TEXT 列内嵌，不使用独立的 `schema_fields` 表）
- 新增 6 个 Tauri Command：`create_task`、`list_tasks`、`get_task`、`update_task`、`delete_task`、`set_active_task_id`
- 新增 `/tools/extractor` 页面的完整 UI：左侧任务列表栏 + 右侧 Schema 编辑器
- 新增 AI 草稿生成功能：用户输入自然语言 → 调用已配置模型 → 生成字段列表
- 新增可视化表单编辑器：对 Schema 字段进行增、删、改、类型选择
- **BREAKING**：`tasks` 表不再有 `is_active` 列，激活状态改用 `app_kv` 表中的 `active_task_id` 键
- **BREAKING**：移除 `schema_fields` 独立表，Schema 简化为 JSON 内嵌（每任务一个当前 Schema）
- 时间戳格式统一为 ISO 8601 (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)，修正 `model_configs` 表的旧格式
- `AgentProvider` 提升到 App 级别（Phase-3 已需要 AI 调用）

## Capabilities

### New Capabilities
- `task-crud`: 任务生命周期管理——创建、列表、查看、更新（PATCH 语义）、物理删除
- `task-activation`: 任务激活态管理——全局单一激活任务，通过 `app_kv.active_task_id` 存储，左侧 Switch 排他单选
- `schema-editor`: 可视化 Schema 编辑器——表格行式字段列表，支持增删改、类型选择、必填标记、描述编辑
- `schema-ai-generation`: AI 草稿生成——自然语言 → JSON Schema，前端侧调用 pi-ai，容错解析 markdown 包裹，Fail Fast 报错

### Modified Capabilities
- `data-model`: `tasks` 表结构变更——移除 `is_active` 列，新增 `schema TEXT` 列（JSON 内嵌）；移除 `schema_fields` 独立表；时间戳格式从 `datetime('now')` 改为 `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
- `database-layer`: V3 迁移创建 `tasks` 表（内嵌 schema JSON），统一 `model_configs` 时间戳格式为 ISO 8601
- `agent-module`: `AgentProvider` 从 `/settings` 路由提升到 App 级别包裹

## Impact

- Affected code: `src-tauri/src/models/` (新增 `task.rs`)、`src-tauri/src/commands/` (新增 `task.rs`)、`src-tauri/src/db/migrations.rs` (V3 迁移)、`src/routes/tools/structured-extractor.tsx` (替换骨架)、`src/App.tsx` (提升 AgentProvider)
- Affected specs: `data-model`、`database-layer`、`agent-module`
- Affected docs: `docs/SCHEMA.md` 需重写 Phase-3 部分
- Dependencies: Phase-2（模型配置与 Agent 模块）
