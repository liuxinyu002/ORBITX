## 1. Fix in-flight flag cleanup

- [x] 1.1 将 `lib.rs` ShortcutB 错误处理分支的 `return` 替换为 `None`，用 `if let Some(tag)` 条件调用 `show_overlay_core`，确保所有错误路径都能执行到 `flag.store(false, Ordering::Release)`

## 2. Verification

- [x] 2.1 `cargo build` 通过
- [x] 2.2 Review diff 确认 flag.store 在所有路径均可到达
