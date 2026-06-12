# Phase-1 分阶段实施计划

本文件将 Phase-1 Foundation 拆分为 4 个子阶段，每个阶段有明确的聚焦目标和独立验收标准。**一次只实施一个子阶段**，完成并验证后再进入下一阶段，避免任务偏移和上下文切换成本。

---

## 子阶段 1.1: Scaffold & Rust Core Backend

**聚焦**：让 Tauri v2 + Rust 后端编译通过、数据库可初始化、错误处理链路就绪。不涉及任何前端 UI 工作。

**前置**：无（项目零代码状态）
**产出物**：可编译的 `cargo build`，`orbitx.db` 自动创建并完成迁移

### 1. 工程骨架初始化

- [x] 1.1 初始化 Tauri v2 + React + TypeScript 工程骨架（pnpm），包含标准 `src-tauri/` 和 `src/` 目录结构
- [x] 1.2 配置 `tauri.conf.json`：productName "OrbitX"，version "0.1.0"，identifier "com.orbitx.app"，window label "main" 1280×800 / min 1024×700，create false
- [x] 1.3 创建 `rust-toolchain.toml`：Rust stable ≥ 1.77，Tauri ≥ 2.5.0
- [x] 1.4 验证 `cargo build` 编译通过

### 2. Rust 模块树与依赖

- [x] 2.1 添加到 `Cargo.toml`：tauri v2 (features: tray-icon), rusqlite (bundled), rusqlite_migration, thiserror, serde + serde_json, uuid (v4), chrono, log + env_logger
- [x] 2.2 创建模块骨架：`errors.rs`, `db/mod.rs`, `db/migrations.rs`, `db/state.rs`, `commands/mod.rs`, `commands/greet.rs`, `commands/log.rs`, `tray/mod.rs`, `models/mod.rs`
- [x] 2.3 在 `lib.rs` 中声明并连接所有模块
- [x] 2.4 验证 `cargo build` 编译通过

### 3. 错误处理架构

- [x] 3.1 在 `errors.rs` 实现 `AppError` enum（thiserror derive）：Database, NotFound, InvalidState, Io
- [x] 3.2 实现 `SerializableError` enum（serde tagged union `#[serde(tag = "type", content = "message")]`）：Database, NotFound, InvalidState, Network
- [x] 3.3 实现 `From<AppError> for SerializableError` 转换
- [x] 3.4 定义 `CommandResult<T>` 类型别名
- [x] 3.5 验证序列化输出格式：`{"type":"Database","message":"..."}`

### 4. 数据库层

- [x] 4.1 实现 `db/state.rs`：`DbState` 结构体封装 `Mutex<Connection>`，通过 `app.manage()` 注册
- [x] 4.2 实现 `db/migrations.rs`：Phase-1 V1 迁移（CREATE TABLE app_kv + INSERT seed data: schema_version + ipc_status）
- [x] 4.3 在 Tauri `setup` 钩子中同步执行迁移，迁移后启用 `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON`
- [x] 4.4 实现 `db/mod.rs`：DAO 函数 — `get_kv(conn, key)` 和 `set_kv(conn, key, value)`
- [x] 4.5 验证：首次运行后 `orbitx.db` 文件存在于 app data 目录，app_kv 表有种子数据

### 子阶段 1.1 验收标准

```
cargo build              → 编译成功，零 warning（allow 级别除外）
首次运行                  → $APP_DATA_DIR/orbitx.db 创建
sqlite3 orbitx.db        → .tables 显示 app_kv
SELECT * FROM app_kv     → schema_version=1, ipc_status=ok
PRAGMA journal_mode      → wal
PRAGMA foreign_keys      → 1
序列化测试                → SerializableError JSON 格式正确
```

---

## 子阶段 1.2: Frontend UI Foundation

**聚焦**：完整的前端 UI 体系 —— 设计 Token、路由骨架、Header 组件、暗色模式。不涉及系统托盘、IPC 通信或平台检测。

**前置**：子阶段 1.1（Rust 后端可编译）
**产出物**：可导航的多页面 UI，设计 Token 正确渲染，Header 上下文感知

### 5. 前端依赖与设计 Token

- [x] 5.1 添加到 `package.json`：react-router-dom, @tauri-apps/api, lucide-react, clsx, tailwind-merge, tailwindcss@3, postcss, autoprefixer, tailwindcss-animate
- [x] 5.2 用 Shadcn UI CLI 初始化（`pnpm dlx shadcn@latest init`，style: default, base color: slate, CSS variables: yes）
- [x] 5.3 添加 Shadcn 组件：button, input, separator, dropdown-menu, sonner (toast)
- [x] 5.4 配置 `tailwind.config.ts`：扩展 `brand.slate`, `brand.dark`, `app.bg`, `app.surface`；`darkMode: "class"`；`tailwindcss-animate` 插件
- [x] 5.5 在 `globals.css` 中覆盖 Shadcn CSS 变量（`--primary`, `--background`, `--foreground` 等），添加 `.dark {}` 覆盖
- [x] 5.6 配置 `postcss.config.js`（tailwindcss + autoprefixer）和 `tsconfig.json`（strict, path aliases）
- [x] 5.7 验证：强调色 #64748B，背景 #F7F8FA，文本 #111827 正确渲染

### 6. 窗口壳与 Header 组件

- [x] 6.1 创建 `src/components/Header.tsx`：40px 固定高度（`h-10`），flex row 布局，平台感知 padding 通过 `data-platform` CSS 选择器
- [x] 6.2 实现 Header 内容逻辑：根路由 `/` 显示品牌名 "ORBITX"（无返回按钮）；子路由显示返回按钮（Lucide `ArrowLeft` 图标）+ 页面名称
- [x] 6.3 返回按钮行为：hover 亮灰色圆角背景（`rounded`），点击 `useNavigate(-1)` 或显式路由跳转
- [x] 6.4 验证：Header 高度精确 40px，各路由显示内容正确

### 7. React Router 与错误边界

- [x] 7.1 配置 React Router v7，使用 `HashRouter`（Tauri 兼容，无需服务端回退）
- [x] 7.2 创建 `src/components/ErrorBoundary.tsx`：React class component，catch 未捕获渲染异常，回退 UI 显示"应用遇到问题"+"请通过系统托盘退出并重启应用"，保留 Header
- [x] 7.3 创建 `src/routes/__root.tsx`：布局路由，Header (h-10) + ErrorBoundary 包裹 `<Outlet />`
- [x] 7.4 创建 `src/routes/dashboard.tsx`：`/` → Dashboard，"结构化提取器"卡片占位 + "全局设置"入口卡片
- [x] 7.5 创建 `src/routes/tools/structured-extractor.tsx`：`/tools/extractor` → 工具内页占位（左侧边栏 + 右侧内容区骨架）
- [x] 7.6 创建 `src/routes/settings.tsx`：`/settings` → 占位页面（"设置将在 Phase-2 实现"）
- [x] 7.7 验证：所有路由渲染正确，Header 内容随路由变化

### 8. 暗色模式基线

- [x] 8.1 在 `__root.tsx` 实现暗色模式切换：读取 `prefers-color-scheme`，为 `<html>` 添加/移除 `dark` class，将选择持久化到 localStorage
- [x] 8.2 验证：切换后所有 Shadcn 组件 + 自定义 CSS 变量在 `.dark` 块下的覆盖正确应用
- [x] 8.3 验证：文本保持 ≥4.5:1 对比度（设计 Token 已配置合规色彩值）

### 子阶段 1.2 验收标准

```
pnpm tauri dev            → 窗口打开，热重载工作
路由 /                     → Dashboard 渲染，Header 显示 "ORBITX"（无返回按钮）
路由 /tools/extractor      → 工具内页占位，Header 显示 "← 结构化提取器"
路由 /settings             → 设置页占位，Header 显示 "← 设置"
Header 高度                → computed height = 40px
强调色                     → #64748B (Cool Slate)
背景色                     → #F7F8FA (Warm Tinted Gray)
暗色模式切换               → 所有表面色变为深色，文本可读
无 console.error           → 浏览器控制台干净
```

---

## 子阶段 1.3: Platform Integration & System Shell

**聚焦**：平台检测注入、系统托盘、IPC 验证通路、前端→Rust 日志桥接。这是连接前后端的"胶水层"。

**前置**：子阶段 1.2（前端 UI 可用）+ 子阶段 1.1（Rust 后端可用）
**产出物**：带托盘菜单的可运行桌面应用，完整 IPC 通路，日志文件

### 9. 平台检测

- [x] 9.1 在 Tauri `setup` 钩子中用 `WebviewWindowBuilder::from_config()` 手动创建主窗口（`tauri.conf.json` 中 `create: false`）
- [x] 9.2 在 `initialization_script` 中注入 `document.documentElement.setAttribute('data-platform', '<OS>')`
- [x] 9.3 添加 CSS 规则：`html[data-platform="macos"] .header { padding-left: 80px }`，`html[data-platform="windows"] .header { padding-right: 120px }`
- [x] 9.4 验证：React 挂载前 `<html data-platform="macos">` 或 `<html data-platform="windows">` 已设置，无 FOUC

### 10. 系统托盘

- [x] 10.1 创建 `src-tauri/src/tray/mod.rs`：菜单构建函数，构建完整 7 项菜单（4 enabled + 1 separator + 2 enabled）
- [x] 10.2 定义 `TrayMenuRefs` 结构体（字段：silent_extract_item, current_task_item），注册到 Managed State
- [x] 10.3 实现托盘事件处理：点击"显示主窗口"显示/聚焦窗口；"关于 OrbitX"显示信息对话框；"退出"调用 `app.exit(0)`
- [x] 10.4 灰度禁用 Phase-2/Phase-5 项（`set_enabled(false)` for 全局设置, 静默提取, 当前任务）
- [x] 10.5 添加托盘图标资源（PNG, 32×32 最低）到 `src-tauri/icons/`
- [x] 10.6 验证：托盘图标可见，右键菜单完整，可用项工作正常，禁用项灰色

### 11. IPC 验证通路

- [x] 11.1 在 `commands/greet.rs` 实现 `check_ipc_status` Command：通过 DAO 读取 app_kv 中的 `ipc_status`，返回 `CommandResult<String>`
- [x] 11.2 在 `lib.rs` 中注册 `check_ipc_status` 到 invoke_handler
- [x] 11.3 在前端 Dashboard 中调用 `check_ipc_status`，显示 IPC 状态指示器
- [x] 11.4 验证：前端 invoke → Rust Command → DB query → JSON 响应 → 前端显示，完整闭环

### 12. 日志基础设施

- [x] 12.1 在 `lib.rs` 的 `setup` 钩子中初始化 `flexi_logger` 日志系统：默认 `info` 级别，输出到 stderr + 文件（`$APP_DATA_DIR/orbitx.log`），可用 `RUST_LOG` 覆盖，超过 5 MB 自动轮换，保留最近 3 个归档
- [x] 12.2 创建 `commands/log.rs`：`log_event` Command（level, target, message → log 宏分发，未知级别回退到 warn）
- [x] 12.3 创建 `src/lib/logger.ts`：`log(level, target, message)` → `invoke('log_event', ...)`。前端禁止直接使用 `console.log`
- [x] 12.4 连接生命周期日志：启动 (info)、迁移完成 (info)、窗口创建 (info)、托盘构建 (info)、退出 (info)
- [x] 12.5 实现优雅关闭：托盘"退出"处理中先 `PRAGMA wal_checkpoint(TRUNCATE)` 再 `app.exit(0)`
- [x] 12.6 验证：`orbitx.log` 文件包含启动/迁移/窗口/托盘生命周期事件，无用户数据泄露

### 子阶段 1.3 验收标准

```
data-platform 属性         → React 挂载前已注入 <html>，零 FOUC
macOS header padding       → padding-left: 80px
Windows header padding     → padding-right: 120px (visual check on Windows)
托盘图标                   → 系统托盘区域可见
托盘右键菜单               → 7 项完整菜单，"全局设置/静默提取/当前任务"灰色不可点击
"显示主窗口"               → 窗口弹出到前台
"关于 OrbitX"              → 信息对话框出现
"退出"                     → 进程终止，WAL 文件清理
check_ipc_status 调用       → Dashboard 显示 "IPC: ok"
orbitx.log                 → 存在，包含有序的生命周期事件
前端代码中                  → 零 console.log 调用（除 logger.ts 内部）
```

---

## 子阶段 1.4: Integration Verification

**聚焦**：端到端集成验证，确保所有子阶段产物正确协同工作。不做新功能，只验证和修复。

**前置**：子阶段 1.1 + 1.2 + 1.3 全部完成
**产出物**：验证通过的 Phase-1 完整应用

### 13. 编译与启动验证

- [x] 13.1 `pnpm tauri dev` 在 macOS 上无错误启动
- [x] 13.2 `pnpm tauri build` 产出可运行的调试二进制文件
- [x] 13.3 验证启动序列：DB 迁移 → 平台检测 → 窗口创建 → React 挂载 → Header 渲染 → Router 激活

### 14. 功能集成验证

- [x] 14.1 IPC 完整闭环：Dashboard 调用 `check_ipc_status` → 显示正确状态
- [x] 14.2 托盘 → "显示主窗口" 显示/聚焦窗口；"退出" 优雅终止（含 WAL checkpoint）
- [x] 14.3 暗色模式：light ↔ dark 切换，所有表面色正确，文本保持 ≥4.5:1 对比度
- [x] 14.4 错误处理：模拟 DB 错误，确认前端收到正确 `SerializableError` JSON

### 15. 质量检查

- [x] 15.1 浏览器控制台无 error、无未处理 promise rejection
- [x] 15.2 Rust 侧无 panic、无 unwrap 导致的崩溃
- [x] 15.3 空闲时无内存泄漏（观察 5 分钟，内存稳定）
- [x] 15.4 `orbitx.log` 包含预期生命周期事件，**无敏感数据**（用户内容、文件名、任务名等均不出现在日志中）

### 子阶段 1.4 验收标准

```
pnpm tauri dev             → 零错误启动
pnpm tauri build           → 产出可运行二进制
全功能检查列表              → 14 项全部通过
日志审计                   → 无用户数据泄露
控制台                     → 零 error / 零 panic
内存                       → 空闲时稳定不增长
```

---

## 阶段依赖关系图

```
子阶段 1.1 (Rust Core)
    │
    ├──→ 子阶段 1.2 (Frontend UI)
    │        │
    │        └──→ 子阶段 1.3 (Platform Integration) ──→ 子阶段 1.4 (Verification)
    │                  ↑                                    ↑
    └──────────────────┘                                    │
    (1.3 同时依赖 1.1+1.2)                                  │
    (1.4 依赖 1.1+1.2+1.3) ─────────────────────────────────┘
```

## 实施纪律

- **一次只做当前子阶段**：不要提前实现后续子阶段的内容
- **每完成一个 checkbox 就标记**：保持进度可追踪
- **子阶段完成后运行验收**：全部通过才进入下一子阶段
- **发现问题回退修**：在当前子阶段内修复，不带入下一阶段
- **不添加未要求的代码**：严格遵守 CLAUDE.md 第 2 条"简洁优先"
