## Context

`lib.rs` 的快捷键处理闭包中，ShortcutB 抓取失败时通过 `match e` 区分可恢复错误（显示 error overlay）和不可恢复错误（不显示 overlay）。当前不可恢复错误分支使用 `return` 提前退出闭包，跳过了末尾的 `flag.store(false, Ordering::Release)`。

现有错误分类：

| 错误类型 | 当前行为 | 意图 |
|---|---|---|
| `AccessibilityDenied` | 显示 "permission-required" overlay | 用户可操作恢复 |
| `NoSelection` | 显示 "empty" overlay | 用户可重试 |
| `ClipboardTimeout` | 显示 "timeout" overlay | 用户可重试 |
| 其他（`System`, `Internal` 等） | `return` 提前退出 | 不显示 overlay（静默失败） |

## Goals / Non-Goals

**Goals:**
- 确保任何错误路径都能执行 `flag.store(false, Ordering::Release)`
- 保持静默失败：`System` 等不可恢复错误不唤起 overlay

**Non-Goals:**
- 不改动 ShortcutA 分支（无此 bug）
- 不引入 RAII guard 重构（缩小改动面）
- 不增加 `OpenClipboard` 重试逻辑（独立问题）
- 不改变 overlay 的显示/隐藏行为

## Decisions

**方案：将 `return` 替换为条件跳过 `show_overlay_core` 调用**

```rust
// Before (有 bug):
Err(e) => {
    let tag = match e {
        GrabError::AccessibilityDenied => "permission-required",
        GrabError::NoSelection => "empty",
        GrabError::ClipboardTimeout => "timeout",
        _ => {
            log::debug!(target: "grab", "抓取失败不唤起悬浮窗: {:?}", e);
            return; // BUG: 跳过 flag.store(false)
        }
    };
    let payload = OverlayPayload { ... };
    let _ = show_overlay_core(&app_handle, payload);
}

// After:
Err(e) => {
    let tag = match e {
        GrabError::AccessibilityDenied => Some("permission-required"),
        GrabError::NoSelection => Some("empty"),
        GrabError::ClipboardTimeout => Some("timeout"),
        _ => {
            log::debug!(target: "grab", "抓取失败不唤起悬浮窗: {:?}", e);
            None
        }
    };
    if let Some(tag) = tag {
        let payload = OverlayPayload { ... };
        let _ = show_overlay_core(&app_handle, payload);
    }
}
```

**备选方案对比：**

| | Option A: tag → Option | Option B: RAII guard | Option C: flag.store 在每个 return 前 |
|---|---|---|---|
| 改动量 | 最小（仅一处） | 中（新增 Drop 类型 + 替换 CAS/store） | 中（每个 return 都要加） |
| 未来安全 | 中（仍可能被新 return 绕过） | 高（编译器保证释放） | 低（容易遗漏新 return） |
| 风险 | 低 | 低（需验证 Drop 顺序） | 低 |

选择 **Option A**：改动最小，符合"精准修改"原则。当前的早期 return 只有一个，修复它即可。RAII guard 虽然理论上更安全，但属于设计层面的改动，不符合 bug fix 的最小范围原则。

## Risks / Trade-offs

- **未来新增 return 可能重现此 bug**：当前闭包主体中仅此一处 `return`，且代码审查应能发现。如后续多次出现，可升级为 RAII guard 方案。
- **flag.store 仍为手动管理**：与其他 `let _ = ...` 风格一致，无新增不一致。
