## Why

MVP 的所有 AI 功能（Schema 生成、数据提取）依赖用户先配置至少一个可用的模型端点。Phase-2 需要建立多厂商 AI 模型配置的完整生命周期管理，让用户以 BYOK 模式接入 DeepSeek、智谱、OpenAI 以及自定义 OpenAI 兼容端点（如 Ollama）。

## What Changes

- 新增 `model_configs` 数据表与完整的 CRUD Tauri Commands（Rust 侧）
- 新增 `src/agent/` 前端模块，封装 pi-agent-core 的 provider 注册与 Agent 生命周期
- 落地全局设置页面，包含厂商预设卡片、自定义表单、模型列表与连接测试
- 接入 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core` 两个依赖包
- 数据库 migration V2 扩展现有 SQLite schema
- 错误类型扩展，新增模型配置相关的 `NotFound` 和 `InvalidState` 变体

## Capabilities

### New Capabilities

- `model-config`: 模型配置的 CRUD 与持久化。支持 DeepSeek/OpenAI（pi-ai 内置）和智谱/自定义（OpenAI 兼容 provider 动态注册）。单一激活模型管理，API key 明文存 SQLite。
- `agent-module`: React 前端独立的 agent 模块。封装 pi-agent-core 的 provider 注册逻辑（区分内置与自定义），提供 AgentContext 和 Agent 实例管理钩子，为 Phase 5 的 Agent 调用铺路。
- `settings-ui`: 全局设置页面 UI。厂商快捷配置卡片（DeepSeek/智谱/OpenAI/自定义），已配置模型列表，模型激活切换，删除确认。
- `connection-test`: 模型连接可用性测试。通过 pi-ai 的 `complete()` 发送最小化请求（ping），返回成功/失败状态与响应延迟。

### Modified Capabilities

- `database-layer`: 新增 V2 migration，创建 `model_configs` 表。`app_kv` 不变，仅追加新表。
- `error-handling`: `AppError` 新增 `DuplicateModelLabel` 变体。`SerializableError` 新增对应序列化分支。
- `data-model`: 新增 `ModelConfig` Rust 结构体及对应的 TypeScript 类型定义。

## Impact

- **Rust 后端**: `src-tauri/src/commands/model_config.rs`（新），`migrations.rs`（追加 V2），`models/mod.rs`（新增结构体），`errors.rs`（新增错误变体），`lib.rs`（注册新 commands）
- **React 前端**: `src/agent/`（新模块），`src/components/settings/`（新组件），`src/routes/settings.tsx`（重写），`package.json`（新增 2 个依赖）
- **依赖**: `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`
- **无破坏性变更**: Phase-1 的 API 和数据结构均保持不变
