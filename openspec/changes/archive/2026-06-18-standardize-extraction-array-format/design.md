## Context

当前提取管线的 prompt 层、清洗层和路由层均假定 AI 返回单对象。但 `extraction-pipeline` spec 中的 Data Quality Rules（去重、多实体保留）暗示多条记录的可能性，与单对象假定矛盾。Phase 6 的 `polish-extraction-data-grid` 已在渲染层和导出层增加了数组兼容处理，但源头的不统一仍然存在。

本设计遵循 CLAUDE.md 的克制原则：只改必须改的，用最少的代码解决问题。DB schema 不动，Rust 导出层不动。

## Goals / Non-Goals

**Goals:**
- 统一 prompt 输出格式：`data` 始终为对象数组（单条记录也是单元素数组）
- 清洗层支持数组输入
- Pipeline 路由适配数组 data
- 防御性归一化：AI 不遵循指令时自动包装

**Non-Goals:**
- 不拆分数组为多条 DB 行（一条 AI 调用 = 一行 DB 数据）
- 不修改 Rust 导出层（`flatten_row` 已正确处理）
- 不迁移 DB 历史数据（旧数据通过防御性归一化和现有 UI 兼容逻辑处理）
- 不修改 DB schema 或 Tauri command 签名

## Decisions

### 1. 存储策略：整体数组入库

**决策**：一条 AI 调用产生的数组整体 `JSON.stringify` 后作为单条 DB 记录的 `result_json` 存储。

**备选方案**：拆分为 N 条 DB 行（每个数组元素一条）。拒绝理由：
- 需要 N 次 `insert_extraction` + N 个 `extraction-completed` 事件
- 前端 DataBrowser 会瞬间收到 N 行插入动画
- 丧失"一次提取"的语义原子性
- 导出层 `flatten_row` 已支持数组展平，整体存储不影响导出

**理由**：一次 AI 调用 = 一次提取 = 一行数据，语义清晰。导出时 `flatten_row` 自动将数组展平为多行 CSV/XLSX。

### 2. 防御性归一化位置

**决策**：在 `pipeline.ts` 的 `routeResult`（第 66 行前）和 force 路径（第 279 行前）各加一行：
```
data = Array.isArray(data) ? data : [data]
```

**备选方案**：放在 `parseAIResponse` 内部。拒绝理由：
- `parseAIResponse` 是通用 JSON 解析器，不应耦合业务语义
- Normal 模式需要归一化的是 `parsed.data`（嵌套字段），Force 模式需要归一化的是 `parsed`（顶层），放在各自调用点更清晰

**理由**：成本极低（`Array.isArray` 是 O(1)），覆盖 AI 不遵循指令和 DB 旧数据两种场景。

### 3. Cleaner 数组处理

**决策**：`cleanExtractedData` 签名扩展为 `Record<string, unknown> | Record<string, unknown>[]`。数组输入时：
1. 逐元素调用现有清洗逻辑
2. 过滤掉清洗后全为 null 的元素
3. 若所有元素都被过滤，返回 null
4. 否则返回清洗后的数组

**理由**：复用现有清洗逻辑（`cleanValue` 已递归处理），最小改动。

### 4. parseAIResponse fallback 补充

**决策**：在 `extractor.ts` 的 fallback 解析中增加 `[...]` 匹配分支。当前仅匹配 `{...}`，force 模式返回数组时无法通过 fallback 解析。

**理由**：一行代码，覆盖 AI 在数组外套 markdown 代码块但第一层匹配失败的边缘情况。

## Risks / Trade-offs

- **AI 不遵循数组指令**：即使 prompt 明确要求数组，AI 偶尔可能仍返回单对象。→ 防御性归一化兜底。
- **旧数据兼容**：DB 中已有单对象格式的 `result_json`。→ DataBrowser 的 `getFieldValue` 和展开面板已兼容两种格式；Rust `flatten_row` 的对象分支保持不变。
- **导出数据量**：数组整体存储后，`result_json` 字段可能变大（多条记录在一个 JSON 中），但单次提取的记录数通常 < 100，远小于 `MAX_RAW_TEXT_LEN`（50KB）的约束范围。→ 无需特殊处理。
