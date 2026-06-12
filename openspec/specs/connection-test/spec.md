# Connection Test

## Purpose

Define the connection test mechanism that validates AI model endpoint availability using pi-ai's `complete()` function. Covers test execution, error classification, timeout handling, logging, and the React hook interface.

## Requirements

### Requirement: Connection test logging
Before classifying the error, the connection test hook SHALL log the raw failure information via the existing `log_event` Tauri command. This ensures the developer can inspect the original error details even when the user sees a classified message.

#### Scenario: Raw error logged on test failure
- **WHEN** `complete()` throws an exception or returns `stopReason: "error"`
- **THEN** `log("info", "connection-test", \`连接测试失败: ${JSON.stringify({ provider, modelId, stopReason, errorMessage })}\`)` is called before error classification
- **THEN** the raw `stopReason` and `errorMessage` are preserved in the log for debugging

### Requirement: Connection test via pi-ai complete()
The connection test SHALL use `@earendil-works/pi-ai`'s `complete()` function to send a minimal ping request to the configured model endpoint. The test SHALL NOT use the full Agent class from pi-agent-core.

Error handling SHALL use try/catch around `complete()` because pi-ai may throw HTTP-level errors as exceptions rather than returning them through the `AssistantMessage` response. Both exception and `AssistantMessage.stopReason === "error"` SHALL be treated as failure paths.

#### Scenario: Successful connection test
- **WHEN** the user triggers a connection test
- **THEN** a request is sent via `complete(model, { messages: [{ role: "user", content: "ping", timestamp: Date.now() }] }, { apiKey, maxTokens: 1, timeoutMs: 15000, signal })`
- **THEN** upon receiving a valid `AssistantMessage` with `stopReason !== "error"`, `{ success: true, latencyMs: <number> }` is returned
- **THEN** the latency is the round-trip time in milliseconds (measured via `Date.now()` before/after `complete()`)

#### Scenario: Failed connection test due to invalid API key
- **WHEN** `complete()` throws an exception or returns `stopReason: "error"` with error message containing keywords `"unauthorized"`, `"401"`, or `"403"`
- **THEN** `{ success: false, error: "认证失败，请检查 API Key" }` is returned

#### Scenario: Failed connection test due to unreachable endpoint
- **WHEN** `complete()` throws a network-level exception (fetch failure, DNS error, or timeout)
- **THEN** `{ success: false, error: "无法连接到服务器，请检查 Base URL" }` is returned

#### Scenario: Failed connection test due to invalid model name
- **WHEN** `complete()` throws an exception or returns `stopReason: "error"` with error message containing keywords `"not found"`, `"404"`, or `"model_not_found"`
- **THEN** `{ success: false, error: "模型不存在，请检查 Model ID" }` is returned

#### Scenario: Failed connection test with unclassified error
- **WHEN** `complete()` fails with an error that doesn't match any known category
- **THEN** `{ success: false, error: "连接失败：{原始错误消息}" }` is returned (原始错误消息截断至 100 字符)

### Requirement: Connection test hook interface
The agent module SHALL export a `useConnectionTest` hook with the following interface:

```typescript
function useConnectionTest(): {
  test: (config: ModelConfig) => Promise<TestResult>;
  isTesting: boolean;
  lastResult: TestResult | null;
}

interface TestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}
```

#### Scenario: Hook manages loading state
- **WHEN** `test()` is called
- **THEN** `isTesting` becomes `true`
- **THEN** `isTesting` returns to `false` when the request completes (success or failure)

#### Scenario: Hook stores last result
- **WHEN** a test completes
- **THEN** `lastResult` is updated with the result
- **THEN** the previous result is replaced

### Requirement: Timeout handling
Connection tests SHALL have a 15-second timeout. Requests exceeding this timeout SHALL be treated as failures.

#### Scenario: Request times out
- **WHEN** a connection test exceeds 15 seconds without a response
- **THEN** the request is aborted
- **THEN** `{ success: false, error: "连接超时（超过 15 秒）" }` is returned

### Requirement: Provider-specific model resolution for testing
Before sending the test request, the hook SHALL resolve the model object:
- For built-in providers (DeepSeek, OpenAI): use `getModel(provider, modelId)` from pi-ai
- For custom providers (Zhipu, custom): construct a `Model<"openai-completions">` object manually conforming to pi-ai's `Model` interface
- If resolution fails: return `{ success: false, error: "无法解析模型配置" }`

#### Scenario: DeepSeek model resolved via getModel
- **WHEN** testing a DeepSeek config
- **THEN** `getModel("deepseek", "deepseek-chat")` returns the pi-ai built-in model object without any registration step

#### Scenario: Zhipu model constructed manually
- **WHEN** testing a Zhipu config
- **THEN** a `Model<"openai-completions">` object is constructed manually with the user's `base_url`, `model_id`, and `api_key`
- **THEN** the model object is passed directly to `complete()` — no `registerProvider()` or `registerApiProvider()` call is needed
