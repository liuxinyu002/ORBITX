## Context

Phase 6 的数据网格和导出功能假设 `result_json` 为单个 JSON 对象。但 AI 提取实际可能返回数组（一次抓取匹配多个实体），当前处理策略是前端 fallback（单元格显示 `—`，展开面板 dump `<pre>` JSON），导出层未处理数组导致数据行为空。

本项目遵循 CLAUDE.md 的克制原则：不做推测性设计，用最少代码解决问题。DB 层保持不动（1 条记录 = 1 行物理数据），数组处理收敛到前端渲染层和 Rust 导出层各自应对。

本设计遵循项目 `DESIGN.md` 的 token 体系、Flat-By-Default 规则、5% 规则、Skeleton 优先于 Spinner 等组件状态要求。所有颜色通过 `globals.css` 语义化 token（`bg-card`、`text-foreground`、`text-muted-foreground` 等）引用，不引入新的硬编码色值。

## Goals / Non-Goals

**Goals:**
- 数组 `result_json`：表格单元格显示摘要标记，展开面板按序号 Drill-down，导出展平为多行
- 嵌套对象/数组值：递归格式化为可读字符串，彻底消除 `[object Object]`
- 动画机制：ref + tick → React state + CSS transition/animation
- 颜色：移除所有硬编码 Hex，统一复用 `globals.css` 语义化 token

**Non-Goals:**
- 不引入 SQL 层 `json_each` 展开
- 不更改 DB schema 或 Tauri command 签名
- 不新增 npm/cargo 依赖
- 不处理非数组/非对象的原始类型 `result_json`（如纯字符串、纯数字——当前校验已拒绝）

## Decisions

### 1. 三层各自治：DB 不动，前端和导出各自展开

**决策**：DB 层 `list_extractions` 不做任何变更，`result_json` 按原样返回。前端和 Rust 导出层各自在消费点检测和处理数组。

**理由**：DB 查询语义（分页 total、删除 1 对 1）保持清晰。展开逻辑不进入 SQL，避免虚拟 ID、total 重算、删除联动等连锁问题。

### 2. 前端渲染：摘要标记 + 序号 Drill-down

**决策**：

表格单元格（`getFieldValue`）：
- `result_json` 是对象 → 取字段值（不变）
- `result_json` 是数组 → 返回 `undefined`，单元格渲染 `[包含 N 项数据]` 摘要

展开面板：
- 对象 → `<dl>` 键值对（不变）
- 数组 → 按序号渲染每项：`第 1 项` / `第 2 项` ... 每项内部 `<dl>` 键值对

**摘要标记状态**：`[包含 N 项数据]` 为静态信息文本（`text-muted-foreground`），不可交互，无 hover/focus/active 状态。

**Drill-down 分段状态**：`第 N 项` label 使用 `text-xs font-medium text-muted-foreground`，分隔边框使用 `border-border`。分段内容为只读信息，无交互状态。

**展开面板加载**：展开面板内容来自已加载的 `result_json` 同步解析（`parseResultJson`），无异步数据获取，因此不需要 Skeleton/Spinner。若未来扩展为异步加载，按 DESIGN.md 规范使用 Skeleton 占位。

**理由**：摘要标记让用户一眼知道该行包含多条数据；展开面板的序号 Drill-down 提供完整可读性而不依赖 JSON dump。

### 3. 递归格式化：杜绝 `[object Object]`

**决策**：`renderFieldValue` 递归规则扩展：

| 值类型 | 渲染 |
|--------|------|
| null/undefined | `—` italic（不变） |
| string/number/boolean | 直接 String()（不变） |
| 数组 | 每项转字符串后逗号拼接：`item1, item2, item3` |
| 对象（非数组） | `key1: val1, key2: val2` 逗号分隔 |

不再有 `<pre>` JSON block 分支。

**理由**：一行内可读，维持展开面板的视觉节奏。嵌套关系通过逗号/冒号表达，信息密度高。

### 4. 导出层展平：Rust 侧 `write_csv` / `write_xlsx` 数组检测

**决策**：在 `write_csv` 和 `write_xlsx` 内部，对每行 `result_json` 解析后判断：
- `Value::Object` → 按当前逻辑 1 行写入（不变）
- `Value::Array` → 遍历数组元素，每个元素写 1 行
  - 元素是 `Value::Object` → 按 field_names 取字段值
  - 元素非对象 → 该行所有列为空
- 空数组 `[]` → 0 行数据行
- 非对象也非数组 → 1 行，所有列为空

**理由**：改动收敛在两个 `write_*` 函数内部，不涉及 Tauri command 参数/返回值变更，测试面最小。

### 5. 动画清理：React state 替代 ref + tick

**决策**：

新行高亮：
- 当前：`newRowIdsRef` + `setNewRowTick` 强制重渲染
- 改为：`const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())`
- CSS `transition-colors duration-1000` 从 `bg-blue-50/50` 消退到透明

删除卸载：
- 当前：`setTimeout(150ms)` 硬编码等待
- 改为：`const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())`
- 渲染时检测 `deletingIds.has(id)` → 附加 `animate-out fade-out duration-150`
- `onAnimationEnd` 回调中真正从 `rows` 移除

**理由**：状态驱动 + CSS 声明式，行为可预测。消除 4 个 ref + 2 个无意义 tick state。

### 6. 颜色归一化：严格复用 token

**决策**：
- 表格行：`bg-card`
- 展开面板：`bg-muted`
- 主文本：`text-foreground`
- 次级文本（标签、占位符、时间）：`text-muted-foreground`
- 粘性操作列：`bg-card`
- 移除所有 `dark:` 前缀的暗色模式覆盖（当前项目聚焦 light mode）
- 移除所有硬编码 Hex（`#F7F8FA`, `#111827`, `#161C29`, `#0E121C`, `#E2E4E7` 等）

**理由**：项目已有完整的 `globals.css` token 体系，硬编码色值破坏一致性。

## Risks / Trade-offs

- **数组展平导出 → 导出行数不可预测**：1 个父行可能展开为 N 行，但 `MAX_EXPORT_ROWS=50000` 基于 DB 物理行计数，展开后可能超出预期。→ 导出日志记录实际写入行数，后续可按需在展平后追加上限校验。
- **逗号分隔丢失结构信息**：嵌套对象 `{a:1, b:2}` 渲染为 `a: 1, b: 2` 是可读的，但深层嵌套 `{a: {b: {c: 1}}}` 会变得冗长。→ 本项目 AI 提取的 schema 字段均为扁平结构，深层嵌套为低频场景，当前策略足够。
- **动画 `onAnimationEnd` 兼容性**：React 合成事件中 `onAnimationEnd` 可能因元素复用不触发。→ 加 fallback：若动画未在 200ms 内完成，`setTimeout` 兜底移除。
