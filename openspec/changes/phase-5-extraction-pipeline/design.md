## Context

Phase 1-4 已完成：项目骨架、AI 模型配置、任务 Schema 管理、系统文本抓取引擎。当前状态是"能抓到文本但无处消费"——抓取结果被暂存在 Rust 侧队列（`GrabState`）中供前端消费，消费后只做 Toast 提示。

Phase 5 需要将这些文本通过 AI 模型转化为结构化数据并持久化，建立两条明确的派发链路：
- **快捷键 A（静默派发）**：后台处理，不打扰用户心流
- **快捷键 B（面板派发）**：唤起悬浮窗，用户确认后派发

### 约束

- 主窗口是唯一的 AI 调用和数据库操作入口（持有 `AgentProvider`）
- 悬浮窗是纯视图层，不挂载 `AgentProvider`，不持有密钥
- 所有 AI 调用在前端（TypeScript），延续 Phase 2/3 的 `pi-ai` 模式
- Phase 4 的截断阈值复用（`MAX_RAW_CHARS=10000`, `MAX_GRAB_TOKENS=2000`）
- 零重试策略，所有错误采用 Fail Fast
- **UI 约束遵循项目 [DESIGN.md](../../../DESIGN.md)**：Cool Slate accent ≤5% 覆盖、所有交互元素覆盖 default/hover/focus/active/disabled 态、骨架屏优先于独立 spinner、禁止 `console.log`（前端日志通过 `log()` 桥接至 Rust 后端）
- **悬浮窗色彩约束**：主卡片 `#FFFFFF`，底层承载区 `#F7F8FA`，常规文字 `#111827`（暗色模式对应反转），保持高信息密度
- **交互范式约束**：降级模式下的"任务重新选择"与"强制入库"操作仅限在下拉列表（Dropdown）内平滑流转（含 fade-out 动画），严禁在此视图链路挂载全局弹窗（Modal）

## Goals / Non-Goals

**Goals:**
- 打通"抓取 → 派发 → AI 提取 → 相关性判定 → 入库/打断"完整链路
- 主窗口后台常驻处理所有 AI 调用和 DB 操作，悬浮窗保持无状态视图
- `is_relevant` 相关性子判定与降级打断机制
- 硬阻断（复用 Phase 4 截断）和零重试错误处理
- 废弃遗留的队列暂存模式（`GrabState` 等）

**Non-Goals:**
- 不引入任务队列/防抖/并发控制（MVP 允许并发提取）
- 不引入新的动画依赖（使用 Tailwind CSS）
- 不引入重试机制
- 不改变 Phase 4 的截断阈值
- 不新增外部依赖

## Decisions

### 1. 事件驱动架构替代队列暂存

**决策**：删除 `GrabState` 队列、`grab-completed` 事件、`consume_grabbed_result` 命令。改为 Rust 侧直接通过 `emit_to` 向指定窗口发射事件。

**保留 `OverlayPermissionState`**：`OverlayPermissionState`（`AtomicBool`）结构体保留在 `grab/mod.rs` 中，继续通过 `app.manage()` 托管。但删除 `set_overlay_permission_state` Tauri command——权限态改由 `show_overlay_core` 内部根据 payload tag 自动设置：当 payload tag 为 `"permission-required"` 时设为 `true`（抑制 blur-auto-hide），其他 tag 设为 `false`。

**理由**：队列暂存模式为多窗口并发消费设计，但 Phase 5 明确了每条链路只有一个消费窗口（静默→主窗口，面板→悬浮窗）。直接事件推送消除了队列 TTL、容量限制、消费竞态等复杂性。

**替代方案**：保留队列并改为单窗口出队——仍有多余的中间层，不如直接推送。

### 2. 三条专用事件通道

**决策**：定义三条不可互换的事件通道，每条携带专属 payload：

| 事件 | 方向 | Payload | 用途 |
|------|------|---------|------|
| `task:silent-extract` | Rust→主窗口 | `{text, truncated}` | 静默提取 |
| `view:render-overlay` | Rust→悬浮窗 | `{text, truncated, fallback?}` | 悬浮窗渲染 |
| `task:manual-extract` | 悬浮窗→主窗口 | `{text, taskId, force?, truncated?}` | 面板确认派发 |

**理由**：事件语义精确对应链路意图，避免单一通用事件带来的类型模糊和条件分支。

### 3. 前端 AI 调用架构：独立管线函数 + 无头组件

**决策**：
- `src/agent/pipeline.ts`：纯异步函数 `runExtraction()`，禁 React hooks/context，依赖通过参数注入
- `src/components/ExtractionListener.tsx`：无头组件，挂载在 `AgentProvider` 内部，负责监听事件、从 Context 提取状态、调用管线函数

**理由**：管线逻辑与 React 生命周期解耦，便于测试和复用。无头组件充当最小化的桥梁层。

### 4. Prompt 工程：单次调用 + 字段顺序控制

**决策**：单次 API 调用同时完成相关性判定和字段提取。输出结构强制 `is_relevant` → `reason` → `data` 的顺序，利用自回归特性让模型先判定再提取。

Temperature 全程锁定 0.0-0.1。

**复用 `parseAIResponse`**：现有 `src/agent/extractor.ts` 中的 `parseAIResponse()` 函数用于解析模型返回的 JSON。其当前返回类型为 `{ fields: unknown[] } | null`（面向 Phase 3 Schema 解析）。Phase 5 将其返回类型泛化为 `Record<string, unknown> | null`，使同一函数既能解析 Schema 响应也能解析提取响应（`{ is_relevant, reason, data }`）。

**理由**：单次调用省延迟和成本；字段顺序利用因果注意力机制——先输出的 token 影响后续 token，先输出 `is_relevant: false` 会引导模型放弃编造字段值。

### 5. `force` 分支使用独立 System Prompt

**决策**：当 `force: true` 时，不使用判定型 Prompt，改用强制提取 Prompt（去掉 `is_relevant` 和 `reason`，替换为强硬提取语气）。模型输出纯 `data` 对象而非包装结构。

**理由**：`force` 的语义是"用户已验证相关性"，再让模型判定会浪费 token 且可能产生矛盾结果（用户说相关但模型说不相关）。

### 6. `show_overlay` 通用调度函数

**决策**：Rust 侧抽象一个核心 `show_overlay(payload)` 函数。快捷键 B 在 Rust 内部直接调用，前端降级时通过 `invoke('show_overlay', { payload })` 调用。

**理由**：同一条唤起路径、同一种 Payload 结构、同一组窗口操作（存在性检查 → show → set_focus → emit 渲染事件）。前端视角只看到一个 command。

### 7. 存储模型：单表 JSON 列

**决策**：

```sql
CREATE TABLE extractions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_extractions_task_time ON extractions(task_id, created_at);
```

`result_json` 存储去除 `is_relevant`/`reason` 后的纯净 `data` 对象。`insert_extraction` 返回新记录 ID（`Result<String>`）。

**理由**：单表单行 = 最小阻抗匹配（AI 输出 JSON → 直接入库）。SQLite 内建 JSON 函数可支撑未来按字段查询。联合索引覆盖 Phase 6 的分页查询。

### 8. 悬浮窗乐观 UI 关闭

**决策**：悬浮窗 emit `task:manual-extract` 后立即 fade-out + hide()，不等待主窗口处理结果。主窗口通过全局 Toast 反馈成功/失败。

**理由**：悬浮窗的目标是最小化用户等待——控制权立即交还。错误由主窗口的全局 Toast 通道处理，无需反向通信。

### 9. MVP 允许并发提取

**决策**：不引入任务队列或防抖。用户极速连按快捷键时允许多个独立异步提取请求并发执行。

**理由**：无状态管线设计（每次调用独立），各请求互不干扰。桌面端单用户场景下并发数自然受限于用户手速。复杂队列机制推迟到 MVP 后。

## Risks / Trade-offs

- **并发提取 → 多个 Toast 同时弹出**：单用户场景下用户手速通常不会导致泛滥；如果成为问题，MVP 后引入简单的节流即可。
- **单次调用判定+提取 → 模型可能在相关时返回空字段**：temperature=0 和强制字段顺序将风险降至最低；force 模式提供兜底。
- **emit 全局广播 → 悬浮窗事件能被其他窗口监听**：`task:manual-extract` 是前端 `emit` 全局事件。如果未来新增第三窗口，需要确认不会误监听。目前只有主窗口监听，无冲突。
- **零重试 → 网络抖动丢一次提取**：桌面端网络稳定，且用户可立即重试（再按一次快捷键）。MVP 阶段可接受。
- **模型调用超时**：`complete()` 的超时由 `EXTRACTION_TIMEOUT_MS` 环境变量控制（默认 30_000ms）。超时后触发 Fail Fast → Toast 错误信息，不重试。变量已在 `.env.example` 中声明。
- **`show_overlay` 平台兼容**：`show_overlay` 核心函数中的 `AllowSetForegroundWindow` 调用须以 `#[cfg(target_os = "windows")]` 条件编译门控，确保 macOS/Linux 编译不引用 Windows API。
