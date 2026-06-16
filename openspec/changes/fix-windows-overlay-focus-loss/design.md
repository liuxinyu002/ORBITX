## Context

当前 overlay 窗口在 macOS 上工作正常，但 Windows 打包版本存在多个相互独立的问题：

### 问题组 A：Overlay 可见性（已修复）

1. **坐标混用**：`overlay_position.rs` 中 Windows 平台 `get_cursor_position()` 使用 `GetCursorPos`（返回物理像素），而 `get_screen_size()` 使用 `GetMonitorInfoW` 的 `rcMonitor`（返回逻辑像素）。`compute_overlay_position()` 将物理和逻辑坐标混合计算，导致在非 1x DPI 下 flip/clamp 判断失效，定位偏出屏幕。
2. **Focus 未锁定**：tao 的 `set_focus()` 在 `GetForegroundWindow() == self` 时直接 NO-OP。`show()` 后 Windows 可能临时给 overlay focus（`Focused(true)`），导致 `set_focus()` 检查时跳过 `SetForegroundWindow`。此 focus 不稳定，随后被系统回收 → `Focused(false)` → auto-hide。
3. **blur-auto-hide 无容错**：`Focused(false)` 触发后立即 `hide()`，没有缓冲时间应对瞬时失焦/重聚焦。

### 问题组 B：文本抓取空串（本次补充）

在新 Windows 机器上验证问题组 A 的修复时，发现 overlay 已能正常弹出并聚焦，但抓取结果始终为 0 字符。日志显示 UIA 路径返回 `Ok("")`，`grab_with_fallback()` 的降级逻辑仅匹配 `Err(GrabError::NoSelection)` 和 `Err(GrabError::UnsupportedElement)`，空串成功结果直接返回，跳过了剪贴板降级通道。

**根因链路：**
```
Windows UIA GetText() → Ok("")
  → grab_with_fallback() match result:
      Err(NoSelection) → 降级 ✅
      Err(UnsupportedElement) → 降级 ✅
      Ok("") → 直接返回空串 ❌ （本次修复点）
```

**为何 Electron 应用返回 Ok("")**：Chromium 的 UIA provider 实现了 TextPattern 接口，`GetSelection()` 能返回非零个 TextRange，但 `GetText()` 在部分场景下不返回文本内容——这是 Chromium UIA 实现的已知局限。

约束：
- 仅影响 Windows（`#[cfg(target_os = "windows")]` 限定）
- `overlay_position.rs` 中 `compute_overlay_position` 是平台无关纯函数，不应引入平台条件编译
- 当前 `windows` crate features 已包含 `Win32_Graphics_Gdi` 和 `Win32_UI_WindowsAndMessaging`
- 降级条件修改为跨平台代码（`grab/mod.rs` 中 `grab_with_fallback()`），不在平台特定层

## Goals / Non-Goals

**Goals:**
- 修复 Windows 上 overlay 定位的坐标系统一性
- 确保 `set_focus()` 后 overlay 的前台焦点不被系统回收
- 为 blur-auto-hide 增加防抖，避免瞬时失焦误隐藏
- AX/UIA 路径返回空结果时触发剪贴板降级，而非原样返回

**Non-Goals:**
- 不改动 macOS 行为
- 不改动 `compute_overlay_position` 函数签名和逻辑
- 不引入新的外部依赖
- 不修复 UIA provider 侧的根因（第三方应用行为，超出控制范围）

## Decisions

### 决策 1：坐标转换策略

**选择**：在平台层 `get_cursor_position()` 内将物理像素转为逻辑像素，而非在 `compute_overlay_position` 内处理。

**理由**：
- `compute_overlay_position` 是平台无关纯函数，保持其简单性
- `set_position(LogicalPosition::new(x, y))` 使用逻辑坐标，光标也应统一为逻辑坐标
- 转换需要 `GetDpiForMonitor`，它在 `Win32::Graphics::Gdi` 中（已有 feature）

**替代方案**：
- 方案 B：在 `compute_overlay_position` 调用前做转换 — 拒绝，因为转换 API 是平台相关的，不应出现在纯函数的调用侧
- 方案 C：改用 `GetSystemMetrics(SM_CXSCREEN)` 获取物理屏幕尺寸，统一用物理坐标 — 拒绝，因为 `set_position` 使用逻辑坐标

**实现方案**：Windows 的 `get_cursor_position()` 内：
1. 获取光标物理像素 `GetCursorPos`
2. 用 `MonitorFromPoint` 获取所在 monitor handle
3. 用 `GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &dpi_x, &dpi_y)` 获取 DPI
4. 转换：`cursor_logical_x = cursor_physical_x * 96.0 / dpi_x`，同理 y

### 决策 2：Focus 锁定

**选择**：在 `set_focus()` 前调用 `AllowSetForegroundWindow(ASFW_ANY)`。

**理由**：
- `AllowSetForegroundWindow(-1)` 授予当前进程 foreground-setting 权限
- tao 的 `force_window_active` 内部已有 `SetForegroundWindow` + fallback 键盘 hack，我们只需确保权限到位
- `ASFW_ANY` 是最简单有效的方案（已经是 Windows 上解决此问题的标准做法）

**替代方案**：
- 方案 B：用 `AttachThreadInput` 附加到前台线程 — 拒绝，实现复杂度高，且 `AllowSetForegroundWindow` 更直接
- 方案 C：延迟 retry `set_focus()` — 拒绝，治标不治本，且增加时间窗口不确定性

**实现方案**：仅 Window 平台，`#[cfg(target_os = "windows")]` 限定块内：
```
AllowSetForegroundWindow(-1i32 as u32);
let _ = overlay.set_focus();
```

### 决策 3：blur-auto-hide 防抖

**选择**：在 `Focused(false)` handler 中设置 400ms `tokio::time::sleep`，期间若 `Focused(true)` 触发则取消 hide。

**理由**：
- 400ms 足够覆盖 Windows foreground 回收→重新获取的完整周期
- 正常失焦场景（用户点其他地方）不受影响，只是多了 400ms 延迟
- 对已隐藏的窗口（`is_visible=false`）无影响

**替代方案**：
- 方案 B：仅抑制 blur-auto-hide 而不加防抖（权限引导态逻辑） — 拒绝，可能导致 overlay 永远不消失
- 方案 C：改用 `setAlwaysOnTop(false)` — 拒绝，会引入 z-order 问题
- 方案 D：300ms 延时 — 可接受，但 400ms 更保守，覆盖边缘机型的焦点回收周期

**实现方案**：`Focused(false)` handler 中：
1. 检查 `is_visible`，不可见则直接返回（原本就走 hide 但无效果）
2. 检查 `OverlayPermissionState`，权限引导态跳过（保持原有逻辑）
3. `tokio::time::sleep(Duration::from_millis(400)).await`
4. 再次检查 `is_visible` 和是否恢复 focus，若仍失焦则 `hide()`

### 决策 4：空串降级触发

**选择**：在 `grab_with_fallback()` 的 match 分支中增加 `Ok(ref s) if s.trim().is_empty()` → 降级到剪贴板通道。

**理由**：
- AX/UIA 路径返回空串在功能上等价于 `NoSelection`（用户确实选中了文本但 UIA 未能提取）
- `trim().is_empty()` 确保纯空白字符也触发降级，避免将无意义的空白返回给前端
- 剪贴板通道通过人工验证可正常提取同一目标应用（Electron）中的选中文本
- 无需引入新错误变体，改动最小化
- 跨平台适用：macOS 的 AX 路径也可能因类似原因返回空串

**替代方案**：
- 方案 B：在 `WinGrabEngine::grab_selected_text()` 中检测空文本 → 映射为 `NoSelection` — 拒绝，因为这会掩盖"UIA 选中 0 个 range"和"UIA 选中 N 个 range 但文本为空"的语义差异，前者是正常无选中，后者是 UIA provider 缺陷
- 方案 C：在 `WinGrabEngine` 内直接 fallback 到剪贴板 — 拒绝，破坏了分层设计（平台引擎只负责单一 AX/UIA 路径，降级逻辑在 `grab_with_fallback` 层）

**实现方案**：`grab/mod.rs` 中 `grab_with_fallback()`：
```rust
match result {
    Err(GrabError::NoSelection) | Err(GrabError::UnsupportedElement) => {
        // 现有降级逻辑（不变）
    }
    Ok(ref s) if s.trim().is_empty() => {
        log::info!(target: "grab", "AX/UIA 返回空文本，降级到剪贴板通道");
        // 执行剪贴板降级（与 Err 分支相同逻辑）
    }
    other => other,
}
```

可用宏或辅助闭包避免剪贴板降级代码重复。

## Risks / Trade-offs

- **[低] AllowSetForegroundWindow 可能失效**：某些 Windows 安全策略或第三方安全软件可能拦截 foreground 操作。→ `force_window_active` 键盘 hack 作为 fallback 已存在。
- **[低] 400ms debounce 增加感知延迟**：用户点击 overlay 外部后，overlay 有 400ms 延迟才隐藏。→ 400ms 是人眼不易察觉的阈值（用户点击后视线转移本身就有延迟），且正常场景下 `Focused(false)` 后不会立即 `Focused(true)`。
- **[低] GetDpiForMonitor 需要 Win8.1+**：OrbitX 目标平台为 Win10+，不存在兼容性问题。
- **[低] 空串降级增加剪贴板通道调用频率**：之前在部分应用上 AX/UIA 返回空串但前端未获知文本，不影响功能；现在会额外触发 Ctrl+C 模拟。→ 剪贴板通道有互斥锁保护，耗时在百毫秒级，用户体验不受影响。
