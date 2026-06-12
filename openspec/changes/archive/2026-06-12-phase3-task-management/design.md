## Context

Phase-3 构建于 Phase-2（模型配置 CRUD + pi-ai Agent 模块）之上。用户需要定义"任务"（数据提取的组织单元）并为每个任务配置结构化的 Schema 字段。Schema 是 Phase-5 数据提取管线的核心输入——AI 将依据 Schema 从抓取的文本中提取结构化数据。

当前 `/tools/extractor` 路由仅有骨架页面。`AgentProvider` 仅在 `/settings` 路由内包裹，需要提升到 App 级别。

## Goals / Non-Goals

**Goals:**
- 实现任务完整生命周期：创建、列表、查看、更新、删除
- 可视化 Schema 编辑器（表格行式）：字段名、类型、必填、描述四个维度
- AI 辅助生成字段列表：自然语言描述 → 调用已配置模型 → 生成结构化 JSON
- 任务激活态管理：全局唯一激活任务，通过 `app_kv` 存储
- Zod 校验：字段名唯一性、命名规范、描述长度限制
- 未保存草稿切换保护：确认弹窗

**Non-Goals:**
- Schema 多版本管理（每任务仅有一个当前 Schema）
- 字段拖拽排序
- AI 生成流式返回（仅支持非流式 `complete()`）
- `schema_fields` 独立表（改用 JSON 内嵌，简化 MVP）
- 任务软删除（物理删除）

## Decisions

### D1: Schema 以 JSON TEXT 内嵌于 tasks 表，不创建独立的 schema_fields 表

**选择**：`tasks.schema TEXT` 存储 `{ "fields": [...] }` JSON 字符串，NULL 表示尚未定义。

**替代方案**：独立的 `schema_fields` 表（原 SCHEMA.md 设计），1:N 关联 tasks。

**理由**：
- 每任务只有一个当前 Schema，无需 1:N 的版本管理
- JSON 内嵌消除了 JOIN 查询，简化 CRUD 实现
- Schema 始终整体读写（编辑器一次性加载、一次性保存），字段级 CRUD 是过度设计
- 减少 V3 迁移的 SQL 量，跳过索引与 FK 定义

### D2: 任务激活状态存入 app_kv，不在 tasks 表中用 is_active 列

**选择**：`set_kv("active_task_id", task_id)` / `get_kv("active_task_id")`，零 Schema 变更。

**替代方案**：tasks 表增加 `is_active INTEGER` 列（原 SCHEMA.md 设计）。

**理由**：
- 激活态是全局系统配置，不是任务自身业务属性
- 避免切换激活时的"先清空全部再设置一个"的事务操作
- 减少 tasks 表接口复杂度

### D3: update_task 采用 PATCH 语义（三个字段均 COALESCE 跳过 NULL）

**选择**：`name`、`description`、`schema` 三个参数均为 `Option<String>`，NULL 表示"跳过更新"。后端 SQL 使用 COALESCE：

```sql
UPDATE tasks
SET name = COALESCE(?1, name),
    description = COALESCE(?2, description),
    schema = COALESCE(?3, schema),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?4
```

**替代方案**：前端每次发送全量数据（name + description + schema），或 name 保持必填。

**理由**：
- 失焦自动保存任务名时不应触碰正在编辑的 Schema 草稿
- 保存 Schema 时无需关心 name 的当前值（传 None 即可）
- 三个字段语义统一，接口更清晰
- description 清空：前端传 `Some("")` 即可正确处理

### D4: AI 调用在前端侧，复用 Agent 模块

**选择**：前端用 `useAgent()` 获取活跃模型配置 → `resolveModel()` 构造 Model 对象 → `complete()` 发送请求。不新增 Rust 侧 HTTP 调用。

**替代方案**：Rust 侧新建 Tauri command，在 Rust 中发起 HTTP 请求。

**理由**：
- `pi-ai` 已在前端集成（`useConnectionTest` 已验证可用）
- API key 不出 Rust 可控范围（仅在主动调用时使用）
- 无需引入 Rust HTTP 客户端依赖

### D5: AI 草稿生成 Fail Fast 策略

**选择**：JSON 解析失败 → Toast 错误提示 → 用户重试。不引入 JSON5 容错或其他修复策略。

**理由**：
- 高价值模型（DeepSeek V3/V4、GLM-4）对 JSON 格式指令的遵循度很高
- 解析失败是小概率事件，引入容错依赖得不偿失
- 重试成本低（2-3 秒内完成）

### D6: 组件本地 state 按区域拆分

**选择**：`useTaskList` hook 管理左侧栏状态，`useTaskDraft` hook 管理右侧编辑器状态，顶层容器仅维护 `selectedTaskId` 和 `refreshListTrigger`。

**替代方案**：React Context、Redux、Zustand。

**理由**：
- 状态按区域天然隔离，不需要跨区域共享
- Props drilling 路径极短（仅两层：容器 → 子组件）
- 无需引入额外状态管理依赖

### D7: AgentProvider 提升到 App 级别

**选择**：在 `App.tsx` 中包裹 `AgentProvider`，移除 Settings 路由内的包裹。

**理由**：Phase-3 的 AI 草稿生成需要 `useAgent()` 在 `/tools/extractor` 中可用。

### D8: 时间戳格式统一为 ISO 8601

**选择**：`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` 替代 `datetime('now')`。V3 迁移也修正 `model_configs` 表的默认值。

**理由**：
- 与 Rust 侧 `chrono::Utc::now().to_rfc3339()` 保持一致
- 消除跨表时间戳格式不一致的隐患

### D9: V3 迁移不转换 model_configs 存量时间戳，仅改默认值

**选择**：迁移 SQL 中的 `INSERT INTO model_configs_new SELECT * FROM model_configs` 直接复制数据，不转换已有 `created_at`/`updated_at` 值。仅新插入的行使用 ISO 8601 默认值。

**理由**：
- 存量数据量小（Phase-2 刚引入 model_configs，最多几条记录）
- 旧格式 `datetime('now')` 也是可读的 UTC 格式（`2026-06-12 08:30:00`）
- 前端展示不做格式假设，兼容两种格式
- 避免迁移 SQL 中的字符串解析复杂度

### D10: list_tasks 按更新时间倒序排列

**选择**：`ORDER BY updated_at DESC`，最近更新的任务排在列表顶部。

**理由**：与用户工作流直觉一致——最近编辑的任务最可能需要再次操作。

### D11: 任务名自动保存失败 → 回退到旧值

**选择**：`update_task` onBlur 失败时，将输入框的值回退到 `get_task` 返回的服务端当前值，并 Toast 错误信息。

**理由**：
- 保证前端显示与数据库一致
- 用户看到回退后可以重新编辑并触发保存
- 避免"以为保存了但实际没有"的静默数据丢失

### D12: 未选中任务时右侧编辑区不渲染

**选择**：`selectedTaskId === null` 时，整个右侧面板仅显示空状态占位提示（"请在左侧选择一个任务"），不渲染编辑器、AI Generation Zone 和 Action Bar。

**理由**：
- 避免"无任务时点击 AI 生成"的无效操作路径
- 减少不必要的状态管理复杂度
- UI 意图清晰：必须先有任务才能编辑

### D13: TaskSimple 包含 updated_at 字段

**选择**：`TaskSimple` 结构体增加 `updated_at: String` 字段，`list_tasks` 返回该字段。

**理由**：
- 侧边栏可以根据最后修改时间辅助用户判断
- 前端排序/过滤有据可依
- 增量成本极低（多 SELECT 一列）

### 实施注意事项

以下都是在审阅中发现的**确定需要修的实现细节**，不是决策点，直接落实到代码中：

1. **新增 `db::delete_kv()` 函数** — `set_active_task_id(None)` 需删除 KV 键，当前 `db/mod.rs` 只有 `get_kv` 和 `set_kv`，缺少 `delete_kv`。
2. **`db::set_kv` 的 `updated_at` 改为 ISO 8601** — 当前写的是 `datetime('now')`，与 V3 统一时间戳格式的目标矛盾。
3. **`list_tasks` 中 `get_kv("active_task_id")` 的 NotFound → None** — 无激活任务时不应抛错，应映射为 `active_task_id: None`。
4. **`delete_task` 原子性** — 先清除 `app_kv.active_task_id`（如果删除的是激活任务），再 `DELETE FROM tasks`，或包裹在同一事务中。避免"删除成功但 KV 残留悬空指针"。
5. **前端 hook 测试** — `useTaskList`/`useTaskDraft` 包含 dirty 状态机、脏检测弹窗、AI 生成状态管理，需要在任务 4.x 中补一条测试项。

### D14: Prompt 模板存放于 src/agent/extractor.ts

**选择**：按工具模块命名 `src/agent/extractor.ts`，不命名为通用的 `prompts.ts`。通过 `src/agent/index.ts` re-export。Phase-5 数据提取 prompt 也加到此文件中。

**理由**：
- 按工具粒度组织，避免单个巨型 prompt 文件
- 三级访问模式清晰：`extractor.ts` → `index.ts` → route 调用点

### D15: 字段类型选择器使用 Button + DropdownMenuRadioGroup，不使用原生 `<select>`

**选择**：将 Schema 编辑器中字段类型列的 `<select>` 替换为 `DropdownMenu` + `DropdownMenuRadioGroup` + `DropdownMenuRadioItem`，触发按钮使用 `buttonVariants({ variant: "outline", size: "sm" })` 统一样式。

**替代方案**：继续用原生 `<select>` + Tailwind 样式硬凑，或使用 shadcn Select 组件。

**理由**：
- 原生 `<select>` 的 border、rounded、focus-ring、下拉弹出样式与系统设计语言不一致
- 项目已有的 `DropdownMenu` 组件基于 Radix UI，动画、z-index、主题色全部自动适配
- `DropdownMenuRadioGroup` 单选语义天然匹配字段类型选择
- `Button` 组件缺少 `forwardRef`，不能用 `asChild` 包装，直接对 `DropdownMenuTrigger` 应用 `buttonVariants()` 获得相同视觉样式

### D16: 导航守卫 — 未保存修改时拦截页面离开

**选择**：创建 `src/lib/navigation-guard.tsx`，提供 `NavigationGuardProvider` 和 `useNavigationGuard` hook。页面注册异步守卫函数，Header 返回按钮在导航前调用 `checkGuard()`。

**替代方案**：React Router `useBlocker`（需要 data router，与现有 `<HashRouter>` 不兼容）、`window.onbeforeunload`（仅能拦截浏览器关闭/刷新，无法拦截 SPA 导航）。

**理由**：
- `<HashRouter>` 不支持 `useBlocker`，迁移到 `createHashRouter` 改动面太大
- Context-based guard 机制轻量（<40 行），不影响现有路由结构
- 守卫函数返回 `Promise<boolean>`，可直接对接 `useConfirm` 弹窗
- `NavigationGuardProvider` 放在路由外层，Header 和任意页面均可访问

## Risks / Trade-offs

- **[Schema 演化风险]** JSON 内嵌意味着未来如果要支持字段级历史版本或多 Schema，需要数据迁移 → 若需求出现，可在后续 Phase 增加 migration 将 JSON 展开为独立表
- **[大模型不稳定]** AI 返回的 JSON 可能格式错误 → Fail Fast + 用户重试，利用 Phase-5 Prompt 经验持续优化 Seed Prompt
- **[脏数据风险]** 用户未保存草稿就切换任务时可能丢失编辑 → 方案 2 确认弹窗保护，`isDirty` 状态标记检测变更

## Open Questions

无。所有技术决策已在讨论中敲定。
