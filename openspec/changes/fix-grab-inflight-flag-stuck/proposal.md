## Why

ShortcutB 抓取失败（如 `OpenClipboard` 权限被拒绝）后，`flag.store(false, Ordering::Release)` 被错误处理分支的 `return` 跳过，导致 `AtomicBool` 永久停留在 `true`，此后所有同快捷键触发均被"已在途"拦截，需重启应用才能恢复。这是一个状态清理 bug，而非 OpenClipboard 权限问题本身。

## What Changes

- 修复 `lib.rs` 中 ShortcutB 错误处理分支的 early return，确保任何错误路径都能执行到 `flag.store(false, Ordering::Release)`

## Capabilities

### New Capabilities

（无 —— 纯 bug 修复，不引入新能力）

### Modified Capabilities

（无 —— 不改变已有 spec 的行为约定，仅修复实现与约定的偏差）

## Impact

- `src-tauri/src/lib.rs:347-355`：ShortcutB 的错误匹配分支
