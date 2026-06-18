## Why

当前 prompt 要求 AI 返回的 `data` 格式不一致：Normal 模式为单对象 `{...}`，Force 模式也为单对象 `{...}`。但 prompt 中的 Data Quality Rules 又提到 "duplicate records"、"multiple records"、 "separate records"，暗示多条记录的可能性。AI 实际可能返回单对象或数组，导致 `result_json` 存入 DB 后形状不统一（对象、数组、嵌套字典），DataBrowser 和 Rust 导出层被迫到处做类型判断。从源头（prompt）统一格式为数组可以消除这种不必要的复杂度。

## What Changes

- **Prompt 模板标准化**：`buildNormalPrompt` 的 `data` 字段从 `{ ... }` 改为 `[{ ... }]`；`buildForcePrompt` 的输出从 `{ ... }` 改为 `[{ ... }]`，均增加"data 必须是对象数组"的明确约束
- **Cleaner 扩展**：`cleanExtractedData` 接受 `Record<string, unknown>[]`（数组时逐元素清洗，过滤全 null 元素）
- **Pipeline 路由适配**：`routeResult` 和 force 路径在 `cleanExtractedData` 返回数组时，将数组整体 `JSON.stringify` 后作为单条 DB 记录入库（一条 AI 调用 = 一行 DB 数据，导出层 `flatten_row` 自动展开）
- **防御性归一化**：`parseAIResponse` 后对 data/parsed 做 `Array.isArray(x) ? x : [x]` 包装，兼容 AI 偶尔不遵循指令和 DB 中旧数据
- **`parseAIResponse` 增强**：返回类型泛化以支持数组；fallback 解析补充 `[...]` 匹配

## Capabilities

### Modified Capabilities
- `extraction-pipeline`: prompt 输出格式从单对象变更为对象数组；pipeline 路由逻辑适配数组 data；增加防御性归一化步骤
- `extraction-results`: `result_json` 存储格式契约从"纯 data 对象"变更为"纯 data 数组"（单条记录也是单元素数组）

## Impact

- 前端：`src/agent/prompt/extraction.ts`（prompt 模板）、`src/agent/cleaner.ts`（清洗函数签名）、`src/agent/pipeline.ts`（路由逻辑）、`src/agent/extractor.ts`（解析函数）
- 测试：`src/agent/__test__/extraction-prompt.test.ts`（断言更新）
- Rust：`extraction.rs` 的 `flatten_row` 无需改动（已正确处理 Object/Array 两种分支）
- DB：无需迁移（旧数据为单对象的仍通过防御性归一化和 DataBrowser 现有兼容逻辑正常展示）
- 无 **BREAKING** 变更（向后兼容旧数据）
