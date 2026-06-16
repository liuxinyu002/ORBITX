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

- [x] 3.1 `lib.rs` `Focused(false)` handler 中将 `hide()` 调用改为延时隐藏：通过 `tauri::async_runtime::spawn(async move { tokio::time::sleep(Duration::from_millis(400)).await; if !o.is_visible().unwrap_or(false) { return; } if o.is_focused().unwrap_or(false) { return; } let _ = o.hide(); })` 在 async task 中延时后检查 `is_visible`（已隐藏则跳过）和 `is_focused`（焦点恢复则取消），若仍失焦则 `hide()`
- [x] 3.2 添加日志：延时期间取消隐藏时记录 `log::debug!(target: "overlay", "blur-auto-hide 已取消（防抖期内恢复焦点）")`
- [x] 3.3 `Cargo.toml` 确认 `tokio::time` 已可用（tauri 运行时已引入 tokio）

## 4. 验证（问题组 A）

- [x] 4.1 `cargo build` Windows target 确认编译通过
- [ ] 4.2 人工验证：Windows 打包版本 Ctrl+Shift+K overlay 正常显示且不闪退
- [ ] 4.3 人工验证：macOS 上 overlay 行为不受影响（回归）

## 5. 空串降级修复（问题组 B）

- [x] 5.1 `grab/mod.rs` `grab_with_fallback()` match 分支增加 `Ok(ref s) if s.trim().is_empty()` 降级条件，触发剪贴板通道；添加日志 `log::info!(target: "grab", "AX/UIA 返回空文本，降级到剪贴板通道")`
- [x] 5.2 提取剪贴板降级逻辑为局部闭包/辅助函数，避免 Err 分支和 Ok-empty 分支代码重复
- [x] 5.3 更新 `should_degrade_to_clipboard()` 为 `should_degrade_to_clipboard(result: &Result<String, GrabError>)` 接受完整结果，或新增独立函数，保持测试覆盖
- [x] 5.4 `cargo test` 确认现有测试通过；新增测试：`grab_with_fallback_degrade_on_ok_empty_string`、`grab_with_fallback_degrade_on_ok_whitespace_only`
- [x] 5.5 `cargo build` Windows target 确认编译通过

## 6. 验证（问题组 B）

- [ ] 6.1 人工验证：在 Electron 应用中选中文本，快捷键触发 → 成功提取选中文本（不再为 0 字符）
- [ ] 6.2 人工验证：在原生应用（Notepad）中选中文本，快捷键触发 → AX/UIA 直接成功（不触发空串降级），结果正常
- [ ] 6.3 人工验证：无需选中文本时按快捷键 → 返回 `NoSelection` 错误，行为不变
- [ ] 6.4 人工验证：macOS 上抓取行为不受影响（回归）

## 7. System 错误降级（问题组 C-1）

- [x] 7.1 `grab/mod.rs` `grab_with_fallback()` match 分支增加 `Err(GrabError::System(_))` 降级条件，触发剪贴板通道；添加日志 `log::info!(target: "grab", "AX/UIA 返回 System 错误，降级到剪贴板通道")`
- [x] 7.2 `grab/mod.rs` `should_degrade_to_clipboard()` 函数同步增加 `System` 变体的 true 断言
- [x] 7.3 新增测试：`should_degrade_true_for_system_error` / `grab_with_fallback_degrade_on_system_error`
- [x] 7.4 `cargo test` 确认现有测试通过

## 8. OleInitialize 修复（问题组 C-2）

- [x] 8.1 `Cargo.toml` 确认 `Win32_System_Ole` feature 已包含 `OleInitialize` / `OleUninitialize`；如未包含则新增
- [x] 8.2 `clipboard.rs` Windows `ComGuard::init()` 中 `CoInitializeEx` 改为 `OleInitialize`，`Drop` 中 `CoUninitialize` 改为 `OleUninitialize`
- [x] 8.3 添加日志：初始化成功时 `log::debug!(target: "grab", "OLE 初始化完成")`，失败时 error 级别
- [x] 8.4 `cargo build --target x86_64-pc-windows-msvc` 确认编译通过

## 9. 剪贴板超时提升（问题组 C-3）

- [x] 9.1 `constants.rs` `CLIPBOARD_TIMEOUT_MS` 从 80 → 200
- [x] 9.2 更新 `.env.example` 中 `CLIPBOARD_TIMEOUT_MS` 注释，说明默认值 200ms 的适用场景
- [x] 9.3 `cargo test` 确认测试通过

## 10. 验证（问题组 C）

- [ ] 10.1 人工验证：微信 Windows 端选中文本，快捷键触发 → 通过降级链路（System → 剪贴板）成功提取文本
- [ ] 10.2 人工验证：移动办公 MO Windows 端选中文本 → 降级链路成功提取
- [ ] 10.3 人工验证：移动办公 Windows 端选中文本 → UIA 直接成功（不触发降级），行为不变
- [ ] 10.4 人工验证：Notepad 选中文本 → UIA 直接成功，剪贴板通道未被调用（回归）
- [ ] 10.5 人工验证：macOS 端抓取行为不受影响（回归）
