## Context

`lib.rs` ShortcutB handler 中存在两段并行代码：

- `spawn_blocking(grab_with_fallback)` — 在阻塞线程中执行 save → simulate Cmd+C → poll → read → restore
- `overlay.show().and_then(|_| overlay.set_focus())` — 在 async runtime 上显示悬浮窗并抢占焦点

两者通过 `spawn_blocking` + async 任务并行执行，无任何同步。当 overlay 的 `set_focus()` 在 `simulate_cmd_c()` 之前完成时，`CGEventPost(kCGHIDEventTap)` 将 Cmd+C 注入 overlay 窗口自身，而非用户选中的目标 App，导致剪贴板通道读不到文本。

ShortcutA 不受影响，因为它不弹 overlay，焦点始终在目标 App。

## Goals / Non-Goals

**Goals:**
- 消除 `simulate_cmd_c()` 与 `overlay.set_focus()` 之间的竞态窗口
- 保证抓取完成前 overlay 不抢占焦点，使剪贴板通道的 Cmd+C 注入始终命中目标 App

**Non-Goals:**
- 不改动 `ClipboardGuardian` / `simulate_cmd_c` / overlay 窗口配置
- 不引入新的同步原语或消息通道
- overlay 延迟至抓取完成后弹出（show 与 set_focus 均移至 await 后，增加 <80ms 感知延迟，可接受）

## Decisions

### 1. 将 overlay.show() 也移到 grab_handle.await 之后

**选择**: show 和 set_focus 都移到 await 之后，grab 完成后再弹出 overlay。

**理由**: 如果只推迟 set_focus 而保留 show，overlay 虽然不抢焦点，但 `alwaysOnTop` 窗口弹出可能遮挡选中文本或影响目标 App 的 UI 状态，引入新的不确定性。

**替代方案考虑**: 只推迟 set_focus——窗口提前出现给用户"快"的感知，但 alwaysOnTop overlay 可能干扰模拟 Cmd+C。收益不确定，风险更高。

### 2. 不走显式同步原语

**选择**: 通过执行顺序（先 await 后 show）而非 Mutex/channel 同步。

**理由**: 两个操作天然有先后依赖（grab 结果影响 overlay 显示内容），顺序执行语义最清晰。引入同步原语会徒增复杂度。

## Risks / Trade-offs

- [感知延迟增加] overlay 弹出延迟几十 ms（等待 grab 完成），用户可能感觉变慢 → 改进很小（<50ms），grab 原本就很快；且正确性优先于感知速度
- [叠窗干扰] 即使推迟 show，`alwaysOnTop` overlay 出现瞬间仍有可能遮挡其他操作 → 与现网行为一致，非新引入问题
