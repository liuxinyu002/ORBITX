## 0. 前置验证

- [x] 0.1 确认 Phase 4（`phase-4-grab-engine-and-hotkeys`）已合入：`src-tauri/src/grab/mod.rs` 存在 `GrabError` 枚举和 `PlatformGrabEngine` 类型别名，`src-tauri/src/lib.rs` 已注册快捷键 handler

## 1. 依赖与配置

- [x] 1.1 Cargo.toml: `[target.'cfg(target_os = "macos")'.dependencies]` 下新增 `objc = "0.2"` 依赖（NSPasteboard ObjC 互操作）
- [x] 1.2 Cargo.toml: Windows 下扩展 `windows` crate features（`Win32_System_DataExchange`, `Win32_UI_Input_KeyboardAndMouse`, `Win32_System_Ole`）

## 2. 错误模型扩展

- [x] 2.1 `grab/mod.rs`: `GrabError` 枚举新增 `ClipboardTimeout` 和 `ClipboardLockFailed` 两个变体，对应前端可消费的业务语义

## 3. 常量定义

- [x] 3.1 `grab/constants.rs`: 新增 `CLIPBOARD_TIMEOUT_MS` (80ms)、`CLIPBOARD_POLL_INTERVAL_MS` (5ms)
- [x] 3.2 `.env.example`: 新增 `CLIPBOARD_TIMEOUT_MS` 和 `CLIPBOARD_POLL_INTERVAL_MS` 可选覆盖项，附注释说明用途与默认值

## 4. ClipboardGuardian 模块

- [x] 4.1 新建 `src-tauri/src/grab/clipboard.rs`，声明 `ClipboardGuardian` 结构体和 `ClipboardLockGuard` RAII 结构体
- [x] 4.2 macOS 实现：`save_pasteboard()` — 通过 `objc` crate 枚举 `NSPasteboard.generalPasteboard.pasteboardItems` 所有 type representation，全量备份为 `Vec<(String, Vec<u8>)>`
- [x] 4.3 macOS 实现：`simulate_cmd_c()` — 通过 `extern "C"` 绑定 `CGEventCreateKeyboardEvent(CGKeyCode=0x08)` + `CGEventSetFlags(kCGEventFlagMaskCommand)` + `CGEventPost(kCGHIDEventTap)` 发送 Cmd+C
- [x] 4.4 macOS 实现：`wait_for_clipboard_change()` — 循环 `thread::sleep(poll_interval)` + 比对 `NSPasteboard.changeCount`，超时返回 `ClipboardTimeout`
- [x] 4.5 macOS 实现：`read_pasteboard_text()` — 读取 `pasteboard.stringForType(NSPasteboardTypeString)` 并按 `max_length` 立即截断
- [x] 4.6 macOS 实现：`restore_pasteboard()` — `clearContents()` → 写入 `TransientType` + `ConcealedType` 空 NSData → 逐条写回备份数据
- [x] 4.7 Windows 实现：`save_clipboard()` — `OleGetClipboard` → `IDataObject.EnumFormatEtc` 枚举所有 FORMATETC → 读取 STGMEDIUM 全量备份
- [x] 4.8 Windows 实现：`simulate_ctrl_c()` — `SendInput(4 × INPUT_KEYBOARD)` 原子注入 Ctrl+C 序列
- [x] 4.9 Windows 实现：`wait_for_clipboard_change()` — 循环 `thread::sleep(poll_interval)` + 比对 `GetClipboardSequenceNumber`，超时返回 `ClipboardTimeout`
- [x] 4.10 Windows 实现：`read_clipboard_text()` — `OpenClipboard(NULL)` → `GetClipboardData(CF_UNICODETEXT)` → 转 Rust String 并按 `max_length` 截断
- [x] 4.11 Windows 实现：`restore_clipboard()` — `OleSetClipboard(saved_idataobject)` + `OleFlushClipboard()`
- [x] 4.12 `ClipboardGuardian::capture()`: 串联 save → simulate → poll → read → restore 全链路，RAII 锁保护，`catch_unwind` 兜底恢复

## 5. 降级管道

- [x] 5.1 `grab/mod.rs`: 新增 `grab_with_fallback(max_length)` 函数——Layer 1 AX/UIA 先尝，`NoSelection`/`UnsupportedElement` 时降级 Layer 2 `ClipboardGuardian`
- [x] 5.2 `grab/mod.rs`: 声明全局 `CLIPBOARD_LOCK: AtomicBool`

## 6. lib.rs 接入

- [x] 6.1 `lib.rs`: 全局 shortcut handler 中 `spawn_blocking` 闭包内将 `PlatformGrabEngine::new().grab_selected_text()` 替换为 `grab::grab_with_fallback()`
- [x] 6.2 `lib.rs`: 管理 `CLIPBOARD_LOCK` 的全局 `Arc<AtomicBool>` 注入

## 7. 前端适配

- [x] 7.1 `useGrabCompleted.ts`: catch 分支新增 `ClipboardTimeout` → `toast.error("目标应用未响应，请重试")` + `log("warn", "overlay", "剪贴板降级超时")`；`ClipboardLockFailed` → `toast.error("操作太频繁，请稍后再试")` + `log("warn", "overlay", "剪贴板锁冲突")`
- [x] 7.2 `overlay.tsx`: catch 分支新增 `ClipboardTimeout` / `ClipboardLockFailed` → 切换到 `{ tag: "empty" }` 状态，Toast 文案同步 7.1，日志调用 `log("warn", "overlay", …)`

## 8. 验证

- [ ] 8.1 macOS: 在 Safari/Notes（原生）中验证 AX 快速路径仍正常，剪贴板未被触碰
- [ ] 8.2 macOS: 在 VS Code / Slack（Electron）中验证降级到剪贴板通道，剪贴板内容完整恢复
- [ ] 8.3 macOS: 验证剪贴板含图片时触发抓取后图片完整保留
- [ ] 8.4 macOS: 验证 Maccy/Paste 等三方工具不记录中间瞬时文本
- [ ] 8.5 macOS: 验证同时按键触发时的 `ClipboardLockFailed` 处理
- [ ] 8.6 Windows: 在 Notepad（原生）中验证 UIA 快速路径仍正常
- [ ] 8.7 Windows: 在 VS Code / Discord 中验证降级到剪贴板通道
- [ ] 8.8 Windows: 验证剪贴板多格式内容（CF_UNICODETEXT + CF_BITMAP）完整恢复
- [ ] 8.9 Windows: 验证高频率按键触发时的锁保护

## 9. 性能可观测（建议）

- [x] 9.1 `ClipboardGuardian::capture()` 返回前以 `debug` 级别记录各段耗时（save/simulate/poll/read/restore），target 为 `grab`，用于线上调参决策
