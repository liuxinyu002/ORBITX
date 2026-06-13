## Context

当前代码库已完成 Phase 1-3。Rust 后端有完整的 Tauri command 调度体系、SQLite 数据层和系统托盘模块，前端有 HashRouter 路由体系。但没有任何全局快捷键、辅助功能 API 调用或第二 webview 窗口。Phase 4 需要从零搭建抓取引擎和快捷键体系。

## Goals / Non-Goals

**Goals:**
- 建立跨平台文本抓取抽象层（GrabEngine trait），macOS 用 AXUIElement + core-foundation，Windows 用 UIA + windows crate
- 注册两个全局快捷键：静默提取 (CmdOrCtrl+Shift+E) 和唤出面板 (CmdOrCtrl+Shift+Space)
- 悬浮窗预加载、骨架态→内容态过渡、失焦/ESC 关闭
- 状态驱动的 Rust→前端数据流（GrabState + grab-completed event + pull 模式）
- 后台驻留模式：关闭主窗口后应用保持运行，快捷键持续响应

**Non-Goals:**
- 不实现剪贴板兜底方案
- 不实现命令面板的业务逻辑（Phase 5）
- 不实现静默提取后的 AI 派发和入库（Phase 5）
- 不提供快捷键自定义（MVP 阶段硬编码）
- 不支持 Linux（MVP 仅 macOS + Windows）

## Decisions

### 1. 全局快捷键：tauri-plugin-global-shortcut + Rust 侧动态注册

**选择**: 使用 `tauri-plugin-global-shortcut` 官方插件，快捷键通过 `app.global_shortcut().register()` 在 Rust 侧动态注册。

**替代方案考虑**:
- 原生 Carbon/RegisterHotKey 自己封装：控制力更强但维护成本高，且插件已满足需求
- 静态声明（tauri.conf.json）：配置简单但不如 Rust 侧动态注册灵活（无法在注册前后执行逻辑）

**键位**:
- 快捷键 A (静默): `CmdOrCtrl+Shift+E`
- 快捷键 B (面板): `CmdOrCtrl+Shift+Space`

### 2. 抓取引擎：Trait 抽象 + cfg 条件编译

**选择**: 定义 `GrabEngine` trait，通过 `#[cfg(target_os)]` 注入 `macos::MacGrabEngine` 或 `windows::WinGrabEngine`。每次快捷键触发时临时创建实例（不放入 Tauri State），且平台对象不得跨线程持有。

**替代方案考虑**:
- 放入 Tauri managed State：Windows COM 对象的 STA/MTA 线程模型会导致 Send+Sync 陷阱和跨线程内存违例风险
- 不在 Rust 侧抽象，直接在 handler 里 cfg 分支：代码重复，扩展性差

**底层 Crate 选择**:
- macOS: `core-foundation` + `extern "C"` 手动绑定最小集（`AXUIElementCreateSystemWide`、`AXUIElementCopyAttributeValue`、`AXUIElementCopyParameterizedAttributeValue`、`AXValueCreate`、`AXValueGetValue`）。`objc2` 是过度封装，AX API 本质上是 CoreFoundation C 接口
- Windows: 官方 `windows` crate（`windows::Win32::UI::UIAutomation`）。社区 `uiautomation` crate 不如官方维护稳定

**方法签名**:
```rust
trait GrabEngine {
    fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError>;
}
```

### 3. 错误模型：统一 GrabError + 平台内部分配

五个业务语义变体，对前端绝对屏蔽平台差异：

```rust
enum GrabError {
    AccessibilityDenied,   // 需要引导用户授权
    NoSelection,           // 正常：无选中文本
    UnsupportedElement,    // 正常：控件不支持文本选择
    System(String),        // 异常：记录原始错误信息
    Internal(String),      // 异常：非平台层错误
}
```

macOS AXError 常量在 `macos.rs` 内部私有映射，Windows HRESULT 同理。

### 4. 数据流：GrabQueue + Event 通知 + RequestId 拉取

```rust
// Tauri Managed State — 单一真实来源
struct GrabState(Mutex<VecDeque<GrabEnvelope>>);

struct GrabEnvelope {
    request_id: String,
    source: GrabSource,
    created_at_ms: u64,
    result: Result<String, GrabError>,
}
```

**链路**:
1. 快捷键触发 → `spawn_blocking` 中执行 `grab_selected_text(max_length)`
2. 生成 `request_id`，将 `Result<String, GrabError>` 连同 `source` 一并写入 `GrabState`
3. `emit("grab-completed", { requestId, source })` — 轻量通知，不含文本
4. 前端收到 event → `invoke("consume_grabbed_result", { requestId })` 定向拉取
5. 仅移除匹配 `request_id` 的队列项，避免跨窗口误消费
6. 队列设置上限与 TTL，超限时丢弃最旧项并记日志

**事件中不传输文本体**：保持 event 轻量，长文本走 invoke 按需传输。

### 5. 悬浮窗：独立 Webview + 预加载 + 骨架态

**窗口配置**:
```json
{
  "label": "overlay",
  "url": "/overlay",
  "visible": false,
  "decorations": false,
  "transparent": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "center": true,
  "width": 760,
  "height": 480,
  "resizable": false
}
```

**显示时序**:
1. 快捷键 B 先启动抓取任务，保留原应用焦点
2. 若平台支持非激活显示，则以 non-activating 方式显示 overlay 骨架态；若不支持，则等抓取结果入队后再显示 overlay
3. `grab_completed` event 到达后 invoke 定向拉取文本，填入预览区
4. 只有在用户显式交互 overlay 时才允许 `set_focus()`

**关闭逻辑**:
- Esc: React 前端 `keydown` listener → `getCurrentWebviewWindow().hide()`
- 失焦: Rust 侧 `overlay.on_window_event(Focused(false))` → `hide()`，但权限引导态和首次显示过渡态暂时抑制自动隐藏

### 6. 异步隔离：spawn_blocking 包裹所有系统 API 调用

原因：AXUIElement/UIA 是跨进程 IPC，目标 app 无响应时会阻塞。绝不阻塞 Tauri 主线程和快捷键钩子队列。Windows 下 `CoInitializeEx` 在 blocking 线程内独立完成，避免 COM 线程模型污染。

```rust
app.global_shortcut().on_shortcut(shortcut, move |app, _sc, _event| {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            let _com = ComGuard::initialize()?;
            let engine = PlatformGrabEngine::new();
            engine.grab_selected_text(MAX_GRAB_LENGTH)
        }).await.unwrap();
        // update state, emit event, manage window...
    });
});
```

**并发控制**:
- 仅响应快捷键 `Pressed` 事件，忽略 `Released/Repeat`
- 每个快捷键维护独立 `AtomicBool` in-flight 标记和最小去抖间隔
- 同一快捷键已有任务在执行时，新触发直接丢弃或折叠

**内存/资源安全**:
- macOS 侧所有 `Copy*` 返回值必须立即包裹到 RAII 类型，禁止裸 `CFTypeRef` 穿透业务层
- `CFTypeRef` 向 `AXUIElementRef`、`AXValueRef`、`CFStringRef` 转换前必须做 type id 校验
- Windows 侧所有 COM 接口必须在初始化它们的同一 blocking 线程内释放，不得跨线程缓存到 `State`

### 7. 权限与 UI 状态机

**选择**: 权限拒绝不走瞬时 Toast，而是显式状态机：

```rust
enum OverlayUiState {
    Hidden,
    Skeleton { request_id: String },
    Content { request_id: String, text: String },
    Empty { request_id: String },
    PermissionRequired,
}
```

- 抓取前先做权限 preflight 检查
- 处于 `PermissionRequired` 时暂停 blur-auto-hide，避免和系统授权弹窗抢焦点
- 前端引导页只提供本地说明与“我已授权，重试”操作，不触发任何网络能力

### 8. 生命周期与退出清理

**选择**: 建立单一 `shutdown()` 协调器，统一处理：
- 注销所有全局快捷键
- 释放托盘与窗口事件监听
- 执行数据库 WAL checkpoint
- 清空 grab 队列中的临时数据
- 仅此路径允许 app 真正退出

## Risks / Trade-offs

- **[macOS 权限]** AXUIElement 需要辅助功能权限，用户首次使用可能被拒绝 → 权限前置检查 + 前端固定引导态
- **[Windows COM 初始化]** 每次 `CoInitializeEx` 有微小开销 → `spawn_blocking` 隔离 + RAII guard 成对 `CoUninitialize`
- **[预加载内存]** overlay 窗口常驻内存 → 窗口体积极小（760×480，无复杂 UI），内存占用可忽略
- **[快捷键冲突]** `CmdOrCtrl+Shift+Space` 可能与 IDE 等应用的快捷键冲突 → 暂不作为 MVP 阶段问题处理
- **[跨平台文本截断一致性]** macOS AX API 没有 `maxLength` 参数 → 用 `AXValue(CFRange)` 调 `kAXStringForRangeParameterizedAttribute`；Rust 字符串落地后再次做 Unicode 标量边界截断
- **[窗口焦点]** overlay 若抢焦点会破坏抓取目标 → 默认非激活显示，必要时延后聚焦

## Open Questions

无。经过深入讨论，所有关键设计决策已敲定。
