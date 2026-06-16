## 1. 移除 OLE 依赖 (Cargo.toml)

- [x] 1.1 从 `windows` crate features 中移除 `Win32_System_Ole` 和 `Win32_System_Com_StructuredStorage`

## 2. 简化 Windows 剪贴板捕获链路 (clipboard.rs)

- [x] 2.1 删除 OLE imports（`OleFlushClipboard`、`OleGetClipboard`、`OleInitialize`、`OleSetClipboard`、`OleUninitialize`、`IDataObject`、`CF_UNICODETEXT`），新增本地常量 `const CF_UNICODETEXT: u32 = 13;`
- [x] 2.2 删除 `ComGuard` 结构体及其 `init()`、`Drop` 实现
- [x] 2.3 删除 `ClipboardBackup` 结构体及其 `save()`、`restore()` 方法
- [x] 2.4 简化 `do_capture`：移除 ComGuard 初始化、backup save/restore 调用，保留 simulate → poll → read → return
- [x] 2.5 清理不再需要的日志点（OLE/backup/restore 相关 debug 日志），保留核心链路日志

## 3. 验证

- [x] 3.1 `cargo check` 通过（macOS target）
- [x] 3.2 `cargo test` 通过（现有 clipboard 测试不受影响）
