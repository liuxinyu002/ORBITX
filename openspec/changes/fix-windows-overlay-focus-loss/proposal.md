## Why

Windows 打包版本按下 Ctrl+Shift+K 后 overlay 窗口短暂出现（~1s）随即消失，用户无法看到抓取结果。根因有三：坐标系统混用、focus 未锁定、blur-auto-hide 无容错延时。macOS 上不受影响。

## What Changes

- **修复 Windows 坐标混用**：`get_cursor_position()` 返回物理像素，`get_screen_size()` 返回逻辑像素，`compute_overlay_position()` 混合了两套坐标系。改为将光标坐标从物理像素转换为逻辑像素后传入，保持函数内部坐标系一致。
- **锁定 Windows foreground**：在 `set_focus()` 前调用 `AllowSetForegroundWindow`，确保 overlay 窗口的焦点不被系统回收。
- **blur-auto-hide 加防抖**：`Focused(false)` handler 中加 400ms 延时，若期间 `Focused(true)` 再次触发则取消隐藏。防止临时性失焦误触发隐藏。

## Capabilities

### New Capabilities

无。纯 bug 修复，不引入新能力。

### Modified Capabilities

无。修复行为符合现有 spec 要求，不改动 spec 级别的行为约定。

## Impact

- `src-tauri/src/overlay_position.rs`：Windows `get_cursor_position()` 增加物理→逻辑坐标转换
- `src-tauri/src/lib.rs`：快捷键 B handler 中 `set_focus()` 前加 Windows foreground lock；`Focused(false)` handler 中加 debounce 逻辑
- `src-tauri/Cargo.toml`：确认 `Win32_Graphics_Gdi` feature 已包含 `GetDpiForMonitor`（当前已含，无需新增）
