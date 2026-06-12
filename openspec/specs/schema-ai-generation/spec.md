# Schema AI Generation

## Purpose

Define the AI-powered Schema draft generation feature: natural language input → call active model → parse JSON response → populate field editor. Part of the `src/agent/extractor.ts` module, shared with Phase-5 data extraction prompts.

## Requirements

### Requirement: AI 草稿生成入口
右侧面板 AI Generation Zone SHALL 包含一个自然语言输入框和一个"生成草稿"按钮。按钮在模型请求进行中时显示 loading 状态并禁用。

#### Scenario: 输入自然语言描述
- **WHEN** 用户在输入框中输入"提取简历中的候选人姓名、邮箱、手机号、工作年限"
- **THEN** 点击"生成草稿"按钮触发 AI 调用

#### Scenario: 请求进行中
- **WHEN** AI 调用进行中
- **THEN** 按钮显示 spinner 并禁用
- **THEN** 输入框禁用

### Requirement: System Prompt 定义
System Prompt SHALL 定义在 `src/agent/extractor.ts`（按工具模块命名），并遵循三级访问模式：

```
src/agent/extractor.ts — 纯 prompt 模板字符串
src/agent/index.ts     — re-export 供外部使用
src/routes/tools/...   — 前端调用点
```

System Prompt 内容：

```json
{
  "role": "system",
  "content": "You are a precise data schema architect. Your job is to convert user's data extraction requirement into a structured JSON Schema.\n\nStrict JSON Format:\n{\n  \"fields\": [\n    {\n      \"name\": \"snake_case_identifer\",\n      \"type\": \"String\" | \"Number\" | \"Date\",\n      \"required\": true | false,\n      \"description\": \"Specific criteria for extraction, matching the input language.\"\n    }\n  ]\n}\n\nRules:\n1. 'name' must use english letters and underscores only.\n2. Keep fields highly dense and essential. Do not generate redundant fields.\n3. Keep description clear, short, and optimized for down-stream LLM extraction.\n4. Respond ONLY with valid JSON. If markdown container is used, ensure it is strictly ```json ... ```."
}
```

#### Scenario: System Prompt 约束字段数量
- **WHEN** 用户描述中包含 20 个潜在提取项
- **THEN** AI 仅返回核心高频字段（自动精简）

### Requirement: AI 调用流程
前端 SHALL 执行以下调用流程：

1. 从 `useAgent()` 获取 `activeModel`，若无激活模型则 Toast "请先在设置中配置并激活模型"
2. 通过 `getApiKey(activeModel.id)` 获取完整 api_key
3. 调用 `resolveModel(config)` 构造 Model 对象
4. 调用 `complete(model, { messages: [systemPrompt, userMessage] }, { apiKey, maxTokens: 4096 })`
5. 解析响应 JSON

#### Scenario: 无激活模型时生成
- **WHEN** 点击"生成草稿"但没有激活模型
- **THEN** Toast "请先在设置中配置并激活模型"
- **THEN** 不发起 AI 请求

#### Scenario: AI 调用超时
- **WHEN** AI 请求超过 15 秒未响应
- **THEN** Toast "AI 生成超时，请重试"
- **THEN** `isGenerating` 重置为 false

### Requirement: JSON 容错解析
前端 SHALL 对 AI 返回的文本执行容错解析：

1. 用正则提取 ` ```json ` 和 ` ``` ` 之间的内容（如果存在）
2. 若未找到代码块，尝试在整个文本中匹配第一个 `{` 到最后一个 `}`
3. `JSON.parse()` 解析
4. 解析失败 → Toast "AI 返回格式异常，请重试"

#### Scenario: 模型返回 markdown 包裹的 JSON
- **WHEN** AI 返回 ` ```json\n{"fields":[...]}\n``` `
- **THEN** 成功剥离 markdown 标记并解析 JSON
- **THEN** `fields` 覆盖 draft state 中的字段列表
- **THEN** `isDirty` 置为 true

#### Scenario: 模型返回纯 JSON
- **WHEN** AI 返回 `{"fields":[...]}`
- **THEN** 直接解析成功

#### Scenario: JSON 格式错误
- **WHEN** AI 返回格式损坏的 JSON（如未闭合引号）
- **THEN** JSON.parse 抛出异常
- **THEN** Toast "AI 返回格式异常，请重试"
- **THEN** `isGenerating` 重置为 false
- **THEN** 草稿不受影响（字段列表不变）

### Requirement: AI 生成覆盖 Draft State
解析成功后，AI 返回的字段列表 SHALL 直接覆盖前端 draft state（`fields` 数组）。现有未保存的字段列表将被替换。

#### Scenario: AI 生成覆盖现有草稿
- **WHEN** 用户手动创建了 2 个字段（未保存），然后 AI 生成返回 5 个字段
- **THEN** 编辑器显示 AI 生成的 5 个字段
- **THEN** 之前的 2 个手动字段被覆盖
- **THEN** `isDirty` 置为 true

### Requirement: description 语言跟随用户输入
System Prompt 规则要求 AI 以用户输入语种生成 description。用户用中文描述 → description 为中文，用户用英文 → description 为英文。

#### Scenario: 中文输入生成中文 description
- **WHEN** 用户输入"提取中药药材的名称、拉丁学名、功效"
- **THEN** 生成的 description 字段为中文描述（如 "药材的中文名称"）
