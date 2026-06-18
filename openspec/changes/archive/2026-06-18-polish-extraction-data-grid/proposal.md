## Why

Phase 6 的数据网格和导出功能在处理数组格式的 `result_json` 时存在数据完整性问题：表格单元格渲染为空、导出文件全空。同时，展开面板中的嵌套对象/数组渲染产生 `[object Object]` 损坏文本，动画机制依赖 ref + tick 的 hacky 实现需清理。

## What Changes

- **数组 `result_json` 前端渲染**：表格单元格改为显示高信息密度摘要（如「[包含 3 项数据]」），展开面板按序号逐项渲染，每项展示完整键值对
- **嵌套对象/数组递归格式化**：嵌套对象用 `key: value` 逗号分隔，嵌套数组用逗号拼接字符串，彻底弃用 `<pre>` JSON block
- **导出层数组展平**：Rust 侧 `write_csv` / `write_xlsx` 检测数组 → 动态展平为 N 行写入，缺失字段填空字符串
- **动画机制清理**：移除 ref + tick 的强制重渲染 hack，新行高亮和删除卸载改为 React state + CSS transition/animation
- **删除动画去硬编码**：以 `onAnimationEnd` 回调替代 `setTimeout(150ms)`
- **颜色回归 token**：移除所有硬编码 Hex（`#F7F8FA`, `#111827` 等）和 `dark:` 暗色模式覆盖，统一复用 `globals.css` 语义化 token

## Capabilities

### Modified Capabilities
- `extraction-results`: 数组 `result_json` 的表格单元格和展开面板渲染策略变更（frontend fallback → 摘要标记 + 序号 Drill-down）
- `data-export`: CSV/XLSX 导出增加数组检测与展平逻辑（单行假设 → 数组 N 行展开）

## Impact

- 前端：`DataBrowser.tsx`（单元格渲染、展开面板、动画机制）
- Rust：`commands/extraction.rs`（`write_csv` / `write_xlsx` 数组展平）
- 无新增依赖，无 API 变更，无 **BREAKING** 变更
