## Why

Shortcut A（Cmd+Shift+E）存在两个反馈缺陷：

1. **成功反馈被遮蔽**：静默提取成功后只通过 sonner toast（"已提取"）通知，用户在做其他事情时极易错过。
2. **按下后无即时回应**：从按键到提取完成之间有几秒到几十秒的 AI 推理时间，用户在此期间看不到任何反馈，不知道系统是否已收到指令。

需要一种轻量反馈机制——出现在视线焦点（光标附近）、按键后立即响应（loading 态）、完成后展示有意义的提取摘要（success 态）或错误信息（error 态）、短暂停留后自动消失——覆盖完整交互闭环。

## What Changes

- 新增独立的 `toast` webview 窗口，专用于消息通知，与命令面板 overlay 职责分离
- 新增 `ToastPayload` 结构（Rust）和 `show_toast` Tauri command，通过 `state` 字段驱动三态状态机（Loading → Success / Error）
- 新增 `toast-overlay.tsx` 前端组件：根据 `state` 渲染 Lottie 涟漪动画 / 成功消息 + 字段预览 / 错误消息，Success/Error 态 2.5 秒后自动 fade-out
- 修改 `ExtractionListener.tsx`：收到 `task:silent-extract` 事件后立即 invoke `show_toast(state: "loading")`，提供即时反馈
- 修改 `pipeline.ts` 成功路径：用 `show_toast(state: "success")` 替代 `toast.success("已提取")`
- 修改 `pipeline.ts` 失败路径：用 `show_toast(state: "error")` 替代 `toast.error(...)`
- 在 `tauri.conf.json` 中预配置 toast 窗口（transparent, alwaysOnTop, skipTaskbar）

## Capabilities

### New Capabilities

- `toast-overlay`: 独立的 toast 消息悬浮窗，在光标附近显示三态通知（loading / success / error），自动消失

### Modified Capabilities

- `extraction-pipeline`: Shortcut A 静默提取的反馈机制从 sonner toast 全面改为 toast overlay 窗口（loading 即时反馈 + success 摘要展示 + error 错误提示）

## Impact

- 新增文件: `src/routes/toast-overlay.tsx`（~130 行，三态渲染）
- 修改文件: `src-tauri/tauri.conf.json`（新增 toast 窗口配置）, `src-tauri/capabilities/default.json`（toast 窗口加入 windows 白名单）, `src-tauri/src/grab/mod.rs`（新增 `ToastPayload`/`ToastState`/`show_toast`）, `src-tauri/src/commands/grab.rs`（注册 `show_toast` command）, `src-tauri/src/lib.rs`（注册 command handler）, `src/routes/__root.tsx`（注册 toast 路由）, `src/agent/pipeline.ts`（成功/失败路径改用 toast overlay）, `src/components/ExtractionListener.tsx`（按键后立即触发 loading toast）
- 新增依赖: `lottie-react@2.4.1`（含转递依赖 `lottie-web`，总计 ~64KB gzipped），用于 loading 态涟漪动画，替代 CSS spinner。体积开销可控，换取更贴合"等待 AI 处理中"语义的视觉反馈
