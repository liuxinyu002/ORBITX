## Why

ShortcutB (Cmd+Shift+Space) 的剪贴板降级通道存在竞态条件：`spawn_blocking(grab)` 和 `overlay.show().set_focus()` 并行执行，当 overlay 抢走焦点时 `simulate_cmd_c()` 的 Cmd+C 注入命中 overlay 自身而非目标 App，导致抓取返回 `NoSelection`。该问题不稳定复现，取决于线程调度时序。ShortcutA 不受影响（无 overlay）。

## What Changes

- `lib.rs` 快捷键 handler 中将 overlay 的定位+`show()`+`set_focus()` 整体移到 `grab_handle.await` 之后执行，消除竞态窗口

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。现有 `floating-overlay` spec 已要求"without invalidating the selection that is being grabbed"，本次修改是让实现重新符合该要求。

## Impact

- `src-tauri/src/lib.rs`: 调整 ShortcutB handler 中 overlay show/focus 的时序（依赖 `overlay-capsule-redesign` 先合入，以胶囊版 lib.rs 为基线）
