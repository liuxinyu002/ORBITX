## Why

Windows 剪贴板 `backup → Ctrl+C → read → restore` 链路中的 OLE 全量备份/恢复是 `OleSetClipboard`/`OleFlushClipboard` 硬崩溃的根因。多次 OLE 剪贴板所有权转移（`OleGetClipboard` → 目标 App 的 `OleSetClipboard` → 我们的 `OleSetClipboard`）导致内部状态不一致，触发访问违规（非 panic，`catch_unwind` 抓不到），主进程直接崩溃。经多轮尝试（遗留 API 读取、OLE 统一化、延迟 settle）均无法根治。

macOS 的 NSPasteboard 架构基于 Pasteboard Server 进程间通信，不存在同等的所有权抢占崩溃风险，行为稳定。**接受跨平台行为差异**——不为追求一致性而对稳定性做向下妥协。

## What Changes

- **删除 Windows OLE 全量备份/恢复**：移除 `ComGuard`（`OleInitialize`/`OleUninitialize`）和 `ClipboardBackup`（`OleGetClipboard` → `OleSetClipboard` + `OleFlushClipboard`）
- **Windows 抓取后剪贴板不恢复**：抓取到的纯文本留在剪贴板中，不刻意清空（顺水推舟，不做无意义的 `EmptyClipboard`）
- **移除 OLE 相关 Cargo features**：`Win32_System_Ole` 和 `Win32_System_Com_StructuredStorage`（仅在 clipboard.rs 中用于 OLE 路径）
- **macOS 行为不变**：继续完整 restore 链路，注入隐密标记
- **日志文案简化**：移除不再需要的 OLE/backup/restore 相关日志点

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `clipboard-guardian`：Windows 链路不再执行 "full backup via IDataObject" 和 "restore via OleSetClipboard"。Windows 上 capture 链路简化为 `simulate Ctrl+C → poll → read → return text`，不恢复原剪贴板内容，抓取到的文本留在剪贴板中。

## Impact

- `src-tauri/src/grab/clipboard.rs`：Windows 平台模块删除 `ComGuard`、`ClipboardBackup`、OLE imports；简化 `do_capture` 移除 save/restore 步骤
- `src-tauri/Cargo.toml`：移除 `Win32_System_Ole` 和 `Win32_System_Com_StructuredStorage` features
- `src-tauri/src/grab/windows.rs`：不受影响（UIA 依赖 `Win32_System_Com`，保留）
- macOS 侧零改动
