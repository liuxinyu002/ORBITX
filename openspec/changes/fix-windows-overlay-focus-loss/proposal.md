## Why

Windows 打包版本存在两类相互独立的问题导致文本抓取失败：

**问题组 A（overlay 可见性）**：按下 Ctrl+Shift+K 后 overlay 窗口短暂出现（~1s）随即消失，用户无法看到抓取结果。根因有三：坐标系统混用、focus 未锁定、blur-auto-hide 无容错延时。macOS 上不受影响。

**问题组 B（文本提取空串）**：overlay 正常弹出后，AX/UIA 路径返回 `Ok("")`（0 字符），`grab_with_fallback()` 未将其视为降级触发条件，导致剪贴板通道（Ctrl+C 模拟）被跳过，最终返回空串。该问题在 Electron 应用中稳定复现——Chromium 的 UIA provider 暴露了 TextPattern（`GetSelection().Length() > 0`），但 `GetText()` 不返回实际文本内容。剪贴板通道经人工验证可以正常提取同一应用中的选中文本。

## What Changes

- **修复 Windows 坐标混用**：`get_cursor_position()` 返回物理像素，`get_screen_size()` 返回逻辑像素，`compute_overlay_position()` 混合了两套坐标系。改为将光标坐标从物理像素转换为逻辑像素后传入，保持函数内部坐标系一致。
- **锁定 Windows foreground**：在 `set_focus()` 前调用 `AllowSetForegroundWindow`，确保 overlay 窗口的焦点不被系统回收。
- **blur-auto-hide 加防抖**：`Focused(false)` handler 中加 400ms 延时，若期间 `Focused(true)` 再次触发则取消隐藏。防止临时性失焦误触发隐藏。
- **扩展降级条件**：`grab_with_fallback()` 中 AX/UIA 返回空字符串或仅空白字符时，触发剪贴板降级，而非原样返回空串。

## Capabilities

### New Capabilities

无。纯 bug 修复，不引入新能力。

### Modified Capabilities

无。修复行为符合现有 spec 要求，不改动 spec 级别的行为约定。

## Impact

- `src-tauri/src/overlay_position.rs`：Windows `get_cursor_position()` 增加物理→逻辑坐标转换
- `src-tauri/src/lib.rs`：快捷键 B handler 中 `set_focus()` 前加 Windows foreground lock；`Focused(false)` handler 中加 debounce 逻辑
- `src-tauri/src/grab/mod.rs`：`grab_with_fallback()` 降级条件从仅 Err 变体扩展为 Err 变体 + Ok 空串
- `src-tauri/Cargo.toml`：确认 `Win32_Graphics_Gdi` feature 已包含 `GetDpiForMonitor`（当前已含，无需新增）
