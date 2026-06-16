## Why

Phase 4 建成文本抓取能力后，抓到的文本只做了 Toast 提示，没有进入任何有意义的消费链路。Phase 5 是 MVP 的核心业务闭环——将抓取的文本通过已配置的 AI 模型和已定义的任务 Schema 转化为结构化数据，实现从"抓"到"存"的完整链路。这是连接用户意图（任务 Schema）、AI 能力（模型端点）和抓取能力（无障碍 API）的枢纽阶段。

## What Changes

- 新增 AI 提取管线：将抓取文本 + 任务 Schema 组装为结构化提取请求，调用 AI 模型，解析响应并写入数据库
- 新增 `is_relevant` 相关性判定与降级机制：不相关时自动阻断静默入库，唤起悬浮窗交由用户人工确认
- 新增 `extractions` 数据库表：存储提取结果（JSON 列模型，联合索引）
- 改造快捷键 A 链路：废弃队列暂存模式，改为 `task:silent-extract` 事件直推主窗口后台处理
- 改造快捷键 B 链路：废弃 `grab-completed`/`consume_grabbed_result`，改为 `view:render-overlay` 事件驱动视图
- 改造悬浮窗：从装饰性占位变为双模式（正常派发 / 降级处理）功能视图
- **BREAKING**：删除 `GrabState` 队列、`grab-completed` 事件、`consume_grabbed_result` 命令
- 新增 `show_overlay` 通用命令和 `insert_extraction` 写入命令

## Capabilities

### New Capabilities

- `extraction-pipeline`: AI 驱动的结构化数据提取管线，包含 Prompt 组装、模型调用、`is_relevant` 判定、force 模式
- `extraction-results`: 提取结果持久化存储，包含 `extractions` 表、`insert_extraction` 命令、按任务分页查询接口
- `command-panel-routing`: 派发路由逻辑，包含静默派发（快捷键 A）、面板派发（快捷键 B）、降级唤醒三条链路的完整事件协议

### Modified Capabilities

- `grab-engine`: 删除队列暂存机制（GrabState），快捷键 A/B 改为直接事件发射（`task:silent-extract` / `view:render-overlay`）
- `capsule-overlay`: 从装饰性占位升级为双模式功能视图（正常派发 / 降级处理），工具插槽绑定真实交互

## Impact

- **Rust 后端**: `grab/state.rs`（删除）、`grab/mod.rs`（移除队列相关逻辑，保留 `OverlayPermissionState` 结构体但删除 `set_overlay_permission_state` command——权限态改由 `show_overlay_core` 内部根据 payload tag 设置）、`lib.rs`（改造快捷键 handler）、新增 `commands/extraction.rs`、`models/extraction.rs`、`db/migrations.rs`（V4）
- **前端**: 新增 `src/agent/pipeline.ts`、`src/components/ExtractionListener.tsx`、改造 `src/routes/overlay.tsx`、`src/App.tsx`（挂载 ExtractionListener）
- **事件协议**: 删除 `grab-completed`，新增 `task:silent-extract`、`view:render-overlay`、`task:manual-extract`
- **命令协议**: 删除 `consume_grabbed_result`，新增 `show_overlay`、`insert_extraction`
