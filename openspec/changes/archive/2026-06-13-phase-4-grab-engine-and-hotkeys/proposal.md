## Why

Phase 4 是 OrbitX "心流体验"的核心引擎。用户在任何应用中选中文本后，按下全局快捷键即可完成提取——全程不碰剪贴板。没有这一层，Phase 5 的数据提取管线无从谈起。此阶段与 Phase 2/3 并行推进，但必须在 Phase 5 之前完成。

## What Changes

- 新增 `tauri-plugin-global-shortcut` 依赖，注册两个全局快捷键（CmdOrCtrl+Shift+E 静默提取、CmdOrCtrl+Shift+Space 唤出命令面板）
- 新增 `GrabEngine` trait 与平台特定实现：macOS 通过 AXUIElement API (core-foundation + extern "C" 最小绑定)，Windows 通过 UIA (官方 windows crate)
- 新增悬浮窗 webview 窗口（无边框、居中、置顶、纯色卡片），预加载后 show/hide 切换，且不得在抓取前抢占焦点
- Rust 侧 `GrabState` 状态托管（`Mutex<VecDeque<GrabEnvelope>>`），按 `request_id` 消费抓取结果，避免跨窗口串读
- 系统托盘启用后台驻留模式（关闭主窗口后仍在运行），快捷键在任何应用前端均可响应
- 悬浮窗前端实现骨架态→内容态过渡（分段布局：命令输入框占位 + 文本预览区）

## Capabilities

### New Capabilities

- `grab-engine`: 跨平台系统级文本抓取引擎。定义统一的 GrabEngine trait，通过 macOS AXUIElement / Windows UIA 读取当前焦点应用的选中文本，映射为统一的 GrabError 业务语义。
- `global-shortcut`: 双全局快捷键体系（CmdOrCtrl+Shift+E 静默提取、CmdOrCtrl+Shift+Space 唤出面板）。Rust 侧动态注册，带 `Pressed` 过滤、去抖和退出注销。
- `floating-overlay`: 独立 webview 悬浮窗（无边框、居中、置顶、跳过任务栏、不可调整大小）。预加载机制保证毫秒级弹出，默认非激活显示；权限引导态期间抑制 blur auto-hide；Esc 关闭（React 前端监听）。
- `background-mode`: 系统托盘驻留与后台模式。关闭主窗口后应用仍在运行，全局快捷键保持响应，托盘图标持续可见。

### Modified Capabilities

- `system-tray`: 托盘菜单项"静默提取: 已就绪"和"当前任务: 无"从占位 disabled 状态变更为可动态更新的 managed state 项，反映快捷键注册状态。

## Impact

- `src-tauri/Cargo.toml`: 新增 `tauri-plugin-global-shortcut`、`core-foundation` (macOS)、`windows` crate (Windows，定位到 `Win32::UI::UIAutomation`) 依赖
- `src-tauri/tauri.conf.json`: 新增 overlay 窗口声明，插件配置段可能调整
- `src-tauri/capabilities/default.json`: 新增 overlay 窗口权限，global-shortcut 插件权限
- `src-tauri/src/lib.rs`: setup 阶段注册快捷键、初始化 overlay 窗口焦点监听、注入 GrabState、统一 shutdown 清理路径
- `src-tauri/src/grab/`: 新建模块，包含 `mod.rs` (GrabEngine trait + GrabError)、`macos.rs`、`windows.rs`、`state.rs`
- `src-tauri/src/commands/`: 新增 `consume_grabbed_result` command
- `src/routes/overlay.tsx`: 新建悬浮窗页面（分段布局：命令输入框占位 + 文本预览区）
- `src/App.tsx`: 新增 `/overlay` 路由，并从具备网络能力的 Provider 树中隔离
- 对已有功能的破坏性变更：无
