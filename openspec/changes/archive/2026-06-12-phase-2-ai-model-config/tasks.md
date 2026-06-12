## 1. 依赖安装与验证

- [x] 1.1 安装 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core` 到 package.json（pin 版本 0.79.1）
- [x] 1.2 验证 pi-ai v0.79.1 实际 API：确认 `registerProvider()` 不存在；确认 `complete()` 签名；确认 `getModel()` 仅支持 KnownProvider；确认自定义厂商必须手动构造 Model 对象
- [x] 1.3 创建 `.env.example`（如不存在）— 添加 `LOG_LEVEL`、`NODE_ENV` 等基础配置项

## 2. Rust 后端 — 数据模型与错误处理

- [x] 2.1 在 `src-tauri/src/errors.rs` 中新增 `AppError::DuplicateModelLabel(String)` 变体（标签不区分大小写唯一）
- [x] 2.2 在 `src-tauri/src/errors.rs` 中新增 `SerializableError::Duplicate(String)` 变体，并更新 `From<AppError>` 转换
- [x] 2.3 在 `src-tauri/src/models/mod.rs` 中定义 `ModelConfig` 和 `ModelConfigInput` 结构体（serde Serialize/Deserialize）
- [x] 2.4 实现 API key 掩码函数 `mask_api_key(key: &str) -> String`：len>8 显示前 4 + "***" + 后 4；len>4 显示 "****"；len<=4 显示 "****"

## 3. Rust 后端 — 数据库 Migration V2

- [x] 3.1 在 `src-tauri/src/db/migrations.rs` 中新增 V2 migration，SQL 包裹在 `BEGIN`/`COMMIT` 事务内：
  - `CREATE TABLE model_configs (...)` — 列名使用 `provider`/`label`/`base_url`/`model_id`/`model_name`，含 `UNIQUE(label)`
  - `CREATE INDEX idx_model_configs_active ON model_configs(is_active)`
  - `UPDATE app_kv SET value = '2' WHERE key = 'schema_version'`

## 4. Rust 后端 — Tauri Commands

- [x] 4.1 创建 `src-tauri/src/commands/model_config.rs`，实现 `save_model_config` 命令（UUID v4 生成、LOWER(label) 全局不区分大小写唯一性校验、INSERT/UPDATE）
- [x] 4.2 实现 `get_model_configs` 命令（返回列表，api_key 经 `mask_api_key()` 脱敏）
- [x] 4.3 实现 `delete_model_config` 命令（**Rust 层先检查目标是否为 is_active=1，是则拒绝**，不允许删除激活模型；不存在时返回 NotFound）
- [x] 4.4 实现 `set_active_model` 命令（`BEGIN` 事务内：全部置 0 → 目标置 1 → `COMMIT`）
- [x] 4.5 实现 `get_active_model` 命令（返回完整 api_key）
- [x] 4.6 实现 `get_model_api_key` 命令（按 id 返回完整 api_key）
- [x] 4.7 在 `src-tauri/src/commands/mod.rs` 中注册 `model_config` 模块
- [x] 4.8 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册所有新命令

## 5. 前端 — Agent 模块骨架

- [x] 5.1 创建 `src/agent/types.ts`，定义 `ModelConfig`、`ModelConfigInput`、`ProviderPreset` TypeScript 类型
- [x] 5.2 创建 `src/agent/providers/presets.ts`，定义 4 家厂商预设数据（DeepSeek/OpenAI 内置；智谱/Custom 手动构造），每个预设包含 `builtin` 字段
- [x] 5.3 创建 `src/agent/providers/registry.ts`，实现 `resolveModel(config: ModelConfig)` 函数：
  - built-in 厂商：返回 `getModel(provider, modelId)`
  - 非 built-in 厂商：手动构造 `Model<"openai-completions">` 对象（包含 `id`/`name`/`api`/`provider`/`baseUrl`/`reasoning`/`input`/`cost`/`contextWindow`/`maxTokens` 全部必需字段）
  - 无 `registerProvider` 调用（此函数不存在）
- [x] 5.4 创建 `src/agent/AgentContext.tsx`，实现 `AgentProvider` + `useAgent` hook（activeModel、configs、setActiveModel、refreshConfigs）。**Phase-2 仅在 `/settings` 路由内包裹**，Phase-5 提升到 App 级别
- [x] 5.5 创建 `src/agent/hooks/useModelConfig.ts`，封装 Tauri command 调用（save/get/delete/setActive/getActive）
- [x] 5.6 创建 `src/agent/hooks/useConnectionTest.ts`，实现 `test(config)`：
  - 手动测量 `Date.now()` 往返时间
  - `complete()` 调用（AbortController 15s 超时 + `timeoutMs: 15000` 双保险）
  - 失败时先通过 `log("info", "connection-test", ...)` 输出原始 stopReason 和 errorMessage（JSON.stringify 拼入 message）
  - 然后 try/catch 错误分类（关键字匹配：401/403→认证、404→模型不存在、网络错误→无法连接、其他→通用+原始消息截断 100 字符）
- [x] 5.7 创建 `src/agent/index.ts`，统一导出 public API

## 6. 前端 — 设置页面 UI（v1: 多卡片网格 + 模型列表）

- [x] 6.1 创建 `src/components/settings/ProviderCard.tsx`（厂商卡片：可展开/折叠、预填表单字段、保存按钮）
- [x] 6.2 ~~创建 CustomProviderForm.tsx~~ — 已合并到 ProviderCard
- [x] 6.3 创建 `src/components/settings/ModelList.tsx`（已配置模型列表）
- [x] 6.4 创建 `src/components/settings/ConnectionTestBadge.tsx`（连接测试结果指示器）
- [x] 6.5 重写 `src/routes/settings.tsx`，整合所有设置页面组件
- [x] 6.6 在 `/settings` 路由内包裹 `AgentProvider`

## 7. 前端 — 设置页面 UI 重构（v2: 单表单卡片 + 选项卡切换）

参考：`design.md` D6 决策、`specs/settings-ui/spec.md`

- [x] 7.1 扩展 `src/agent/providers/presets.ts` — 每 provider 增加 `commonModels` 字段（3-5 个常用模型供 chip 选择）
- [x] 7.2 删除 `src/components/settings/ProviderCard.tsx`（表单域内联到 settings.tsx）
- [x] 7.3 删除 `src/components/settings/ModelList.tsx`（tab 切换即选择当前编辑的服务商）
- [x] 7.4 重写 `src/routes/settings.tsx`：
  - 单 `<Card>` 容器，`max-w-xl` 居中
  - CardHeader：标题 + 描述
  - Button Group 分段控制器（4 tab，`rounded-lg`，激活态 `bg-primary`）
  - 动态表单：别名、API Key（password + 眼睛）、Base URL、Model Chips 多选
  - 连接测试栏内联（状态灯 + 描述 + 测试按钮）
  - CardFooter：重置默认 / 取消 / 保存并应用
  - 状态缓冲：`configData` state 保证切换 tab 不丢数据
  - 保留 `useAgent()` hook 调用，后端通信逻辑不变
- [x] 7.5 删除或内联 `ConnectionTestBadge.tsx`（连接测试逻辑内联到 settings.tsx 的测试栏中）
- [x] 7.6 验证：确认 `AgentContext` / `useModelConfig` / `useConnectionTest` 代码无变更，仅调用方适配


