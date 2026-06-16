## Context

当前 `clipboard.rs` Windows 平台的 `do_capture` 链路为：

```
ComGuard::init() (OleInitialize)
  → ClipboardBackup::save() (OleGetClipboard)
  → simulate_ctrl_c()
  → poll (GetClipboardSequenceNumber)
  → read_clipboard_text() (遗留 OpenClipboard/GetClipboardData)
  → backup.restore() (OleSetClipboard + OleFlushClipboard) ← 崩溃点
```

`OleGetClipboard` → 目标 App 的 `OleSetClipboard` → 我们的 `OleSetClipboard` 这三次 OLE 剪贴板所有权转移导致 OLE 内部状态不一致，`OleSetClipboard` 或 `OleFlushClipboard` 时访问违规硬崩溃。此问题在 `fix-windows-overlay-focus-loss` 变更中已尝试多种缓解手段（OLE 统一化、延迟 settle、回退至遗留 API 读取），均无法根治。

`Win32_System_Ole` 和 `Win32_System_Com_StructuredStorage` features 仅在 `clipboard.rs` 中服务于 OLE 路径。UIA 引擎（`windows.rs`）通过 `Win32_System_Com` feature 使用 `CoInitializeEx`/`CoCreateInstance`，不依赖 OLE 子系统。

## Goals / Non-Goals

**Goals:**
- 从 Windows 剪贴板链路中彻底移除 OLE API（`OleGetClipboard`、`OleSetClipboard`、`OleFlushClipboard`、`OleInitialize`、`OleUninitialize`）
- 简化 `do_capture` 为 `simulate → poll → read → return text`，不恢复剪贴板
- 抓取到的纯文本留在剪贴板中，不额外清空
- 移除不再需要的 `Win32_System_Ole` 和 `Win32_System_Com_StructuredStorage` Cargo features
- 保持 `catch_unwind` 兜底（即使崩溃风险已消除，防御性保留无坏处）

**Non-Goals:**
- 不修改 macOS 侧任何代码
- 不修改 `grab/mod.rs` 的降级管道（`grab_with_fallback` 接口不变）
- 不修改 `clipboard.rs` 的共享类型（`ClipboardGuardian`、`ClipboardLockGuard`）和 `capture` 入口方法
- 不引入新的外部依赖

## Decisions

### 决策 1：直接删除 OLE 备份/恢复，不做条件编译保留

**选择**：直接从 `#[cfg(target_os = "windows")]` 模块中删除 `ComGuard`、`ClipboardBackup` 及所有 OLE imports。

**理由**：
- OLE 路径已被证明无法稳定工作（两种变体均崩溃）
- 保留死代码增加维护负担，且可能被未来开发者误解为"可选路径"
- Git 历史保留了完整实现，如需参考可回溯

**替代方案**：用 feature flag 保留 OLE 路径 → 拒绝，增加配置复杂度且退化到已知不稳定路径没有意义。

### 决策 2：简化后的 Windows do_capture 序列

```
simulate_ctrl_c()                            // 释放修饰键 + 干净 Ctrl+C
  → wait_for_clipboard_change(seq, ...)      // GetClipboardSequenceNumber 轮询
  → read_clipboard_text(max_length)          // 遗留 OpenClipboard + GetClipboardData(CF_UNICODETEXT)
  → 直接返回文本，不恢复剪贴板
```

**变更点**：
- 删除 `ComGuard::init()` 调用——不再需要 COM 初始化
- 删除 `ClipboardBackup::save()` 和 `backup.restore()` 调用
- `get_original_seq` 移至 `simulate_ctrl_c` 之前
- 轮询逻辑不变
- 读取逻辑不变（遗留 API）
- 即使读取失败（`NoSelection` / `ClipboardTimeout`），也不恢复（因为没做备份）

**理由**：移除备份/恢复消除所有 OLE 所有权转移。模拟和读取两个阶段均使用已验证稳定的 API（`SendInput` + 遗留剪贴板 API），无崩溃风险。

### 决策 3：不刻意清空剪贴板

**选择**：抓取结束后不调用 `EmptyClipboard` 或 `OpenClipboard` + `EmptyClipboard` + `CloseClipboard`。

**理由**：
- 剪贴板被覆盖已成事实，刻意清空只增加操作无收益
- 将抓取到的文本留在剪贴板中，用户后续可以 `Ctrl+V` 使用——这反而是额外便利
- 大多数启动器类工具（Alfred、Wox、Raycast）都是此行为

**替代方案**：抓取后 `EmptyClipboard` → 拒绝，无意义操作。

### 决策 4：移除 Win32_System_Ole 和 Win32_System_Com_StructuredStorage

**选择**：从 `Cargo.toml` 的 `windows` crate features 列表中移除这两项。

验证依据：
- `Win32_System_Ole`：仅 `clipboard.rs` 中 `#[cfg(target_os = "windows")]` 模块使用，无其他引用
- `Win32_System_Com_StructuredStorage`：在提交 `cad4a3d` 中添加，因 `STGMEDIUM` 类型需要，仅 OLE 路径使用，无其他引用
- `Win32_System_Com`：`windows.rs` 中 UIA 引擎需要（`CoInitializeEx`、`CoCreateInstance`），**保留**

**`CF_UNICODETEXT` 常量处理**：`CF_UNICODETEXT` 随 `Win32_System_Ole` feature 提供。移除该 feature 后，在 Windows 平台模块内定义本地常量 `const CF_UNICODETEXT: u32 = 13;`（Windows 剪贴板格式的稳定 ABI 值，自 Windows NT 3.1 以来未变）。`read_clipboard_text` 中 `CF_UNICODETEXT.0 as u32` 替换为直接使用此常量。

### 决策 5：日志简化

移除 restore 相关的日志点：
- `"OleSetClipboard 调用中..."` / `"OleSetClipboard 调用成功"` / `"OleSetClipboard 失败"`
- `"OleFlushClipboard 调用中..."` / `"OleFlushClipboard 失败"`
- `"剪贴板备份完成"` / `"剪贴板恢复完成"`
- `"COM 初始化"` / `"OLE 初始化"`

保留的日志点：
- `"Ctrl+C 模拟完成"`
- `"轮询完成"`
- `"文本读取完成"`
- `"剪贴板通道: 开始 do_capture"`

## Risks / Trade-offs

- **[低] 用户原有剪贴板内容被覆盖**：抓取操作会替换剪贴板为当前选中的文本。→ 与 Alfred/Wox 等主流启动器行为一致，用户预期内。
- **[低] 非文本格式丢失**：如果用户剪贴板中有图片、文件列表等，会被纯文本替换。→ 抓取操作本身就是在"选中文本"时触发，原剪贴板大概率也是文本。
- **[极低] 读取失败时剪贴板残留 Ctrl+C 结果**：即使 `read_clipboard_text` 返回 `Err`（如 `NoSelection`），剪贴板中可能已有目标 App 写入的内容。→ 不做特殊处理，这本身就是正常的剪贴板使用行为。
