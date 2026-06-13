## Stage 1: 抓取引擎核心

> **目标**: 建立跨平台文本抓取的 trait 抽象与两端实现。编译通过即闭环。
> **依赖**: 无
> **验证**: `cargo build` 在 macOS 和 Windows 均成功；各平台调用 `grab_selected_text` 返回文本或业务错误码。

### 1.1 Cargo 依赖

- [x] 1.1.1 `Cargo.toml` 新增 `tauri-plugin-global-shortcut` 依赖
- [x] 1.1.2 `Cargo.toml` 新增 macOS 依赖: `core-foundation` (`target.'cfg(target_os = "macos")'`)
- [x] 1.1.3 `Cargo.toml` 新增 Windows 依赖: `windows` crate, features `Win32_UI_UIAutomation` (`target.'cfg(target_os = "windows")'`)

### 1.2 核心抽象

- [x] 1.2.1 创建 `src-tauri/src/grab/mod.rs`: 定义 `GrabEngine` trait（`fn grab_selected_text(&self, max_length: usize) -> Result<String, GrabError>`）
- [x] 1.2.2 定义 `GrabError` enum（5 variants: `AccessibilityDenied`, `NoSelection`, `UnsupportedElement`, `System(String)`, `Internal(String)`）+ `Serialize`/`Deserialize` derive
- [x] 1.2.3 创建 `src-tauri/src/grab/macos.rs`: `#[cfg(target_os = "macos")]` 模块，含 `MacGrabEngine` 骨架（`todo!()`）
- [x] 1.2.4 创建 `src-tauri/src/grab/windows.rs`: `#[cfg(target_os = "windows")]` 模块，含 `WinGrabEngine` 骨架（`todo!()`）
- [x] 1.2.5 创建 `src-tauri/src/grab/constants.rs`: 定义 `MAX_GRAB_LENGTH: usize = 2000`、`SHORTCUT_SILENT_EXTRACT`、`SHORTCUT_COMMAND_PALETTE`
- [x] 1.2.6 `src-tauri/src/lib.rs` 中声明 `mod grab`

### 1.3 macOS 实现 (AXUIElement)

- [x] 1.3.1 手写 `extern "C"` 绑定：`AXUIElementCreateSystemWide`、`AXUIElementCopyAttributeValue`、`AXUIElementCopyParameterizedAttributeValue`、`AXValueCreate`、`AXValueGetValue`
- [x] 1.3.2 声明最小必需常量：`kAXFocusedApplicationAttribute`、`kAXFocusedUIElementAttribute`、`kAXSelectedTextRangeAttribute`、`kAXStringForRangeParameterizedAttribute`
- [x] 1.3.3 实现 RAII 封装：对 `Copy*` 返回的 `CFTypeRef` 自动 `CFRelease`，`AXUIElementRef`/`AXValueRef`/`CFStringRef` 转换前做 type id 校验
- [x] 1.3.4 实现 `GrabEngine` trait for `MacGrabEngine`：调用链 `CreateSystemWide → CopyAttribute(focused app) → CopyAttribute(focused element) → CopyAttribute(selected range) → AXValue(CFRange) clamp → AXValueCreate → CopyParameterizedAttribute(StringForRange) → Rust 侧 Unicode 标量边界二次截断`
- [x] 1.3.5 实现私有 `fn map_ax_error(code: i32) -> GrabError`（映射 `kAXErrorAPIDisabled`/`kAXErrorNoValue`/`kAXErrorAttributeUnsupported`/`kAXErrorNotImplemented`/`kAXErrorActionUnsupported` 等）
- [x] 1.3.6 按 spec 添加中文日志（debug: NoSelection/UnsupportedElement, warn: AccessibilityDenied, error: System/Internal）

### 1.4 Windows 实现 (UIA)

- [x] 1.4.1 `windows.rs` 中引入 `windows::Win32::UI::UIAutomation` 与 `windows::Win32::System::Com` 相关类型
- [x] 1.4.2 实现 `ComGuard` RAII struct：构造时 `CoInitializeEx(COINIT_APARTMENTTHREADED)`，析构时 `CoUninitialize`
- [x] 1.4.3 实现 `WinGrabEngine` struct 与 `GrabEngine` trait；禁止 `IUIAutomation` 存活到 blocking 闭包之外（`struct` 不含 `Send`/`Sync` 敏感字段）
- [x] 1.4.4 实现调用链：`CUIAutomation::new() → GetFocusedElement → GetCurrentPattern(UIA_TextPatternId) → GetSelection → GetText(max_length)`
- [x] 1.4.5 实现私有 `fn map_uia_error(err: windows::core::Error) -> GrabError`（`UIA_E_PATTERNUNAVAILABLE` → UnsupportedElement, `E_ACCESSDENIED` → AccessibilityDenied, 空 selection → NoSelection, 其余 → System）
- [x] 1.4.6 按 spec 添加中文日志（分级同上）

---

## Stage 2: 状态管道与全局快捷键

> **目标**: 打通"按键→抓取→入队→事件→前端消费→Toast 反馈"的完整链路（仅快捷键 A 静默提取）。
> **依赖**: Stage 1（GrabEngine 可用）
> **验证**: 在任意应用中按 `CmdOrCtrl+Shift+E` → 主窗口弹出 Toast "已提取" 或 "未发现选中文本"；托盘菜单显示快捷键注册状态。

### 2.1 GrabState 队列模型

- [x] 2.1.1 创建 `src-tauri/src/grab/state.rs`: 定义 `GrabEnvelope { request_id: String, source: GrabSource, result: Result<String, GrabError>, created_at_ms: u64 }`
- [x] 2.1.2 定义 `GrabState(Mutex<VecDeque<GrabEnvelope>>)` + 队列上限常量（`MAX_QUEUE_SIZE: usize = 16`）+ TTL 常量（`ENVELOPE_TTL_MS: u64 = 30_000`）
- [x] 2.1.3 实现 `GrabState` 的 `push` 方法：超限时淘汰最旧项并记 warn 日志
- [x] 2.1.4 实现 `GrabState` 的 `consume(request_id)` 方法：`VecDeque::retain` 移除匹配项并返回；消费前过滤 TTL 过期项
- [x] 2.1.5 在 `lib.rs` setup 中将 `GrabState` 注入 `app.manage()`

### 2.2 Tauri Command

- [x] 2.2.1 实现 `consume_grabbed_result` command（`#[tauri::command]`）：接收 `request_id: String`，调用 `state.consume(request_id)`，返回 `Result<Option<String>, GrabError>`；未找到匹配项时返回 `Ok(None)`
- [x] 2.2.2 注册到 `commands/mod.rs` 和 `lib.rs` 的 `generate_handler![]`
- [x] 2.2.3 `capabilities/default.json` 新增 global-shortcut 插件权限

### 2.3 全局快捷键注册

- [x] 2.3.1 在 `lib.rs` setup 中初始化 `tauri-plugin-global-shortcut` 插件（`app.plugin(GlobalShortcutPlugin::new())` 或等效 API）
- [x] 2.3.2 实现快捷键 handler：仅响应 `Pressed` 状态，忽略 `Released`
- [x] 2.3.3 实现去抖/在途保护：每个快捷键独立 `AtomicBool` in-flight 标记，已在途时丢弃新触发
- [x] 2.3.4 实现 handler 内 `tauri::async_runtime::spawn` → `tokio::task::spawn_blocking` 包裹 → 生成 `request_id` → `GrabEngine` 临时创建 → 抓取 → 入队 → emit `grab-completed { requestId, source }`
- [x] 2.3.5 注册 `SHORTCUT_SILENT_EXTRACT` 和 `SHORTCUT_COMMAND_PALETTE`（快捷键 B handler 先 emit 事件但暂不处理 overlay，留到 Stage 3）

### 2.4 托盘菜单更新

- [x] 2.4.1 托盘 item 2（全局设置）从 disabled 改为 enabled，点击时 show + navigate 到 `/settings`
- [x] 2.4.2 快捷键注册成功后，通过 `TrayMenuRefs` 将 item 3 更新为 "静默提取: 已注册"
- [x] 2.4.3 快捷键注册失败时，item 3 更新为 "静默提取: 未注册" 并记 warn 日志

### 2.5 主窗口 Toast 响应（快捷键 A）

- [x] 2.5.1 主窗口根组件监听 `grab-completed` event，筛选 `source == "shortcut-a"`
- [x] 2.5.2 收到事件后 `invoke("consume_grabbed_result", { requestId })`
- [x] 2.5.3 拿到 `Ok(Some(text))` → Toast "已提取"（Phase 5 才入库，此处仅占位验证）
- [x] 2.5.4 `NoSelection` / `UnsupportedElement` → Toast "未发现选中文本"
- [x] 2.5.5 `AccessibilityDenied` → 弹出权限引导 Toast（内容来自 spec："请在系统设置→隐私与安全性→辅助功能中授权 OrbitX"）
- [x] 2.5.6 监听逻辑兼容 React Strict Mode 双重挂载

---

## Stage 3: 悬浮窗

> **目标**: 快捷键 B 唤出独立 webview 悬浮窗，骨架态→内容态过渡，Esc/失焦关闭，权限引导态抑制 blur-auto-hide。
> **依赖**: Stage 2（GrabState 队列 + 快捷键 handler 已就绪）
> **验证**: 按 `CmdOrCtrl+Shift+Space` → overlay 居中弹出 → 骨架态 → 抓取完成 → 内容填充；Esc 关闭；点击其他 app 自动隐藏；权限拒绝时展示固定引导页。

### 3.1 窗口配置

- [x] 3.1.1 `tauri.conf.json` 的 `windows` 数组新增 overlay 声明：`label: "overlay"`, `url: "/overlay"`, `visible: false`, `decorations: false`, `transparent: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `center: true`, `width: 760`, `height: 480`, `resizable: false`
- [x] 3.1.2 `capabilities/default.json` 新增 overlay 窗口的 `core:default` 权限

### 3.2 Rust 侧窗口管理

- [x] 3.2.1 setup 阶段获取 overlay webview window handle
- [x] 3.2.2 挂载 `on_window_event(Focused(false))` → `hide()`；实现抑制标记：权限引导态 (`PermissionRequired`) 期间暂不自动隐藏
- [x] 3.2.3 处理 `CloseRequested` → `api.prevent_close()` + `hide()`（不退出 app）
- [x] 3.2.4 更新 2.3.5 的快捷键 B handler：抓取任务启动后（不等完成）先以 non-activating 方式 show overlay；若平台不支持 non-activating，则等结果入队后再 show
- [x] 3.2.5 实现统一 `fn shutdown(app)` 清理路径：注销全部快捷键 → 清空 grab 队列 → 释放窗口事件监听 → 释放托盘 → WAL checkpoint → `app.exit(0)`
- [x] 3.2.6 托盘 "退出" 按钮和 `CloseRequested`（main 窗口的 Cmd+Q）统一调用 `shutdown()`

### 3.3 前端 Overlay 页面

- [x] 3.3.1 创建 `src/routes/overlay.tsx`: 分段布局（命令输入框 disabled 占位 + 分隔线 + 文本预览区）
- [x] 3.3.2 实现 `OverlayUiState` 枚举：`Skeleton | Content { text } | Empty | PermissionRequired`
- [x] 3.3.3 Skeleton 态：mount 时立即渲染闪烁占位块（CSS animation pulse），命令输入框 disabled + placeholder
- [x] 3.3.4 监听 `grab-completed` event → 提取 `requestId` → `invoke("consume_grabbed_result", { requestId })`
- [x] 3.3.5 `Ok(Some(text))` → 切换到 Content 态，预览区展示文本
- [x] 3.3.6 `NoSelection` / `UnsupportedElement` → 切换到 Empty 态，显示 "未发现选中文本"
- [x] 3.3.7 `AccessibilityDenied` → 切换到 PermissionRequired 态：显示权限说明文字 + "我已授权，重试" 按钮（纯本地，无网络调用）；通过 event 或 state 通知 Rust 侧抑制 blur-auto-hide
- [x] 3.3.8 Esc 键盘监听 → `getCurrentWebviewWindow().hide()`；cleanup 中移除监听
- [x] 3.3.9 `listen("grab-completed")` 使用 `await` 拿到 `UnlistenFn`，Strict Mode 下确保单例
- [x] 3.3.10 `src/App.tsx` 新增 `/overlay` 路由：独立渲染，不使用 `RootLayout`（无 Header/Sidebar）
- [x] 3.3.11 overlay 路由不挂载 `AgentProvider` 等含网络能力的 Provider，仅保留 IPC/Tauri 基础依赖

---

## Stage 4: 集成验证与打磨

> **目标**: 端到端完整性验证，覆盖正常路径、异常路径、并发、长时间驻留。
> **依赖**: Stage 1-3 全部完成
> **验证**: 所有勾选项通过。

### 4.1 平台验证

- [x] 4.1.1 macOS: 快捷键注册 → 选中文本抓取 → 悬浮窗弹出/关闭 端到端
- [x] 4.1.2 macOS: 辅助功能权限未授予时，overlay 展示 PermissionRequired 引导态 → 授权后重试成功
- [x] 4.1.3 macOS: 目标 app 无响应时（强制 kill 后立即按快捷键）→ 无崩溃、无 hang、超时后返回 System error + Toast
- [x] 4.1.4 Windows: 快捷键注册 → 选中文本抓取 → 悬浮窗弹出/关闭 端到端
- [x] 4.1.5 Windows: 控件不支持 TextPattern 时 → UnsupportedElement → Toast "未发现选中文本"
- [x] 4.1.6 Windows: COM 初始化失败时 → System error 日志 + Toast 降级提示

### 4.2 健壮性验证

- [x] 4.2.1 后台驻留：关闭主窗口 → 快捷键 A/B 均响应 → 托盘 "退出" 正常终止且无热键残留
- [x] 4.2.2 压测：连续高频触发 50+ 次快捷键 → 无重入、无幽灵数据、无 UI 抖动、无队列溢出崩溃
- [x] 4.2.3 soak test：后台驻留 30 分钟 → 再次触发快捷键 → 确认 macOS CF 对象无泄漏、Windows COM 线程正常
- [x] 4.2.4 React Strict Mode: overlay 与主窗口 grab-completed 监听只注册一次
- [x] 4.2.5 竞态：快捷键 A 和 B 交替快速触发 → 各自 `requestId` 正确路由，不互相消费对方结果
- [x] 4.2.6 过期清理：超过 TTL 的 GrabEnvelope 在 consume 或下次 push 时被淘汰，不驻留内存
