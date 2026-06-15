## 0. 前置检查

- [x] 0.1 确认 `phase-5-extraction-pipeline` 变更合入状态：若已合入，则基于新 handler 结构（`task:silent-extract` / `view:render-overlay` 事件协议）重新定位 `set_focus()` 和 `Focused(false)` 修改点

## 1. Windows 坐标转换修复

- [x] 1.1 `overlay_position.rs` Windows 平台 `get_cursor_position()` 内增加物理→逻辑坐标转换：通过 `GetDpiForMonitor` 获取 DPI，计算 `cursor_logical = cursor_physical * 96.0 / dpi`；添加 `log::debug!(target: "overlay", "坐标转换 physical=({},{}), dpi=({},{}), logical=({},{})", px, py, dx, dy, lx, ly)` 以便排查 DPI 相关定位问题
- [x] 1.2 `Cargo.toml` 确认 `GetDpiForMonitor` 所需的 windows crate feature 已包含（当前 `Win32_Graphics_Gdi` 已含）
- [x] 1.3 `cargo test overlay_position` 确认现有测试通过

## 2. Focus 锁定

- [x] 2.1 `lib.rs` 快捷键 B handler 中 `overlay.set_focus()` 前，`#[cfg(target_os = "windows")]` 限定块内调用 `AllowSetForegroundWindow(-1i32 as u32)` 锁定 foreground 权限
- [x] 2.2 添加日志：`log::debug!(target: "overlay", "已请求 foreground 权限（AllowSetForegroundWindow）")`

## 3. Blur-auto-hide 防抖

- [x] 3.1 `lib.rs` `Focused(false)` handler 中将 `hide()` 调用改为延时隐藏：通过 `tauri::async_runtime::spawn(async move { tokio::time::sleep(Duration::from_millis(400)).await; if !o.is_visible().unwrap_or(false) { return; } let _ = o.hide(); })` 在 async task 中延时后再次检查 `is_visible`，若已恢复可见则跳过隐藏
- [x] 3.2 添加日志：延时期间取消隐藏时记录 `log::debug!(target: "overlay", "blur-auto-hide 已取消（防抖期内恢复焦点）")`
- [x] 3.3 `Cargo.toml` 确认 `tokio::time` 已可用（tauri 运行时已引入 tokio）

## 4. 验证

- [x] 4.1 `cargo build` Windows target 确认编译通过
- [ ] 4.2 人工验证：Windows 打包版本 Ctrl+Shift+K overlay 正常显示且不闪退
- [ ] 4.3 人工验证：macOS 上 overlay 行为不受影响（回归）
