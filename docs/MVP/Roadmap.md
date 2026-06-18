# 🗺️ OrbitX — 项目分期行动大纲 (Phased Action Outline)

> **蓝图依据**：`docs/PDR.md`（桌面端 AI 工具箱 MVP — 结构化数据提取器）
> **技术栈**：Tauri (Rust) + React + Shadcn UI + Tailwind CSS + SQLite + pi agent
> **目标平台**：Windows (UIA) & macOS (AXUIElement) 双端同步发布

---

## 阶段总览

| Phase | 主题 | 核心焦点 | 依赖 |
|-------|------|----------|------|
| [Phase-1](#phase-1) | 工程奠基与架构初始化 | 项目骨架、技术栈集成、窗口与托盘底座 | — |
| [Phase-2](#phase-2) | AI 模型配置与全局设置 | BYOK 多厂商接入、连接测试、配置持久化 | Phase-1 |
| [Phase-3](#phase-3) | 任务管理与 Schema 定义 | 任务 CRUD、AI 生成表头、可视化表单编辑器 | Phase-2 |
| [Phase-4](#phase-4) | 系统抓取引擎与全局快捷键 | 无障碍 API 文本提取、双快捷键体系、后台驻留 | Phase-1 |
| [Phase-5](#phase-5) | 数据提取管线与 AI 处理 | 命令面板、派发路由、相关性判定、护栏拦截 | Phase-2, Phase-3, Phase-4 |
| [Phase-6](#phase-6) | 数据网格、导出与工具箱大厅 | 分页数据表格、CSV/XLSX 导出、Dashboard | Phase-5 |
| [Phase-7](#phase-7) | 集成联调、打磨与双端发布 | 端到端测试、跨平台验证、性能与体验优化 | Phase-6 |

---

## Phase-1

- [x] **Phase-1 — 工程奠基与架构初始化**

  **Dependencies**: 无（项目起点）

  **Context**:
  项目处于零代码状态。需要先搭建一个稳固的工程骨架，确保 Tauri + React 前后端通信、UI 框架、数据库层、以及桌面窗口/托盘的基础设施全部就绪。这一阶段不追求任何业务功能，但必须为后续所有阶段提供可靠的"地基"——包括 Rust 侧的 Tauri 命令调度、React 侧的路由与组件规范、以及 SQLite 的数据访问层。

  **Core Objective**:
  完成项目初始化，建立可运行、可开发的桌面应用骨架，具备主窗口、系统托盘占位、以及前后端通信的基本通路。

  **Deliverables**:
  - Tauri + React + TypeScript 工程初始化（含构建与开发热重载）
  - Shadcn UI + Tailwind CSS 集成，确立基础设计 Token 与布局规范
  - Rust 侧 SQLite 集成（`tauri-plugin-sql` 或等效方案），完成数据库初始化与迁移机制
  - React Router 路由骨架（大厅 → 工具内页 的两级导航）
  - 主窗口基础壳（标题栏、最小尺寸约束）与系统托盘图标（含右键退出菜单）
  - Rust → Frontend 的 Tauri Command 最小可调通示例（如 `greet` → 确认 IPC 通路正常）

---

## Phase-2

- [x]  **Phase-2 — AI 模型配置与全局设置**

  **Dependencies**: Phase-1

  **Context**:
  用户在使用任何 AI 功能之前，必须先配置至少一个可用的模型端点。PRD 要求支持 BYOK 模式：内置 DeepSeek、智谱、OpenAI 三家厂商的快捷配置入口，同时提供"自定义 (OpenAI 兼容)"选项以支持本地 Ollama 等。此阶段的配置数据是 Phase-3（AI 生成 Schema）和 Phase-5（数据提取）的前置依赖。

  **Core Objective**:
  构建全局设置界面，实现多厂商 AI 模型配置的增删改查、连接可用性测试、以及配置的本地持久化。

  **Deliverables**:
  - 全局设置页面 UI（从系统托盘或大厅入口进入）
  - 厂商快捷配置卡片：DeepSeek / 智谱 / OpenAI（预填 API Base URL 与模型列表）
  - "自定义 (OpenAI 兼容)" 表单（自由填写 endpoint、model name、API key）
  - 模型连接测试功能（发送最小化请求并展示成功/失败与延迟）
  - 模型配置的 CRUD 与本地持久化（存入 SQLite）
  - 当前激活模型的选择与切换机制

---

## Phase-3

- [x]  **Phase-3 — 任务管理与 Schema 定义**

  **Dependencies**: Phase-2（AI 生成 Schema 需要可用的模型端点）

  **Context**:
  任务是数据提取的基本组织单元（如"简历库""价格表"）。每个任务需要定义一组结构化字段（Schema），用户既可以通过自然语言让 AI 自动生成初始表头，也可以通过可视化表单编辑器进行精细调整。这是连接"用户意图"与"AI 提取行为"的纽带——Phase-5 的数据提取管线将严格依赖此阶段产出的 Schema。

  **Core Objective**:
  实现任务的完整生命周期管理，以及 AI 辅助 + 人工微调相结合的 Schema 定义工作流。

  **Deliverables**:
  - 任务列表 UI（左侧栏），支持创建、重命名、删除、搜索
  - "AI 草稿生成"功能：用户输入自然语言描述 → 调用已配置模型 → 生成 JSON Schema
  - 可视化表单编辑器：对 Schema 字段进行增、删、改、重命名、类型调整（基于 Shadcn UI 表单组件）
  - Schema 的版本保存与回写（存入 SQLite）
  - 任务激活态管理（当前正在接收数据的任务，为 Phase-5 的静默提取做准备）

---

## Phase-4
 
- [x] **Phase-4 — 系统抓取引擎与全局快捷键** **windows 终端测试**

  **Dependencies**: Phase-1（需要 Tauri 后端与窗口管理基础设施）

  **Context**:
  这是整个产品"心流体验"的核心引擎。PRD 要求用户在任何应用中选中文本后，按下全局快捷键即可完成提取——全程不碰剪贴板。这需要 Rust 侧调用操作系统原生的无障碍 API（Windows: UIA, macOS: AXUIElement），并注册系统级全局热键。此阶段可与 Phase-2/Phase-3 并行推进（均为 Phase-1 的分支），但必须在 Phase-5 之前完成。

  **Core Objective**:
  实现跨平台的"选中文本无痕抓取"能力与双全局快捷键体系，确保应用在后台静默驻留时能够响应热键并完成文本提取。

  **Deliverables**:
  - 系统托盘驻留与后台模式（关闭主窗口后仍在运行）
  - 全局快捷键注册（Rust 侧，macOS 使用 `CGEvent`/`HotKey`，Windows 使用 `RegisterHotKey`）
    - 快捷键 A：静默提取（派发给当前激活任务）
    - 快捷键 B：唤起命令面板（弹出居中悬浮窗）
  - **macOS**：通过 AXUIElement API 读取当前焦点应用中的选中文本
  - **Windows**：通过 UIA (UI Automation) 读取当前焦点控件中的选中文本
  - 降级策略：API 读取失败时直接放弃并 Toast 提示，不使用剪贴板兜底
  - 悬浮窗基础壳（无边框、居中、类似 Spotlight，为 Phase-5 的命令面板 UI 做准备）

---

## Phase-5

- [x] **Phase-5 — 数据提取管线与 AI 处理**

  **Dependencies**: Phase-2（模型端点）, Phase-3（任务 Schema）, Phase-4（文本抓取能力）

  **Context**:
  这是 MVP 的核心业务链路——将 Phase-4 捕获的文本通过 Phase-3 定义的任务 Schema，交由 Phase-2 配置的 AI 模型进行结构化提取。PRD 在此阶段设定了两个关键的品质防线：(1) 大文本硬阻断（派发时检测，超 2000-3000 字直接拒绝）；(2) 智能相关性降级（强制 AI 返回 `is_relevant` 字段，不相关时自动打断静默模式、弹出预览卡片交由用户人工确认）。

  **Core Objective**:
  打通"抓取 → 派发 → AI 提取 → 相关性判定 → 入库/打断"的完整数据链路。

  **Deliverables**:
  - 命令面板悬浮窗 UI（搜索任务 + 选中文本预览 + 派发确认）
  - 文本派发路由逻辑（快捷键 A → 激活任务静默派发 / 快捷键 B → 面板选择派发）
  - AI 提取 Prompt 工程：将选中文本 + 任务 Schema 组装为结构化提取请求
  - 大文本硬阻断（派发时计算字符数，超阈值直接拦截 + Toast 提示）
  - `is_relevant` 判定逻辑：
    - 相关 → 静默入库 + Toast "已提取"
    - 不相关/失败 → 弹出预览卡片，交由用户人工确认（丢弃 or 强制入库）
  - 提取结果写入 SQLite（关联任务 ID、原始文本、提取字段、时间戳）

---

## Phase-6

- [x] **Phase-6 — 数据网格、导出与工具箱大厅**

  **Dependencies**: Phase-5（数据需要先存在）

  **Context**:
  数据已经进入 SQLite，现在需要让用户能够浏览、管理并消费这些数据。PRD 要求采用传统分页模式（每页 50 条，后端物理分页），确保万级数据下 React 渲染流畅。同时提供 CSV/XLSX 静态导出，让数据融入用户的其他办公流。最后，补全工具箱大厅 Dashboard——展示已安装的工具并作为全局导航入口。

  **Core Objective**:
  构建高效的数据浏览与管理界面，实现数据导出能力，并完成工具箱大厅的 Dashboard 布局。

  **Deliverables**:
  - 数据网格组件（基于 Shadcn UI Table）：
    - 动态列映射（根据任务 Schema 自适应表头）
    - 后端物理分页（SQLite `LIMIT/OFFSET`，每页 50 条）
    - 行内查看、删除
  - CSV 导出功能（Rust 侧生成文件 → 系统保存对话框）
  - XLSX 导出功能（同上）
  - 工具箱大厅 Dashboard：
    - 网格布局展示已安装工具（当前为首发工具"结构化提取器"）
    - 点击工具卡片进入对应工具内页
    - 全局设置入口

---

## Phase-7

- [ ] **Phase-7 — 集成联调、打磨与双端发布**

  **Dependencies**: Phase-6（全功能链路已完成）

  **Context**:
  所有功能模块已就绪，但"能用"和"好用"之间存在一段需要精心打磨的距离。此阶段聚焦于端到端集成测试、跨平台一致性验证、异常路径覆盖、性能调优以及 UI/UX 细节打磨。PRD 要求的"孤岛模式"（零网络依赖的安全感）需要在此阶段得到最终验证与加固。

  **Core Objective**:
  完成全链路集成调试，确保 Windows 与 macOS 双端体验一致、稳定、流畅，达到可发布的 MVP 品质标准。

  **Deliverables**:
  - 端到端工作流测试覆盖：
    - 模型配置 → 创建任务 → 快捷键抓取 → AI 提取 → 数据入库 → 浏览导出
  - 异常路径与边界测试（无网络、模型超时、超长文本、特殊字符、空文本等）
  - Windows 与 macOS 双端一致性验证（UIA vs AXUIElement 行为差异对齐）
  - 性能优化（大型数据集分页流畅度、Rust→React IPC 响应时间、内存占用）
  - UI/UX 打磨（动画过渡、Toast 反馈、键盘导航、无障碍体验）
  - 应用打包与签名（Tauri build → `.dmg` / `.msi` 安装包）
  - "孤岛模式"最终确认：无网络请求（除用户主动配置的模型调用外）、无遥测、无后台更新检查

---

> **📌 说明**：以上每个 Phase 均为高层级里程碑。各 Phase 内部的详细实施子任务（包括具体文件拆分、组件树、Rust 模块结构、API 契约等）将在进入该 Phase 时逐期深入规划。

