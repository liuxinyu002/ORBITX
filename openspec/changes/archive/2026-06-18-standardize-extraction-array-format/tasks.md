## 1. Prompt 模板标准化

- [x] 1.1 `buildNormalPrompt`：`data` 字段从 `{ /* extracted fields */ }` 改为 `[{ /* extracted fields */ }]`，增加 "data must always be an array of objects" 约束说明
- [x] 1.2 `buildForcePrompt`：输出示例从 `{ /* extracted fields */ }` 改为 `[{ /* extracted fields */ }]`，增加同样约束

## 2. parseAIResponse 增强

- [x] 2.1 返回类型从 `Record<string, unknown> | null` 改为 `Record<string, unknown> | unknown[] | null`
- [x] 2.2 fallback 解析增加 `[...]` 匹配分支（在现有 `{...}` 匹配之后）

## 3. Cleaner 扩展

- [x] 3.1 `cleanExtractedData` 签名扩展为接受 `Record<string, unknown> | Record<string, unknown>[]`，返回类型对应扩展
- [x] 3.2 数组输入：逐元素清洗，过滤全 null 元素，全空返回 null

## 4. Pipeline 路由适配

- [x] 4.1 `routeResult`：对 `parsed.data` 做防御性归一化（`Array.isArray(x) ? x : [x]`），清洗后整体 `JSON.stringify` 入库
- [x] 4.2 force 路径：对 `parsed` 做防御性归一化，清洗后整体 `JSON.stringify` 入库

## 5. 测试更新

- [x] 5.1 更新 `extraction-prompt.test.ts`：断言 prompt 输出要求数组格式
- [x] 5.2 验证：`tsc --noEmit` 通过（前端类型检查）
- [x] 5.3 验证：`cargo test` 通过（Rust 导出层回归）

## 6. 日志埋点

- [x] 6.1 `routeResult`：防御性归一化触发时（对象包装为单元素数组）输出 debug 日志
- [x] 6.2 force 路径：防御性归一化触发时输出 debug 日志
- [x] 6.3 `cleanExtractedData` 数组分支：过滤全 null 元素时输出 debug 日志，含过滤数量
