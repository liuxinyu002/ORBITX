## 1. Implementation

- [x] 1.1 将 `lib.rs` ShortcutB handler 中 overlay 定位+show+set_focus 代码块移到 `grab_handle.await` 之后
- [x] 1.2 确认 ShortcutA handler 逻辑未被改动

## 2. Verification

- [x] 2.1 `cargo test -p orbitx --lib` 通过，确认现有测试未被破坏
- [x] 2.2 手动测试：Cmd+Shift+E 和 Cmd+Shift+Space 各执行 5 次，均能正确提取选中文本
