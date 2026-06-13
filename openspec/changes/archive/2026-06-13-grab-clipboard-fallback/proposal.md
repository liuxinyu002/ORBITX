## Why

Phase 4 的纯 AX/UIA 无障碍接口只能覆盖 ~40-60% 的桌面应用（原生 macOS/Win32 应用）。Electron、Qt、GTK、Flutter 等跨平台框架的应用中，`AXSelectedTextRange` / `UIA_TextPattern` 常返回空或 `UnsupportedElement`。用户在这些应用中选中文本后按键，只能看到"未发现选中文本"——这让 OrbitX 的核心入口对大多数日常应用不可用。必须在 AX/UIA 快速路径之下增加一层剪贴板降级通道，在保证剪贴板无痕的前提下将覆盖率提升到 ~95%+。

## What Changes

- **新增 `clipboard-guardian` 模块** (`src-tauri/src/grab/clipboard.rs`)：跨平台剪贴板安全通道，实现全量 save → 模拟 Cmd/Ctrl+C → 轮询等待 → 读取 → 全量 restore，带 RAII 锁保护
- **新增 `GrabError` 变体** `ClipboardTimeout` 和 `ClipboardLockFailed`，保持前后端错误语义统一
- **修改抓取调用链**：`lib.rs` 快捷键 handler 从直接调用 `PlatformGrabEngine::grab_selected_text()` 改为调用 `grab::grab_with_fallback()` 降级管道（AX/UIA → 剪贴板 → 错误）
- **macOS 剪贴板恢复**时注入 `org.nspasteboard.TransientType` / `org.nspasteboard.ConcealedType` 隐密标记，对抗 Maccy、Paste 等三方剪贴板管理器的无差别监听
- **Windows 剪贴板恢复**通过 `SendInput` 原子注入 + `GetClipboardSequenceNumber` 高频轮询，在 80ms 窗口内完成全链路，减少三方工具感知概率
- **新增全局 `CLIPBOARD_LOCK`** 防止两个快捷键同时进入剪贴板通道产生竞态
- **字符阈值在模块边界强制执行**：`read_pasteboard_text` / `read_clipboard_text` 在读取新文本瞬间即截断，防止长文本污染内存

## Capabilities

### New Capabilities

- `clipboard-guardian`: 跨平台安全剪贴板通道。全量备份 NSPasteboardItem / IDataObject → 模拟系统级复制快捷键 → 限时轮询读取 → 全量恢复备份内容并标记隐密类型，全程 RAII 锁保护。

### Modified Capabilities

- `grab-engine`: 抓取错误模型新增 `ClipboardTimeout` 和 `ClipboardLockFailed` 两个变体；快捷调用链从单一 AX/UIA 调用升级为多策略降级管道；`ClipboardGuardian` 作为第二层降级策略集成到管道中。

以上能力均为 Rust 侧概念能力。所有剪贴板操作直接通过系统 API（NSPasteboard / Win32 Clipboard / CGEvent / SendInput）完成，无需在 `capabilities/default.json` 中新增 Tauri 权限声明。

## Impact

- `src-tauri/Cargo.toml`: macOS 新增 `objc = "0.2"` 依赖（NSPasteboard ObjC 互操作）；Windows 扩展 `windows` crate features（`Win32_System_DataExchange`、`Win32_UI_Input_KeyboardAndMouse`、`Win32_System_Ole`）
- `src-tauri/src/grab/mod.rs`: 新增 `grab_with_fallback()` 管道函数，扩展 `GrabError` 枚举
- `src-tauri/src/grab/clipboard.rs`: **新建**模块，含 `ClipboardGuardian` 结构体及其 `cfg(target_os)` 分发的 macOS/Windows 实现
- `src-tauri/src/grab/constants.rs`: 新增 `CLIPBOARD_TIMEOUT_MS`、`CLIPBOARD_POLL_INTERVAL_MS` 常量
- `src-tauri/src/lib.rs`: 快捷键 handler 内将 `engine.grab_selected_text()` 替换为 `grab::grab_with_fallback()`，管理 `CLIPBOARD_LOCK` 全局 AtomicBool
- `src/hooks/useGrabCompleted.ts`: catch 分支新增 `ClipboardTimeout` / `ClipboardLockFailed` 的 Toast 文案
- 对已有功能的破坏性变更：无。AX/UIA 快速路径行为不变；新增的剪贴板降级仅在 AX/UIA 返回 `NoSelection` 或 `UnsupportedElement` 时触发
