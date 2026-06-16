## Why

Windows 打包版本存在两类相互独立的问题导致文本抓取失败：

**问题组 A（overlay 可见性）**：按下 Ctrl+Shift+K 后 overlay 窗口短暂出现（~1s）随即消失，用户无法看到抓取结果。根因有三：坐标系统混用、focus 未锁定、blur-auto-hide 无容错延时。macOS 上不受影响。

**问题组 B（文本提取空串）**：overlay 正常弹出后，AX/UIA 路径返回 `Ok("")`（0 字符），`grab_with_fallback()` 未将其视为降级触发条件，导致剪贴板通道（Ctrl+C 模拟）被跳过，最终返回空串。该问题在 Electron 应用中稳定复现——Chromium 的 UIA provider 暴露了 TextPattern（`GetSelection().Length() > 0`），但 `GetText()` 不返回实际文本内容。剪贴板通道经人工验证可以正常提取同一应用中的选中文本。

**问题组 C（降级链路失效）**：新 Windows 设备上测试微信、移动办公、移动办公 MO 三个应用，仅移动办公能稳定提取。日志暴露降级链路上的三个独立缺陷：

1. **UIA `System` 错误不降级**：部分应用 UIA 路径返回 `HRESULT=0x00000000`（S_OK 但结果无效），`map_uia_error` 映射为 `GrabError::System`，而 `grab_with_fallback()` 仅匹配 `NoSelection` 和 `UnsupportedElement` 才降级，`System` 落入 `other => other` 分支直接失败。
2. **剪贴板恢复阶段 COM 未初始化**：Windows 剪贴板 `ComGuard` 使用 `CoInitializeEx`，但 `OleSetClipboard` 需要完整的 `OleInitialize`。`OleGetClipboard`（备份）可正常工作，`OleSetClipboard`（恢复）却报 `CO_E_NOTINITIALIZED`（0x800401F0），导致剪贴板恢复失败并吞没真正的抓取结果。
3. **剪贴板等待超时太短**：`CLIPBOARD_TIMEOUT_MS = 80ms`，微信等 Electron 应用处理 Ctrl+C 通常需要 50-200ms，80ms 在多数情况下不足，导致轮询超时。

## What Changes

- **修复 Windows 坐标混用**：`get_cursor_position()` 返回物理像素，`get_screen_size()` 返回逻辑像素，`compute_overlay_position()` 混合了两套坐标系。改为将光标坐标从物理像素转换为逻辑像素后传入，保持函数内部坐标系一致。
- **锁定 Windows foreground**：在 `set_focus()` 前调用 `AllowSetForegroundWindow`，确保 overlay 窗口的焦点不被系统回收。
- **blur-auto-hide 加防抖**：`Focused(false)` handler 中加 400ms 延时，若期间 `Focused(true)` 再次触发则取消隐藏。防止临时性失焦误触发隐藏。
- **扩展降级条件**：`grab_with_fallback()` 中 AX/UIA 返回空字符串或仅空白字符时，触发剪贴板降级，而非原样返回空串。
- **`System` 错误也触发降级**：`grab_with_fallback()` 中 `Err(GrabError::System(_))` 同样降级到剪贴板通道，防止 UIA 路径的意外系统级失败直接阻断抓取。
- **剪贴板 `CoInitializeEx` → `OleInitialize`**：Windows 剪贴板 `ComGuard` 改用 `OleInitialize` 初始化 COM，确保 `OleGetClipboard` 和 `OleSetClipboard` 均能正常完成备份与恢复。
- **剪贴板超时提升**：`CLIPBOARD_TIMEOUT_MS` 从 80ms 提升至 200ms，给 Electron 等重应用足够的 Ctrl+C 响应时间。

## Capabilities

### New Capabilities

无。纯 bug 修复，不引入新能力。

### Modified Capabilities

无。修复行为符合现有 spec 要求，不改动 spec 级别的行为约定。

## Impact

- `src-tauri/src/overlay_position.rs`：Windows `get_cursor_position()` 增加物理→逻辑坐标转换
- `src-tauri/src/lib.rs`：快捷键 B handler 中 `set_focus()` 前加 Windows foreground lock；`Focused(false)` handler 中加 debounce 逻辑
- `src-tauri/src/grab/mod.rs`：`grab_with_fallback()` 降级条件从仅 Err 变体扩展为 Err 变体 + Ok 空串
- `src-tauri/src/grab/mod.rs`：`grab_with_fallback()` 降级条件增加 `Err(GrabError::System(_))` 分支
- `src-tauri/src/grab/clipboard.rs`：Windows 平台 `ComGuard::init()` 中 `CoInitializeEx` 改为 `OleInitialize`
- `src-tauri/src/grab/constants.rs`：`CLIPBOARD_TIMEOUT_MS` 从 80 提升至 200
- `src-tauri/Cargo.toml`：确认 `Win32_Graphics_Gdi` feature 已包含 `GetDpiForMonitor`（当前已含，无需新增）
