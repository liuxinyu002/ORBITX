## Context

Phase 4 实现了基于纯无障碍 API（AX/UIA）的文本抓取引擎，但实际覆盖率只有 ~40-60%。Electron、Qt、GTK、Flutter 等跨平台框架的应用不完整实现 `NSAccessibility` / `ITextProvider`，导致 `AXSelectedTextRange` 返回空或 `kAXErrorNoValue`，`UIA_TextPatternId` 返回 `UIA_E_PATTERNUNAVAILABLE`。

本设计增加第二层降级通道——剪贴板模拟复制——覆盖无障碍 API 无法触及的场景。核心要求是**对用户系统状态无痕**：任何情况下剪贴板内容必须完整恢复，不破坏用户的复制历史。

## Goals / Non-Goals

**Goals:**
- 新增跨平台 `ClipboardGuardian` 模块，实现 save → simulate → poll → read → restore 安全链路
- `GrabError` 扩展两个新变体（`ClipboardTimeout`、`ClipboardLockFailed`）
- 降级管道 `grab_with_fallback()`：AX/UIA 失败时自动切换到剪贴板通道
- macOS `org.nspasteboard.TransientType` / `org.nspasteboard.ConcealedType` 隐密标记注入
- Windows `SendInput` 原子按键注入 + `GetClipboardSequenceNumber` 高频轮询
- 全局 `CLIPBOARD_LOCK` 防止双快捷键剪贴板竞态
- 字符阈值在剪贴板读取点强制执行，长文本在模块边界丢弃

**Non-Goals:**
- 不实现 OCR 方案（屏幕截图+文字识别）
- 不实现 AppleScript / JXA 等应用特定脚本
- 不提供剪贴板通道的启用/禁用开关（始终启用降级）
- 不支持 Linux（延续 Phase 4 的平台范围）

## Decisions

### 1. 全量剪贴板备份（非仅文本）

**选择**: macOS 侧通过 `NSPasteboard.pasteboardItems` 枚举所有 item 的所有 type representation，以 `(NSPasteboardType, NSData)` 二元组列表全量备份；Windows 侧通过 `OleGetClipboard` → `IDataObject.EnumFormatEtc` 枚举所有 `FORMATETC` 并读取 `STGMEDIUM` 全量备份。

**理由**: 用户可能在触发快捷键前刚刚复制了高分辨率图片、文件句柄或其他非文本内容。只备份文本格式会导致这些数据永久丢失。作为底层桌面工具，对系统状态的干预必须是绝对无痕的。

**替代方案考虑**: 仅备份文本格式——更快但破坏用户数据完整性，不可接受。

### 2. 隐密标记注入顺序

**选择** (macOS): 创建单个 `NSPasteboardItem` 承载所有数据（含隐密标记），通过 `writeObjects` 原子写入 pasteboard：
```
pasteboard.clearContents()
  → NSPasteboardItem.new()
  → item.setData(empty, TransientType)
  → item.setData(empty, ConcealedType)
  → 逐条 item.setData(backup_data, backup_type)
  → pasteboard.writeObjects([item])
```

**理由**: `clearContents()` 后通过单个 `NSPasteboardItem` 集中写入所有数据（标记 + 备份），相比逐条直接写入 pasteboard 更原子化，降低与前台 App 异步写入的竞态窗口。合规的三方剪贴板管理器（Maccy、Paste、ClipboardCenter 等）在监听 pasteboard 变更事件时看到 `TransientType`/`ConcealedType` 标记位，从而忽略后续的原始数据批量写回。

**替代方案考虑**: 在写回之后设置标记——此时三方管理器已经采集了数据，标记无效。

**Windows 侧**: 没有等价的隐密标记机制。缓解手段是极速恢复（80ms 窗口内完成全链路）+ `OleFlushClipboard()` 确保原子性。

### 3. 按键注入: CGEvent (macOS) + SendInput (Windows)

**选择**: macOS 使用 `CGEventCreateKeyboardEvent` + `CGEventPost` (kCGHIDEventTap)；Windows 使用 `SendInput` 注入 Ctrl+C 序列（`INPUT_KEYBOARD` × 4）。

**理由**:
- `CGEvent` 是 macOS 底层按键注入标准 API，不需要 `AXUIElement` 也能工作（仍需辅助功能权限，但独立于 AX API 的目标应用实现质量）
- `SendInput` 是 Windows 现代输入注入标准，队列原子性保证 4 个 INPUT 结构体不会被用户物理按键打断或混合

**替代方案考虑**: `CGEventPostToPid` 可以定向发送到特定进程，但我们不知道目标进程 PID。`keybd_event` (Windows) 已被废弃且不具备原子性。

### 4. 剪贴板变化检测: changeCount 轮询 + GetClipboardSequenceNumber 轮询

**选择**: macOS 用 `NSPasteboard.changeCount` 高频轮询（5ms 间隔）；Windows 用 `GetClipboardSequenceNumber` 高频轮询。

**理由**: 
- `AddClipboardFormatListener` 需要 HWND + 消息泵，不适合 `spawn_blocking` 线程
- 轮询方案在 5ms 间隔下最多引入 5ms 延迟，80ms 超时窗口内误差可忽略
- 两个平台保持一致的轮询模式，简化状态机

**替代方案考虑**: `AddClipboardFormatListener`——需要创建隐藏窗口和消息循环，过度设计。`NSNotificationCenter` 监听 `NSPasteboardDidChangeNotification`——需要 NSRunLoop，同样复杂。

### 5. RAII 锁管理

**选择**: `ClipboardLockGuard` 结构体，持有 `&'static AtomicBool`。`ClipboardGuardian::capture()` 入口处 `compare_exchange` 获取，`Drop` 释放。

```rust
struct ClipboardLockGuard(&'static AtomicBool);

impl Drop for ClipboardLockGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
```

**理由**: panic unwind 路径也必须释放锁，避免永久死锁。RAII 是 Rust 的标准方案。

### 6. 降级管道的判定逻辑

**选择**: 仅当 AX/UIA 返回 `NoSelection` 或 `UnsupportedElement` 时触发剪贴板降级。`AccessibilityDenied`、`System`、`Internal` 不降级直接返回错误。

**理由**:
- `AccessibilityDenied`：剪贴板通道也需要相同的辅助功能权限（CGEvent 需要），再试一次同样是权限拒绝，无意义
- `System` / `Internal`：底层 API 错误，重试剪贴板大概率也失败，直接暴露错误更利于诊断

**替代方案考虑**: 所有错误都降级——导致无意义的重复失败，延长用户感知延迟。

### 7. 字符阈值模块边界执行

**选择**: `ClipboardGuardian` 的 `read_pasteboard_text` / `read_clipboard_text` 在读取文本的瞬间即按 `max_length` 截断，不保留原始长文本。

**理由**: 降低内存占用，且与 AX/UIA 路径的阈值语义一致。上层 token 截断逻辑（`grab::truncate_by_tokens`）在 `lib.rs` 中继续执行，不做重复。

## Risks / Trade-offs

- **[剪贴板恢复失败]**: save→restore 之间若 crash，可能导致用户原剪贴板数据丢失 → 使用 `std::panic::catch_unwind` 包裹 capture 内部逻辑，panic 时在 catch 块中尽力恢复备份
- **[80ms 超时过短]**: 某些应用（如大型 IDE）可能响应复制操作较慢 → 80ms 作为初始值，`constants.rs` 集中管理便于调参；若日志中出现大量 `ClipboardTimeout` 可在后续版本调高
- **[前台 App 异步写入竞态]**: 检测到剪贴板变化后，前台 App 可能尚未完成所有类型（如同时在写 CF_TEXT + CF_BITMAP）的写入，若此时立即 restore 可能截断写入 → macOS 实现在检测到变化后额外 settle `timeout_ms/4`（最大 15ms），给前台 App 一个微小的 completion 窗口
- **[三方剪贴板管理器仍记录到]**: macOS 隐密标记是约定而非强制，部分不良实现可能无视 `TransientType` → 快速恢复本身已是缓解（整个替代内容存在时间 <30ms）；如需更强保证可在用户教育中说明
- **[objc 依赖新增]**: 新增 `objc = "0.2"` 依赖，与现有 `core-foundation` raw FFI 风格不完全统一 → `NSPasteboard` 是 ObjC API，raw FFI 手写 `objc_msgSend` 易出错且难以维护；`objc` crate 是 macOS Rust 生态的标准依赖，Tauri 自身已间接依赖
- **[Windows 无隐密标记]**: Windows 平台无法告知三方工具忽略瞬时复制 → 极速恢复（<50ms 内完成中间复制内容的读写清除）作为主要缓解

### 8. 前端错误态 UI

**选择**: `ClipboardTimeout` 和 `ClipboardLockFailed` 在前端 overlay 中均切换为 `{ tag: "empty" }` 状态，通过 sonner Toast 向用户传递差异化信息。

- `ClipboardTimeout` → `toast.error("目标应用未响应，请重试")`，overlay 显示 "未发现选中文本"
- `ClipboardLockFailed` → `toast.error("操作太频繁，请稍后再试")`，overlay 显示 "未发现选中文本"

Toast 文案使用 DESIGN.md 定义的 `body-compact` 字号（13px），不引入新颜色或组件样式。overlay `empty` 态复用现有 `EmptyHint` 组件。

**理由**: 两种错误都不需要独立的 overlay UI 状态——用户只需知道结果不可用并可重试。Toast 提供即时反馈，overlay 回退到 empty 避免增加状态机复杂度。

## Open Questions

无。经过讨论，所有关键设计决策已敲定。
