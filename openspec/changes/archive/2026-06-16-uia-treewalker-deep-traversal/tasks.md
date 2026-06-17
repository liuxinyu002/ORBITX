## 1. TreeWalker 核心实现

- [x] 1.1 `windows.rs` 新增 `const MAX_TREEWALKER_NODES: u32 = 500`
- [x] 1.2 `windows.rs` 新增 `fn try_treewalker_grab(element: &IUIAutomationElement, uia: &IUIAutomation, max_length: usize) -> Result<String, GrabError>`：获取 `ControlViewWalker`，从 `element` 出发深度优先遍历子节点（`GetFirstChildElement` / `GetNextSiblingElement`），检查 TextPattern + 选中文本，遇到超限返回 `UnsupportedElement`
- [x] 1.3 `windows.rs` 修改 `grab_selected_text()` 为多级策略：Level 1 直接提取 → 若 `UnsupportedElement` 或空文本 → Level 2 调用 `try_treewalker_grab`
- [x] 1.4 添加 TreeWalker 相关中文日志：info 级别记录激活原因、成功发现、遍历耗尽，debug 级别记录逐节点遍历统计；遍历中 `GetFirstChildElement`/`GetNextSiblingElement` 失败时记录 debug 日志后跳过该分支继续

## 2. 测试

### 2a. 可单元测试的纯逻辑（无 COM 依赖）

- [x] 2a.1 提取元素过滤决策函数 `fn check_node_has_text(pattern_result: Result<_, Error>, selection_len: i32, text: &str) -> Option<String>`，并编写单元测试覆盖：不支持 TextPattern → None、selection 为空 → None、GetText 空串 → None、正常文本 → Some
- [x] 2a.2 新增单元测试：遍历计数器在达到 `MAX_TREEWALKER_NODES` 时触发超限返回 `UnsupportedElement`（将计数器逻辑提取为可独立测试的函数）

### 2b. 集成测试（需 Windows 环境 + COM）

- [ ] 2b.1 人工验证（任务 3.2-3.5）同时充当集成测试：`grab_selected_text` 多级策略在真实应用上的行为验证

### 2c. 回归测试

- [x] 2c.1 `cargo test` 确认所有已有测试继续通过

## 3. 编译与平台验证

- [ ] 3.1 `cargo build --target x86_64-pc-windows-msvc` 确认编译通过（CI 或交叉编译）
- [ ] 3.2 人工验证：在微信 Windows 端选中文本，快捷键触发 → TreeWalker 成功提取文本
- [ ] 3.3 人工验证：在移动办公 MO Windows 端选中文本 → TreeWalker 成功提取文本
- [ ] 3.4 人工验证：在移动办公 Windows 端选中文本 → Level 1 直接成功，不触发 TreeWalker（回归）
- [ ] 3.5 人工验证：在原生应用（Notepad）选中文本 → Level 1 直接成功，行为不变
- [ ] 3.6 人工验证：macOS 端行为不受影响
