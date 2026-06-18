# Phase-6: 数据网格、导出与工具箱大厅

## Summary

Phase 5 实现了"抓取 → 派发 → AI 提取 → 入库"的完整链路，数据已进入 SQLite `extractions` 表。现在需要让用户能够浏览、管理并消费这些数据。

Phase 6 包含三个交付件：

1. **数据网格**：基于 TanStack Table + Shadcn UI Table 的分页数据表格，嵌入 structured-extractor 工具内页，与 Schema 编辑器通过 Shadcn Tabs 水平切换
2. **CSV/XLSX 导出**：Rust 侧生成文件 → 系统原生保存对话框，支持当前页/全部两种范围
3. **工具箱大厅 Dashboard**：响应式网格布局、工具卡片配置化架构、设置入口分离

## Scope

### In Scope
- `list_extractions(task_id, page, limit)` 分页查询 + 总数
- `delete_extraction(id)` 删除单条记录
- `export_data(task_id, format, scope, page?, limit?)` 导出命令
- 前端数据网格（动态列映射、展开行查看、行内删除）
- 实时事件推送（`extraction-completed`）
- Dashboard 响应式网格 + 配置化工具卡片

### Out of Scope
- 排序与筛选（MVP 后）
- 数据编辑/更新（MVP 后）
- 多任务数据合并视图
- 导出进度条/大文件流式下载

## Dependencies
- Phase 5（数据已存在于 extractions 表）
- Phase 3（任务 Schema 定义）

## New Dependencies
- 前端：`@tanstack/react-table` 8.20.5（精确版本，`pnpm add @tanstack/react-table@8.20.5 --save-exact`）
- Rust：`csv = "=1.3.0"`、`rust_xlsxwriter = "=0.79.0"`、`tauri-plugin-dialog = "=2.2.0"`
