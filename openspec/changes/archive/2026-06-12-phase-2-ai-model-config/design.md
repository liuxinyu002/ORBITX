## Context

Phase-2 是 MVP 第一个业务功能阶段。Phase-1 已完成 Tauri + React + SQLite 的工程骨架。当前 `/settings` 路由是占位页，`src-tauri/src/commands/` 只有 `greet` 和 `log_event` 两个示例命令。需要在最小化改动现有代码的前提下，新增模型配置的完整生命周期管理。

核心约束：
- pi-agent-core 完全在前端 WebView 中运行，Rust 只做数据持久化
- API key 明文存 SQLite（桌面应用本地威胁模型）
- 单一激活模型（同一时间只有一个 `is_active = 1`）
- 连接测试用 pi-ai 的 `complete()` 而非 Agent 实例

## Goals / Non-Goals

**Goals:**
- 完整的模型配置 CRUD（Rust Tauri Commands + SQLite）
- 厂商预设：DeepSeek / OpenAI（pi-ai 内置 `getModel()`），智谱 / 自定义（手动构造 Model 对象）
- 连接可用性测试（HTTP ping → 成功/失败/延迟）
- 前端 `src/agent/` 模块骨架，为 Phase 5 Agent 使用铺路
- Settings UI 从占位页升级为完整功能页

**Non-Goals:**
- Agent 实例的实际运行（那是 Phase 5 的事）
- 多模型并行管理（单一激活，不同任务绑定不同模型是 Phase 3+ 的范围）
- API key 加密存储（Keychain/DPAPI）
- 模型调用的用量统计或费用计算
- Ollama 本地模型的自动发现（用户手动填 endpoint）

## Decisions

### D1: 前端全权负责 LLM 调用

**选择**: React WebView 直接发 HTTP 请求到各家 LLM 厂商，Rust 不做代理。

**理由**:
- pi-agent-core 是 TypeScript 库，设计目标就是跑在 JS runtime
- 减少一层 IPC 序列化/反序列化，特别是 SSE 流式响应的每个 chunk
- 桌面应用的单用户本地环境，API key 的暴露面可控

**舍去的方案**: Rust 做透明代理——增加复杂度、流式响应需在每个 chunk 上做 IPC 往返，收益（key 不出 Rust 进程）在桌面端场景下不够显著。

### D2: 连接测试用 complete() 而非 Agent

**选择**: Phase 2 使用 `@earendil-works/pi-ai` 的 `complete()` 函数做单次 ping 请求，不创建 Agent 实例。

**已验证 (pi-ai v0.79.1)**:
- `complete(model, context, options)` 签名确认存在
- `options` 原生支持 `apiKey`、`signal`（AbortSignal）、`timeoutMs`、`maxTokens`
- 返回 `AssistantMessage`，包含 `stopReason`、`errorMessage`、`content`、`usage` 字段
- HTTP 层面的错误（401/403/404）可能以异常形式抛出而非包含在返回的 AssistantMessage 中，连接测试需要对两种情况都做处理

**理由**:
- Phase 2 只需要验证 "API key 有效 + endpoint 可达"，不需要 tool calling / 多轮对话 / streaming
- `complete()` 是一次性 HTTP 请求，天然返回成功/失败和延迟
- 减少依赖面：`@earendil-works/pi-agent-core` 的 Agent 类需要处理 tool 定义、system prompt、message history 等，当前不需要

**Phase 5 衔接**: `src/agent/` 模块的 context 和 hook 结构按 Agent 使用形态设计，Phase 5 只需在 `AgentContext` 中真正初始化 Agent 实例并暴露 `prompt()` 方法。

### D3: 自定义厂商模型构造（已验证）

**选择**: 所有非内置厂商（智谱、自定义 OpenAI 兼容端点）通过手动构造符合 pi-ai `Model` 接口的对象来使用，无需任何动态注册 API。

**已验证 (pi-ai v0.79.1)**:
- pi-ai 中 **不存在 `registerProvider()` 函数**。方案最初假设的 "尝试 registerProvider 失败后 fallback 手动构造" 的流程不成立——手动构造 Model 对象是唯一且正确的路径。
- `getModel(provider, modelId)` 的 `provider` 参数受限于 `KnownProvider` 类型（"deepseek" | "openai" | "anthropic" | ...），不包含 "zhipu"。TypeScript 编译期就直接拒绝 `getModel("zhipu", ...)`。
- 内置的 `openai-completions` API provider 可以处理任何 OpenAI 兼容端点的请求（它不校验 baseUrl 是否属于某个特定厂商），手动构造的 Model 对象只要 `api: "openai-completions"` 就能正常调用 `complete()`。

**正确实现路径**:
```typescript
// 内置厂商（DeepSeek / OpenAI）：getModel() 直接获取
const dsModel = getModel("deepseek", "deepseek-chat");

// 自定义厂商（智谱 / Ollama 等 OpenAI 兼容端点）：手动构造 Model 对象
const zhipuModel: Model<"openai-completions"> = {
  id: "glm-4-flash",
  name: "GLM-4 Flash",
  api: "openai-completions",
  provider: "zhipu",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

// 统一调用连接测试
const result = await complete(model,
  { messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
  { apiKey: config.apiKey, maxTokens: 1, timeoutMs: 15000 }
);
```

**删去的方案**: ~~先尝试 registerProvider()，失败后 fallback 手动构造~~（registerProvider 不存在，手动构造始终是唯一路径）

### D4: API key 明文存储

**选择**: API key 以明文形式存在 SQLite 的 `model_configs.api_key` 列中。

**理由**:
- 桌面应用，数据库文件在用户自己的机器上 (`$APP_DATA_DIR/orbitx.db`)
- 没有服务端，没有网络传输
- 即使用 Keychain/DPAPI 加密，启动时还是要解密到内存中使用，且 Tauri WebView 的 JS context 也能拿到明文
- 务实选择：先明文，如果后续有合规需求再加固

### D5: 单一激活模型

**选择**: `model_configs.is_active` 为 `0`/`1`，`set_active_model` 在 Rust 侧事务中：先将所有配置的 `is_active` 置 0，再将目标配置置 1。

**理由**: 简化前端状态管理。全局只有一个激活模型，`AgentContext` 中只存一个当前 model 引用。未来如需多任务绑定不同模型，可以在 `tasks` 表中添加 `model_config_id` 外键，不影响当前设计。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| pi-ai `complete()` 抛出的 HTTP 异常（401/403/404）无法按状态码精确分类 | 连接测试使用 try/catch 包裹 `complete()`，对异常消息做关键字匹配（"unauthorized"/"401"/"403"→认证失败，"not found"/"404"→模型不存在）；都不匹配时返回通用错误消息 |
| 前端持有 API key 明文可能被浏览器扩展或 XSS 窃取 | Tauri WebView 默认不加载外部扩展，XSS 攻击面极小。后续可评估 Keychain 方案 |
| pi-agent-core 版本更新导致 API 变化 | 锁定具体版本号，package.json 中不使用 `^`。已固定 v0.79.1 |
| 4 家厂商的 OpenAI 兼容性差异导致连接测试行为不一致 | 连接测试仅验证 HTTP 200 + 非空响应，不验证响应内容语义 |
| 用户切换激活模型时，正在进行的 Phase 5 Agent 调用会受影响 | Phase 5 设计时 Agent 实例绑定 model snapshot，不随全局切换而变 |
| SQLite `UNIQUE(label)` 为区分大小写，但应用层需要不区分大小写唯一性 | Rust 层在插入/更新前做 `LOWER(label)` 比对；DB 约束作为最后防线 |

### D6: 设置页面 UI 重构 — 单表单卡片 + 选项卡切换

**选择**: 将设置页面从"多卡片网格 + 模型列表"两段式布局重构为"单一张卡片 + 顶部 Button Group 选项卡切换 + 双栏表单"的极简布局。左侧放置连接凭证配置（别名、API Key、代理地址），右侧放置模型管理与连接诊断（Model Chips、连接测试栏）。

**痛点**:
- 当前 4 个 ProviderCard 以 `lg:grid-cols-4` 网格排列，每个卡片仅 ~25% 宽度，表单域被严重挤压
- 展开多个卡片后页面冗长冗杂
- ModelList 在"每服务商一配置"的约束下是冗余信息——tab 切换本身就是选择要编辑的服务商

**新布局结构** (双栏: 左侧凭证配置 + 右侧模型管理与诊断):

```
┌──────────────────────────────────────────────┐ max-w-4xl, 居中
│  AI 模型连接设置                              │ CardHeader
│  配置您的 API 密钥以启用智能功能               │
├──────────────────────────────────────────────┤
│  [DeepSeek] [OpenAI] [智谱GLM] [自定义]       │ Segmented Control
├──────────────────────────────────────────────┤
│  左栏 (凭证)            │  右栏 (模型/诊断)    │
│                         │                    │
│  配置别名               │  启用模型           │
│  [_______________]      │  [v4-flash ×]      │
│                         │  [chat ×]          │
│  API 密钥               │  [+ 添加___]       │
│  [_______________] 👁   │                    │
│                         │  ● 未检测           │
│  接口代理地址           │  点击测试连接验证   │
│  [_______________]      │  [测试连接]         │
├──────────────────────────────────────────────┤
│  [重置默认]                   [取消] [保存]   │ CardFooter
└──────────────────────────────────────────────┘
```

**组件变更**:

| 变更 | 组件 | 说明 |
|------|------|------|
| 删除 | `ProviderCard.tsx` | 表单域内联到 `settings.tsx` |
| 删除 | `ModelList.tsx` | tab 切换即选择当前编辑的服务商 |
| 内联 | `ConnectionTestBadge.tsx` | 内联为连接测试栏的一部分 |
| 重写 | `settings.tsx` | 单卡片 + tab 切换布局 |
| 扩展 | `presets.ts` | 每 provider 增加 3-5 个常用模型可选列表 |

**Segmented Control 样式**:
- Button Group 风格，4 个并排按钮无缝拼接
- 圆角 `rounded-lg`（8px），**不使用**全圆角 pill
- 激活态：`bg-primary text-primary-foreground`（Cool Slate），符合 DESIGN.md 5% 规则
- 非激活态：`variant="ghost"`
- 容器加 `ring-1 ring-foreground/10` 描边

**Model Chips 样式**:
- 选中态：`bg-primary/10 text-primary ring-1 ring-primary/30`（浅底 + Cool Slate 描边）
- 未选中态：`bg-muted text-muted-foreground hover:bg-muted/80`
- 删除按钮：小 × 图标，hover 变红
- 手动输入：小尺寸 Input（`h-7`），placeholder "添加模型..."，回车/失焦追加

**连接测试栏样式**:
- 常驻显示，防止布局跳动
- 指示灯颜色：
  - 未检测：`bg-muted-foreground/30`（灰色）
  - 测试中：`bg-yellow-500 animate-pulse`（黄色闪烁）
  - 成功：`bg-green-500`（绿色）
  - 失败：`bg-destructive`（红色）
- API Key 为空时按钮不禁用，点击后 toast 提示"请先填写 API 密钥"

**底部操作栏**:
- 左："重置默认" → `variant="ghost"`（幽灵按钮）
- 右："取消" → `variant="ghost"`，"保存并应用" → `variant="default"`（Primary，Cool Slate）
- 按钮间距 8px（`gap-2`）

**状态缓冲架构**:
- `configData` state: `Record<ProviderId, { label, apiKey, baseUrl, modelIds[] }>`
- 页面加载：从后端 `get_model_configs` 拉取，按 provider 填入 buffer
- 切换 tab：先将当前表单值写入 buffer，再载入目标 tab 数据
- 保存：遍历 buffer 中变更项，逐条调用 `save_model_config`
- 重置：仅恢复当前 tab 的 preset 默认值，不影响其他 tab
- 取消：丢弃所有未保存变更，恢复 buffer 为加载时的快照

**每服务商一配置约束**:
- 每个 provider 最多保存一条配置
- 删除 ProviderCard 和 ModelList 后，激活状态由 **tab 对应的后端 config.isActive** 决定——用户保存某服务商配置后该配置自动成为激活配置
- `AgentContext` / `useModelConfig` / `useConnectionTest` 代码不变，仅调用方适配

**理由**:
- 单一表单卡片消除横向空间竞争，输入框有充足的 `max-w-xl` 宽度
- tab 切换自然映射到"选择服务商"的心智模型
- 状态 buffer 保证切换 tab 不丢数据，保存才真正持久化
- 全部符合 DESIGN.md 的色彩、间距、圆角、阴影规范

## Open Questions

- 智谱 API 的 `baseUrl` 是否需要加 `/v1` 后缀？需查阅最新文档
- `@earendil-works/pi-agent-core` 的 Agent 类在 React 生命周期（StrictMode 双挂载）下的行为？
