## Context

当前 `WinGrabEngine::grab_selected_text` 的 UIA 调用链仅针对焦点的直接元素：

```
GetFocusedElement → GetCurrentPattern(TextPattern) → GetSelection → GetText
```

对于原生 Win32 控件和部分 WPF 应用，焦点元素自身即承载 TextPattern，可以直接提取选中文本。但 Chromium/Electron 应用（微信、移动办公 MO）的 UIA provider 将文本内容分散在控件树的深层子节点中。焦点元素可能是某个容器或 group 角色，其子节点才真正持有 TextPattern 和选中范围。

调用 `GetFocusedElement().GetCurrentPattern(TextPattern)` 时会出现两种情况：
- 焦点元素不支持 TextPattern：`GetCurrentPattern` 返回错误 → `UnsupportedElement`
- 焦点元素表面支持 TextPattern 但 `GetText()` 返回空字符串 → 降级到剪贴板

TreeWalker 遍历可以在上述两种情况下尝试搜索子树，找到真正持有文本的叶节点。

## Goals / Non-Goals

**Goals:**
- 在 `GetFocusedElement` 路径失败或返回空文本后，自动降级到 TreeWalker 子树搜索
- TreeWalker 从焦点元素出发，深度优先遍历子节点，找到第一个同时满足"支持 TextPattern"和"有非空选中文本"的元素
- 设置遍历深度上限，避免在超大控件树上超时
- 保持与现有 UIA 错误语义的一致性

**Non-Goals:**
- 不修改 macOS 路径
- 不修改 `grab_with_fallback` 的降级判断语义——TreeWalker 仍然是 UIA 主路径的一部分，其失败不影响后续剪贴板降级
- 不引入新的外部 crate 依赖
- 不尝试修复第三方应用的 UIA provider 缺陷（那是应用自身的问题）

## Decisions

### 决策 1：TreeWalker 激活时机

**选择**：在现有 `grab_selected_text` 内实现多级策略：

```
Level 1: GetFocusedElement → TextPattern → GetText  （现有路径）
Level 2: 若结果为 Err(UnsupportedElement) 或 Ok("") → TreeWalker 遍历  （新增）
Level 3: 返回结果，由 grab_with_fallback 决定是否继续降级到剪贴板
```

**理由**：
- TreeWalker 失败（找不到合适节点）返回原有的错误类型（`UnsupportedElement` 或 `NoSelection`），`grab_with_fallback` 无需感知 TreeWalker 的存在
- 遍历逻辑封装在 `WinGrabEngine` 内部，不影响跨平台抽象

**替代方案**：
- 方案 B：在 `grab_with_fallback` 中增加 TreeWalker 作为独立层级（Layer 1.5）→ 拒绝，TreeWalker 是 Windows 平台特有的 UIA 操作，不应侵入跨平台降级管道
- 方案 C：始终优先用 TreeWalker，跳过 `GetFocusedElement` → 拒绝，原生应用焦点元素直接取文本是最快路径，不应增加不必要的遍历

### 决策 2：TreeWalker 模式选择

**选择**：使用 `IUIAutomationTreeWalker` 的 `ControlViewWalker`，手工实现深度优先遍历。

**理由**：
- `ControlViewWalker` 只遍历控件元素（跳过 RawView 中的文本叶节点和容器元素），比 `RawViewWalker` 更高效
- `FindFirst` / `FindAll` 使用 `PropertyCondition` 搜索 `IsTextPatternAvailable`，理论上更简洁，但 `FindAll` 会一次性加载所有匹配节点，可能触发大规模 COM 调用开销
- 手工 DFS 在每步只持有一个元素，内存开销可控，且可以在超额深度时提前终止

**替代方案**：
- 方案 B：`FindFirst(TreeScope_Descendants, PropertyCondition(IsTextPatternAvailable=True))` → 较简洁，但 `FindFirst` 返回"第一个匹配的祖先/自身/后代"而非保证是最近的文本承载节点，且无法控制搜索顺序（宽度 vs 深度）。可在后续迭代中评估。
- 方案 C：`RawViewWalker` → 拒绝，RawView 包含太多低级文本节点（如 TextLeaf），每个都需要尝试，效率低

**API 选型**：
```rust
let walker = uia.ControlViewWalker()?;          // 获取 Control view walker
let child = walker.GetFirstChildElement(&elem)?; // 取第一个子节点
let sibling = walker.GetNextSiblingElement(&e)?; // 取兄弟节点
```

### 决策 3：遍历上限

**选择**：最大遍历节点数 500。

**理由**：
- 500 节点足以覆盖从顶层容器到文本叶节点的搜索（大多数控件树中叶子节点深度 < 20，广度 < 50）
- 在 500 个节点内仍未找到 TextPattern 意味着控件树异常大或应用结构特殊，继续遍历无明显收益，反而可能导致数百毫秒的阻塞
- 遍历上限作为常量 `const MAX_TREEWALKER_NODES: u32 = 500` 定义在 `windows.rs` 中

### 决策 4：元素过滤条件

**选择**：对每个遍历到的元素检查两个条件：
1. 支持 TextPattern（`GetCurrentPattern(UIA_TextPatternId)` 成功）
2. `GetSelection().Length() > 0` 且 `GetText()` 返回非空文本

**理由**：
- 两步检查避免对不支持 TextPattern 的元素做无用功
- 检查 `GetSelection().Length() > 0` 确保只记录有实际选中的节点（用户可能选中了文本，而其他同级的 TextPattern 节点是静态文本或模板文本）

### 决策 5：遍历中的错误处理

**选择**：TreeWalker 遍历过程中 `GetFirstChildElement` / `GetNextSiblingElement` 调用失败时，记录 debug 日志后跳过该分支继续遍历，不中止整个搜索。

**理由**：
- 中间节点可能因 UIA provider 异步更新而被销毁，跳过单个分支比中止整个遍历更鲁棒
- 仅当根元素（`GetFocusedElement` 返回的元素）本身不可用时直接返回 `UnsupportedElement`
- 跳过失败分支不增加节点计数，防止异常节点消耗遍历配额

### 决策 6：日志与可观测性

**选择**：TreeWalker 触发、成功、耗尽均记录 info 级别日志；遍历过程中的逐节点统计记录 debug 级别。

```rust
log::info!(target: "grab", "TreeWalker: GetFocusedElement 未获文本，启动子树遍历（最多 {} 节点）", MAX_TREEWALKER_NODES);
log::debug!(target: "grab", "TreeWalker: 遍历 {} 节点，目标深度 {}", nodes_visited, depth);
log::info!(target: "grab", "TreeWalker: 在第 {} 个节点（深度 {}）找到选中文本（{} 字符）", idx, depth, len);
log::info!(target: "grab", "TreeWalker: 遍历 {} 节点后未找到文本承载节点，降级至剪贴板", nodes_visited);
```

## Risks / Trade-offs

- **[中] 性能开销**：TreeWalker DFS 在大型控件树（如复杂 Web 页面渲染出的 UIA 树）上可能耗时数十毫秒。→ 通过 500 节点上限和提前终止控制。`grab_selected_text` 本身就在 `spawn_blocking` 中运行，不阻塞 UI 线程。
- **[低] ControlView vs RawView 遗漏文本**：某些应用可能在 RawView 中暴露文本但 ControlView 中不暴露。→ 如果 ControlView 遍历无结果，可以在 Level 2 再尝试 RawView 遍历（后续迭代优化）。
- **[低] 遍历到的节点不是用户实际选中的节点**：同一个控件树可能多个文本节点同时有选中状态（罕见）。→ 深度优先 + 第一个匹配的策略通常命中用户实际选中的叶节点（最接近焦点的选中文本）。
- **[低] 新接口 compatibility**：`IUIAutomationTreeWalker` 和 `ControlViewWalker` 在 Win8+ 可用，OrbitX 目标平台为 Win10+，无兼容性问题。
