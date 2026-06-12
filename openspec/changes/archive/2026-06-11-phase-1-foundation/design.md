## Context

OrbitX 项目零代码起跑。Phase-1 的目标是搭建可运行、可开发的桌面应用骨架——Tauri v2 (Rust) + React + TypeScript + Shadcn UI + Tailwind CSS 的前后端通信通路。项目文档（PDR.md, PRODUCT.md, DESIGN.md, Roadmap.md, SCHEMA.md）已冻结，所有技术决策已在前序 explore 会话中收敛完毕。本设计文档记录这些决策及其理由。

**约束**：
- 隐私优先，完全孤岛模式（无账号、无云存储、无遥测）
- 目标平台：macOS (AXUIElement) + Windows (UIA) 双端同步
- 技术栈：Tauri v2 + React + TypeScript + Shadcn UI + Tailwind CSS + SQLite
- 包管理器：pnpm

## Goals / Non-Goals

**Goals:**
- 建立可编译、可热重载的开发环境（Tauri v2 + React + TypeScript）
- 搭建三层设计 Token 体系（CSS 变量 → Tailwind 扩展 → brand/app 别名），包含暗色模式
- 建立 Rust 侧 SQLite 数据访问层（rusqlite + rusqlite_migration + WAL + Managed State）
- 固化完整错误处理架构（AppError → SerializableError → CommandResult<T>）
- 构建 40px 高度死锁 Header + 嵌套路由骨架
- 实现完整托盘菜单拓扑（当前不可用项灰度禁用，MenuItem 引用存入 Managed State）
- 实现零依赖跨平台检测（`data-platform` 属性注入）
- 建立主窗口基础壳（1280×800, 1024×700 最小，原生标题栏）
- 冻结全量 ER 图（SCHEMA.md），Phase-1 仅创建 app_kv 表

**Non-Goals:**
- 自定义标题栏（Phase-1 保留原生标题栏 `decorations: true`）
- 任何业务功能（AI 模型配置、任务管理、数据提取等均为后续 Phase）
- 跨平台无障碍 API 文本抓取（Phase-4）
- 加密存储（api_key 明文存储，SQLite 不做二进制混淆）
- 窗口透明/毛玻璃效果（Phase-1 `transparent: false`，项目规范禁止玻璃态）

## Decisions

### D1: Tauri v2（非 v1）

**理由**：v2 是当前稳定主版本，提供更好的 IPC 性能、插件系统和移动端前瞻。v1 已进入维护模式。新项目直接采用 v2，避免未来迁移成本。

**替代方案**：Tauri v1 — 因已进入维护期且插件生态停止增长而否决。

---

### D2: Rust DAO 封装（rusqlite + 自定义 Tauri Command，不用 tauri-plugin-sql）

**理由**：
- `tauri-plugin-sql` 将 SQL 暴露到前端，违反"后端负责数据访问"的分层原则
- 自定义 Command + DAO 模式提供编译期类型检查，前端只消费 `CommandResult<T>` 的序列化 JSON
- 未来复杂查询（如多表联查、聚合统计）在 Rust 侧实现更安全

**替代方案**：`tauri-plugin-sql` — 因前端直接写 SQL 的安全风险和架构分层问题而否决。

---

### D3: rusqlite_migration 嵌入式迁移（方案 B）

**理由**：
- 迁移 SQL 直接嵌入 Rust 宏，编译为单一二进制，无外部 SQL 文件依赖
- 迁移在编译期检查语法，运行时不可变
- 与 Phase-by-Phase 迁移计划完美对应（每个 Phase 追加一个迁移闭包）

**替代方案**：
- 方案 A（外部 SQL 文件 + `include_str!`）：管理分散，运行时路径依赖多
- 方案 C（Diesel/SeaORM）：对 MVP 过度抽象，SQLite 方言支持有限

**具体用法**：
```rust
use rusqlite_migration::{Migrations, M};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up("CREATE TABLE app_kv(...); INSERT INTO app_kv ..."),
        // Phase-2, Phase-3... 按 Phase 追加
    ])
}
```

---

### D4: Tauri Managed State with SQLite WAL（方案 A 增强版）

**理由**：
- `app.manage(AppState { db: Mutex<Connection> })` 将数据库连接注入所有 Command
- WAL 模式允许并发读，大幅减少 Mutex 锁竞争
- `rusqlite::Connection` 非 `Send + Sync`，Mutex 包装是 Rust 侧最安全的共享方案

**替代方案**：
- 方案 B（全局 static）：需要 unsafe，违背 Rust 安全原则
- 方案 C（连接池）：SQLite 作为本地嵌入式数据库，连接池过度抽象，WAL 模式已足够

**WAL 激活**：在 Migration 执行后立即 `PRAGMA journal_mode=WAL;`

---

### D5: 迁移触发时机——Tauri setup hook 同步阻塞（方案 A）

**理由**：
- 数据库必须在任何窗口创建前就绪，避免前端首次渲染时访问未迁移的数据库
- 同步阻塞确保迁移完成前不处理任何 IPC 请求
- setup hook 是 Tauri 官方推荐的生命周期入口

**替代方案**：
- 方案 B（懒初始化）：首次 Command 调用时触发迁移——风险在于首次请求延迟不可预测
- 方案 C（后台异步）：引入复杂状态管理（数据库未就绪时的占位 UI）

---

### D6: Schema 策略——Phase-1 仅 app_kv，全量 ER 图前瞻冻结（方案 C）

**理由**：
- Phase-1 无业务功能，仅需 `app_kv` 表验证 IPC 通路和迁移机制
- 但数据模型设计影响所有 Phase 的表结构、外键约束和索引策略，必须前瞻冻结
- SCHEMA.md 作为权威定义，后续 Phase 的迁移严格按 SCHEMA.md 执行

**替代方案**：
- 方案 A（每 Phase 新建表）：缺乏全局视角，可能导致跨 Phase 重构外键
- 方案 B（Phase-1 建全量表）：引入未用表，增加维护负担

---

### D7: api_key 明文存储

**理由**：
- 孤岛模式：数据库文件在用户本地，攻击面仅限于物理访问
- 二进制混淆增加维护成本，且在 Rust 二进制反编译面前作用有限
- 用户可自行使用全盘加密（FileVault/BitLocker）保护数据

**替代方案**：AES 加密存储 — 密钥管理复杂（密钥存哪？），对本地攻击面加成有限。

---

### D8: schema_fields 独立表（非 JSON Blob）

**理由**：
- 独立表支持字段级 CRUD 操作（增删改重命名）
- 支持 `sort_order` 排序、`UNIQUE(task_id, field_name)` 约束、类型校验 `CHECK(field_type IN (...))`
- 数据网格动态列映射需要查询字段元数据，独立表比 JSON 解析更高效

**替代方案**：JSON blob 存储在 tasks 表 — 字段级操作需完整解析/序列化，失去数据库层面的类型约束。

---

### D9: 错误处理架构（绑定标准）

**决策**：三层错误桥接架构，禁止裸 `Result<T, String>` 出现在任何 Command 中。

```
Rust: AppError (thiserror) → SerializableError (tagged union) → CommandResult<T>
                                    ↓ JSON 序列化
TypeScript: { type: "Database"|"NotFound"|"InvalidState"|"Network", message: string }
                                    ↓ discriminated union 消费
```

**替代方案**：`Result<T, String>` 直接传错误文本 — 前端无法区分错误类型，无法做分类处理。

---

### D10: 设计 Token 三层体系

**架构**：
```
Layer 1: globals.css       → CSS 自定义属性 (Shadcn 标准变量 + 品牌色 HSL 覆盖)
Layer 2: tailwind.config.ts → Tailwind 扩展 (标准语义 Token + brand.slate/dark + app.bg/surface)
Layer 3: React 组件规范     → DESIGN.md 行为约束 (Flat-By-Default, 5% Rule, No-Pure Rule)
```

**关键 Token 映射**：
| CSS 变量 | 值 | Tailwind 扩展 | 用途 |
|----------|-----|---------------|------|
| `--brand-slate` | `#64748B` (HSL 215 16% 47%) | `brand.slate` | 唯一强调色 |
| `--brand-dark` | `#111827` (HSL 224 71% 4%) | `brand.dark` | 主文本色 |
| `--app-bg` | `#F7F8FA` (HSL 240 14% 97%) | `app.bg` | 应用背景 |
| `--app-surface` | `#FFFFFF` | `app.surface` | 卡片/浮层表面 |

**替代方案**：纯 Shadcn 默认变量 — 无法体现 DESIGN.md 的精确色彩规范（No-Pure Rule, Warm Tinted Gray）。

---

### D11: 主窗口契约

**配置**：
```json
{ "width": 1280, "height": 800, "minWidth": 1024, "minHeight": 700,
  "decorations": true, "transparent": false, "center": true }
```

**关键决策**：Phase-1 保留原生标题栏 (`decorations: true`)，但前端顶栏死锁 40px (`h-10`)。未来 Phase 切换 `decorations: false` + `data-tauri-drag-region` + 自定义窗口控制按钮时，下方布局零变化。

**替代方案**：Phase-1 即做自定义标题栏 — 增加窗口控制逻辑复杂度，阻塞核心通路验证。

---

### D12: 系统托盘架构

**决策**：Phase-1 建立完整菜单拓扑，未来功能灰度禁用。

```
● 显示主窗口          (Phase-1 enabled)
○ 全局设置            (Phase-2 disabled)
○ 静默提取: 已就绪    (Phase-5 disabled)
○ 当前任务: 无        (Phase-5 disabled)
---                    (分隔线)
● 关于 OrbitX         (Phase-1 enabled)
● 退出                (Phase-1 enabled)
```

**动态更新机制**：需要运行时更新的 MenuItem（如"当前任务: xxx"）通过 `MenuItem` 引用存入 `TrayMenuRefs` Managed State，直接调用 `.set_text()` 更新，不使用全局事件总线。

**替代方案**：
- 方案 B（当前 Phase 的增量菜单）：每次新增功能需要修改 Rust 菜单构建代码
- 方案 C（事件总线）：增加不必要的抽象层

---

### D13: React Router 嵌套目录树（方案 B）

**结构**：
```
src/routes/__root.tsx      ← Header (h-10) + <Outlet />
src/routes/dashboard.tsx    ← / 路由 → 工具箱大厅
src/routes/tools/
  structured-extractor.tsx  ← /tools/extractor 路由 → 工具内页
src/routes/settings.tsx     ← /settings 路由 → 全局设置（Phase-2 实现）
```

**Header 行为契约**：
- `/` 路由：无返回按钮，标题 "ORBITX"
- 子路由：有返回按钮（← Lobby，hover: rounded bg-gray-100），标题 = 目标页面名
- macOS: `pl-[80px]`（红绿灯占位），Windows: `pr-[120px]`（控制键占位），通过 `data-platform` CSS 选择器切换

**替代方案**：方案 A（扁平路由）— 无嵌套，每个路由独立渲染，代码复用度低。

---

### D14: 平台检测——方案 C（`std::env::consts::OS` + `initialization_script` + `data-platform`）

**理由**：
- Rust `std::env::consts::OS` 返回编译目标平台，零运行时开销、零外部依赖
- `WebviewWindowBuilder::initialization_script()`（Tauri ≥ 2.5.0）在窗口创建的 earliest 阶段注入 `data-platform` 属性到 `<html>`，早于任何前端 JS 执行
- 绝对零 FOUC（Flash of Unstyled Content）——属性在 DOM 构建前已就位
- 窗口在 setup hook 中通过 `WebviewWindowBuilder::from_config()` 手动创建（`tauri.conf.json` 窗口配置设 `create: false`）

**替代方案**：
- 方案 A（`navigator.platform`）：仅前端，运行时检测，无法区分 Windows 11 vs Windows 10 等细节
- 方案 B（`webview.eval()` in setup hook）：Tauri v2 文档对 setup hook 中 window 是否已创建存在矛盾描述，有 panic 风险
- 方案 D（`tauri::api::process`）：引入 Tauri API 依赖，功能等价于 `std::env`

---

### D15: 暗色模式策略（Tailwind v3 `darkMode: "class"`）

**决策**：Phase-1 直接纳入，通过 Tailwind v3 的 `dark:` class 策略实现。`tailwind.config.ts` 中配置 `darkMode: "class"`，CSS 变量在 `.dark` 选择器下切换。Phase-1 默认跟随系统 `prefers-color-scheme`，option 持久化到 `app_kv`（key: `"theme_mode"`，值: `"system" | "light" | "dark"`，Phase-1 仅实现 system/light/dark 三态基本切换）。未来 Phase 支持手动覆盖。

**替代方案**：后续 Phase 再加 — 边际成本远高于 Phase-1 带上（后期全量样式重构）。

---

### D16: 包管理——pnpm

**理由**：磁盘空间高效（硬链接），安装速度快，锁文件稳定。与 Tauri v2 和 Vite 的兼容性经过验证。

---

### D17: 技术栈版本约束

**决策**：

| 组件 | 版本要求 | 理由 |
|------|---------|------|
| Tailwind CSS | **v3**（非 v4） | Shadcn UI 文档最完整兼容 v3；`tailwind.config.ts` + `darkMode: "class"` 是 v3 标准方案；v4 使用 CSS-based config 不支持 `tailwind.config.ts` |
| Tauri | **≥ 2.5.0** | `WebviewWindowBuilder::initialization_script()` 在此版本引入，用于零 FOUC 注入 `data-platform` |
| Shadcn UI | latest（兼容 v3） | 使用 `pnpm dlx shadcn@latest init`，对 Tailwind v3 项目保持向后兼容 |
| Node.js | ≥ 18 | Tauri v2 + Vite 的最低要求 |
| Rust | stable ≥ 1.77 | Tauri v2 的最低要求；通过 `rust-toolchain.toml` 固定 |

**替代方案**：Tailwind v4 — 因 Shadcn UI 在 v4 下的文档覆盖不如 v3 完整、生态插件（如 `tailwindcss-animate`）迁移路径不明，Phase-1 选 v3 更稳妥。后续可单独升级。

---

### D18: 日志架构——TS → Rust 桥接，前端零控制台输出

**决策**：前端不直接调用 `console.log`。所有日志（含前端业务日志和错误信息）通过 Tauri Command 发送到 Rust 侧，由 `log` crate 统一处理输出。

**架构**：
```
TypeScript: log(level, target, message)
    ↓ invoke('log_event', { level, target, message })
Rust Command: fn log_event(level, target, message) -> CommandResult<()>
    ↓ log::info!/warn!/error! 宏
Rust 侧: env_logger → 控制台 + 文件 ($APP_DATA_DIR/orbitx.log)
```

**理由**：
- 统一日志出口：所有日志在一个位置，用户反馈问题时只需提供一个日志文件
- 隐私可控：Rust 侧可在写入前过滤敏感字段，前端无法绕过
- 桌面应用无浏览器 devtools，`console.log` 在生产环境不可见
- Tauri webview 的 console 输出不持久化，应用重启即丢失

**日志级别定义**：

| 级别 | 语义 | 典型场景 |
|------|------|---------|
| `error` | 影响功能使用的故障 | 迁移失败、DB 连接丢失、IPC 命令 panic |
| `warn` | 非预期但可恢复的状态 | Mutex 锁等待 >100ms、配置缺失回退默认值 |
| `info` | 关键生命周期事件 | 应用启动/退出、迁移完成、窗口创建、DB 路径 |
| `debug` | 开发诊断信息 | IPC 请求/响应摘要、DB 查询耗时（仅 dev 模式） |

**隐私约束**（孤岛模式强制）：
- 日志 SHALL NOT 记录任何用户数据内容（提取文本、字段值、文件名）
- 日志 SHALL NOT 记录窗口标题、任务名等可能推断用户行为的信息
- 日志仅限于系统级事件和错误堆栈

**前端桥接接口**：

```typescript
// src/lib/logger.ts
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

async function log(level: LogLevel, target: string, message: string): Promise<void> {
  await invoke('log_event', { level, target, message });
}
```

**替代方案**：
- 方案 A（前端直接 console.log）：桌面环境不可见、不持久化，否决
- 方案 B（`tracing` 框架）：功能过强，Phase-1 无异步 span 追踪需求，`log + env_logger` 足够

---

### D19: React Error Boundary——渲染崩溃保护

**决策**：在 `__root.tsx` 中通过 React Error Boundary 包裹 `<Outlet />`。当子组件树发生未捕获渲染异常时，捕获错误并显示简洁回退 UI，避免 Tauri webview 白屏。

**回退 UI 要求**：
- 居中显示标题 "应用遇到问题" 和描述文字 "请通过系统托盘退出并重启应用"
- 保留 Header（`h-10`），确保托盘菜单始终可用
- 不显示错误详情（Phase-1 不做错误报告 UI）

**理由**：
- 桌面 webview 没有浏览器的刷新按钮，React 崩溃 = 白屏死锁
- 托盘菜单独立于 React 组件树，在 Rust 侧运行，不受 React 崩溃影响
- Error Boundary 不防止崩溃，但保证用户有退出路径

**替代方案**：不做 Error Boundary — React 崩溃后用户面对白屏只能通过系统任务管理器杀进程，体验不可接受。

## Risks / Trade-offs

- **[原生标题栏 → 自定义标题栏切换]** → 通过 40px 高度契约解耦。风险：原生标题栏在不同 OS/版本下的精确高度可能有细微差异（macOS ~28px, Windows ~32px），窗口内容区域计算需在 setup 时动态获取。缓解：Phase-1 接受原生标题栏高度，不做绝对像素级精确的视觉对齐。

- **[`initialization_script` 依赖 Tauri ≥ 2.5.0]** → `WebviewWindowBuilder::initialization_script()` 是 v2.5.0 引入的较新 API。风险：若 CI/开发环境安装了较低版本的 Tauri CLI，编译可能失败。缓解：在 `Cargo.toml` 和 `rust-toolchain.toml` 中明确版本约束，`tauri-cli` 锁定 ≥ 2.5.0。

- **[Mutex 锁竞争]** → WAL 模式下读操作不阻塞，写操作短暂锁定。Phase-1 仅 IPC 验证的单次写操作，无竞争风险。未来 Phase 高频提取时，若出现瓶颈，可引入 `r2d2-sqlite` 连接池。当前 Mutex 足以应对。

- **[rusqlite_migration 的不可变性]** → 迁移一旦编译，不可运行时修改。这意味着数据库损坏后只能重建，无自动修复。缓解：app_kv 的 `schema_version` 键作为运行时检查点，迁移前验证版本号一致。

- **[SQLite 外键约束默认关闭]** → SQLite 默认不执行外键约束，即使 SCHEMA.md 定义了 `ON DELETE CASCADE`。缓解：迁移后在每个连接上执行 `PRAGMA foreign_keys = ON`，与 `PRAGMA journal_mode=WAL` 一同设置。此 PRAGMA 是 per-connection 的，必须在 `DbState` 初始化时配置。

- **[CSP null 的安全影响]** → Phase-1 为快速调试设置 `csp: null`，允许任意资源加载。生产发布前必须收敛 CSP 策略。

- **[api_key 明文存储]** → 物理访问或恶意软件可读取数据库。缓解：文档向用户明确说明，建议启用全盘加密。未来可选提供操作系统密钥链集成。

## Open Questions

1. **托盘图标**：需要 16×16 和 32×32 的 PNG 图标资源（macOS 模板图标 @2x），是否由设计提供还是先使用 Tauri 默认图标？
2. **构建目标最低 OS 版本**：macOS 最低支持哪个版本（10.15+?），Windows 最低支持哪个版本（10? 11?）？
3. **托盘图标 Linux 支持**：Linux 各发行版的托盘区域图标尺寸规范不统一（16×16 到 24×24），当前 Phase-1 仅需 macOS/Windows 双端资产。
