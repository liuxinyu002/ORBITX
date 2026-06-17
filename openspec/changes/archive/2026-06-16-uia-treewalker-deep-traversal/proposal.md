## Why

Windows 端 UIA 文本抓取（主路径）对部分应用完全不工作：微信和移动办公 MO 的 `GetFocusedElement` 返回的元素要么不支持 TextPattern，要么 `GetText()` 返回空字符串。根本原因是 Chromium/Electron 应用的 UIA provider 将文本分散在焦点元素的深层子节点中，仅取焦点元素直接关联的 TextPattern 无法触及实际文本。需要引入 TreeWalker 深度遍历作为 UIA 主路径的增强策略，在直接提取失败时向下搜索子树中第一个可用的文本选中范围。

## What Changes

- **UIA 抓取策略分层**：`WinGrabEngine::grab_selected_text` 改为多级策略：第一级沿用现有 `GetFocusedElement` 路径，失败/空文本后进入第二级 TreeWalker 遍历
- **TreeWalker 遍历逻辑**：新增 `try_treewalker_grab()` 函数，使用 `IUIAutomationTreeWalker` (RawView 或 ControlView) 从焦点元素向下深度优先遍历，定位第一个支持 TextPattern 且有非空选中的子节点
- **遍历深度上限**：设置最大遍历节点数（建议 500），防止在巨型控件树上耗尽性能
- **grab-engine spec 更新**：修改 Windows 平台的 UIA 调用链描述，补充 TreeWalker 降级路径
- 不影响 macOS 路径，不改变 `grab_with_fallback` 降级语义

## Capabilities

### New Capabilities

- `uia-treewalker`: Windows 端 UIA TreeWalker 深度遍历能力，在 `GetFocusedElement` 无法提取文本时自动降级到子树搜索

### Modified Capabilities

- `grab-engine`: Windows 平台 UIA 调用链从单一 `GetFocusedElement` 路径扩展为多级策略（直接提取 → TreeWalker 遍历 → 返回空/错误），需求描述和 Scenario 需要补充 TreeWalker 降级行为

## Impact

- `src-tauri/src/grab/windows.rs`：核心变更——新增 `try_treewalker_grab()` 及辅助函数，修改 `grab_selected_text()` 为多级策略
- `src-tauri/Cargo.toml`：确认 `windows` crate features 已包含 TreeWalker 所需的 `IUIAutomationTreeWalker` 接口（当前在 `Win32_UI_Accessibility` 中，应已包含）
- `openspec/specs/grab-engine/spec.md`：补充 TreeWalker 降级路径的 Requirement 和 Scenario
