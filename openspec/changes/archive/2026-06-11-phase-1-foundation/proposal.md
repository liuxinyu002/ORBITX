## Why

OrbitX 项目处于零代码状态。在进入任何业务功能开发之前，必须先搭建一个稳固的工程骨架——确保 Tauri v2 + React 前后端通信、UI 框架、数据库层、窗口管理、系统托盘等基础设施全部就绪。这一阶段不追求业务功能，但必须为后续 6 个 Phase 提供可靠的"地基"。Phase-1 的每一个决策（数据库方案、错误处理架构、设计 Token 体系、窗口契约、路由结构）都将成为后续所有工作的刚性约束，返工成本极高，因此必须在编码前冻结全部技术契约。

## What Changes

- 初始化 Tauri v2 + React + TypeScript 工程骨架（pnpm 包管理）
- 集成 Shadcn UI + Tailwind CSS，建立完整的三层设计 Token 体系（CSS 变量 + Tailwind 扩展 + DESIGN.md 品牌别名）
- 搭建 Rust 侧 SQLite 数据访问层（rusqlite + rusqlite_migration + Tauri Managed State with WAL mode）
- 建立完整错误处理架构（thiserror → SerializableError DTO → CommandResult<T> 类型别名，禁止裸 Result<T, String>）
- 实现 React Router 嵌套路由骨架（__root → Dashboard / ToolInterior / Settings）
- 构建 40px 高度死锁的 Header 组件（Phase-1 品牌栏，原生标题栏，预留未来无缝切换到自定义标题栏）
- 实现系统托盘（完整菜单拓扑，本期不可用项灰度禁用，MenuItem 引用存入 Managed State）
- 实现跨平台检测（Rust setup hook → `data-platform` 属性注入，零依赖零 FOUS）
- 创建主窗口基础壳（1280×800 默认，1024×700 最小，decorations: true / transparent: false）
- 纳入暗色模式（Tailwind `dark:` class 策略，Phase-1 直接带上）
- 冻结全量数据模型 ER 图（SCHEMA.md），Phase-1 仅物理创建 `app_kv` 表
- 实现最小 IPC 验证通路（`check_ipc_status` command）
- 建立 TS → Rust 日志桥接（前端零 console.log，统一 log crate 输出，文件持久化，隐私字段过滤）
- 数据库优雅关闭（WAL checkpoint → app.exit）

## Capabilities

### New Capabilities
- `project-scaffold`: Tauri v2 + React + TypeScript 工程初始化，pnpm 包管理，构建与开发热重载
- `design-tokens`: 三层设计 Token 体系（globals.css CSS 变量 + tailwind.config.ts 扩展 + brand/app 别名），暗色模式，Flat-By-Default 组件规范，No-Pure Rule
- `database-layer`: Rust 侧 SQLite 数据访问层（rusqlite + rusqlite_migration 嵌入式迁移 + Tauri Managed State with WAL），Phase-1 物理创建 app_kv 表并种子数据
- `error-handling`: thiserror AppError → SerializableError DTO（tagged union）→ CommandResult<T> 的完整错误处理链路，TypeScript 侧 discriminated union 消费模式
- `window-shell`: 主窗口基础壳（1280×800/1024×700，decorations: true，40px Header 占位契约，平台自适应 padding）
- `system-tray`: 完整菜单拓扑（显示主窗口/全局设置/静默提取/当前任务/关于/退出），不可用项灰度禁用，MenuItem 引用挂载 Managed State
- `routing`: React Router 嵌套路由骨架（__root → Dashboard / ToolInterior / Settings），Header 承载导航与面包屑
- `platform-detection`: Rust setup hook 零依赖平台检测，`data-platform` 属性注入 `<html>`，前端 CSS 选择器消费
- `data-model`: 全量数据模型 ER 图冻结（SCHEMA.md），5 表设计，Phase-by-Phase 迁移计划
- `logging`: TS → Rust 日志桥接（前端零 console.log），`log + env_logger` 统一输出到控制台 + 文件，隐私字段过滤，生命周期事件追踪，数据库优雅关闭（WAL checkpoint）

### Modified Capabilities
- _(无——项目为零代码状态，无已有 capability 可修改)_

## Impact

- **新增文件**：完整 Rust crate 结构 (`src-tauri/src/`)、React 应用 (`src/`)、配置文件 (`Cargo.toml`, `package.json`, `tailwind.config.ts`, `tsconfig.json` 等)
- **新增依赖 (Rust)**：tauri ≥ 2.5.0, rusqlite (bundled), rusqlite_migration, thiserror, serde, serde_json, uuid (v4), chrono, log, env_logger
- **新增依赖 (Node)**：react, react-router-dom, @tauri-apps/api, tailwindcss@3, postcss, autoprefixer, tailwindcss-animate, shadcn/ui 组件集
- **数据库**：SQLite 文件首次创建（`$APP_DATA_DIR/orbitx.db`），WAL 模式启用，app_kv 表及种子数据
- **系统托盘**：托盘图标资源，右键菜单，窗口显示/隐藏交互
- **向后兼容**：无——项目为零代码状态，此为第一个工程提交
