## ADDED Requirements

### Requirement: TreeWalker fallback when GetFocusedElement yields no text

The Windows UIA grab engine SHALL attempt a secondary strategy using `IUIAutomationTreeWalker` (ControlView) when the primary `GetFocusedElement` path fails with `UnsupportedElement` or returns an empty/whitespace-only string.

The secondary strategy SHALL execute a depth-first search on the control tree rooted at the focused element, visiting at most `MAX_TREEWALKER_NODES` (500) nodes. For each visited node it SHALL:
1. Attempt `GetCurrentPattern(UIA_TextPatternId)` — skip if unsupported
2. Attempt `GetSelection()` — skip if selection length is zero
3. Attempt `GetText(max_length)` — return text if non-empty after trimming

The search SHALL terminate immediately upon finding the first matching text-bearing node.

The decision to activate the TreeWalker SHALL be made by a pure function `should_activate_treewalker` that returns `true` only when the Level 1 result is `Err(UnsupportedElement)` or `Ok(text)` where `text` is empty or whitespace-only. The function SHALL return `false` for `NoSelection`, `System`, `AccessibilityDenied`, `ClipboardTimeout`, `ClipboardLockFailed`, `Internal`, and any `Ok` containing non-whitespace text — these results do NOT indicate that deeper traversal would help.

#### Scenario: Focused element lacks TextPattern, child node has it

- **WHEN** a Chromium-based app has focus, and `GetFocusedElement()` returns a container element without TextPattern
- **THEN** the TreeWalker SHALL DFS from the container element, find the first child node that supports TextPattern and has non-empty selection, and return the selected text

#### Scenario: Focused element has TextPattern but GetText returns empty

- **WHEN** `GetFocusedElement().GetText()` returns an empty string despite a non-empty selection
- **THEN** the TreeWalker SHALL search child nodes for one that both supports TextPattern and returns non-empty `GetText()`

#### Scenario: TreeWalker exhausted without finding text

- **WHEN** the TreeWalker visits 500 nodes (or exhausts the subtree) without finding any node with non-empty selected text
- **THEN** the engine SHALL return `GrabError::UnsupportedElement`

#### Scenario: Focused element itself has valid text

- **WHEN** the focused element directly supports TextPattern and returns non-empty `GetText()`
- **THEN** the TreeWalker SHALL NOT be invoked; the result SHALL be returned directly from the primary path

### Requirement: TreeWalker traversal limits

The TreeWalker traversal SHALL enforce a hard upper bound of 500 visited nodes. Nodes visited counter SHALL increment for every element whose TextPattern support is checked (including those that fail the check).

The traversal SHALL use the `IUIAutomationTreeWalker::ControlViewWalker`, which only visits control elements and skips raw text leaves. Child navigation SHALL use `GetFirstChildElement` / `GetNextSiblingElement`; parent navigation (upward) SHALL NOT be performed.

#### Scenario: Traversal hits node limit

- **WHEN** the TreeWalker visits 500 nodes without finding text
- **THEN** the traversal SHALL abort immediately and return `GrabError::UnsupportedElement`

#### Scenario: Traversal completes under limit with text found

- **WHEN** the TreeWalker finds a text-bearing node at node index 150 (within 500 limit)
- **THEN** the traversal SHALL stop immediately; remaining nodes SHALL NOT be visited

### Requirement: TreeWalker logging

TreeWalker activation and results SHALL be logged in Chinese:

- Info level: activation reason ("GetFocusedElement 未获文本，启动子树遍历（最多 N 节点）"), successful discovery ("在第 N 个节点（深度 D）找到选中文本（M 字符）"), and exhaustion ("遍历 N 节点后未找到文本承载节点，降级至剪贴板")
- Debug level: per-node statistics ("遍历第 N 个节点，当前深度 D") during traversal

#### Scenario: TreeWalker activation logged

- **WHEN** the primary GetFocusedElement path returns empty text or UnsupportedElement and TreeWalker begins
- **THEN** an info-level log SHALL record the activation reason and max node limit with target `grab`
