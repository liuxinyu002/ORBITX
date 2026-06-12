## ADDED Requirements

### Requirement: tasks 表结构
数据库 SHALL 包含 `tasks` 表，结构如下：

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schema TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

`schema` 列存储 `TaskSchema` JSON 序列化字符串，可为 NULL（任务尚未定义 Schema）。

#### Scenario: tasks 表创建成功
- **WHEN** V3 迁移执行
- **THEN** `tasks` 表存在，包含 id、name、description、schema、created_at、updated_at 列
- **THEN** 无 `is_active` 列

### Requirement: Task Rust 数据模型
Rust 侧 SHALL 定义以下数据结构：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSimple {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
    pub tasks: Vec<TaskSimple>,
    pub active_task_id: Option<String>,
}
```

#### Scenario: Task 序列化为 camelCase JSON
- **WHEN** Task 实例序列化为 JSON
- **THEN** 字段名使用 camelCase（如 `createdAt`）

#### Scenario: TaskListResponse 同时包含任务列表和激活状态
- **WHEN** `list_tasks` command 返回
- **THEN** 前端一次 IPC 获取所有任务列表和当前激活任务 ID

### Requirement: create_task command
Rust 后端 SHALL 提供 `create_task` Tauri Command：

- 参数：`name: String`
- 返回：`Task`（完整 task 对象，含生成的 UUID 和时间戳）
- 行为：生成 UUID v4，插入 tasks 表，`description` 和 `schema` 初始为 NULL

#### Scenario: 创建新任务
- **WHEN** 调用 `create_task("简历库")`
- **THEN** 返回 Task 对象，`name` 为 "简历库"，`id` 为 UUID v4
- **THEN** `description` 和 `schema` 为 null
- **THEN** `created_at` 和 `updated_at` 为 ISO 8601 UTC 时间戳

### Requirement: list_tasks command
Rust 后端 SHALL 提供 `list_tasks` Tauri Command：

- 参数：无
- 返回：`TaskListResponse`（含 `tasks: Vec<TaskSimple>` 和 `active_task_id: Option<String>`）
- 行为：查询所有 tasks（`ORDER BY updated_at DESC`），同时从 `app_kv` 读取 `active_task_id`（键不存在时返回 `None`）

#### Scenario: 空任务列表
- **WHEN** 数据库中没有任务
- **THEN** 返回 `tasks: []`, `active_task_id: null`

#### Scenario: 有任务且有激活任务
- **WHEN** 数据库中有 3 个任务，`app_kv.active_task_id = "task-uuid-2"`
- **THEN** 返回 3 个 TaskSimple，`active_task_id` 为 `"task-uuid-2"`

### Requirement: get_task command
Rust 后端 SHALL 提供 `get_task` Tauri Command：

- 参数：`id: String`
- 返回：`Task`（完整 task，包含 schema JSON）
- 错误：`NotFound { source_id: "task:<id>" }`

#### Scenario: 获取存在的任务
- **WHEN** 调用 `get_task("task-uuid")` 且该任务存在
- **THEN** 返回完整 Task，schema 字段包含 JSON 字符串或 null

#### Scenario: 获取不存在的任务
- **WHEN** 调用 `get_task("nonexistent")`
- **THEN** 返回 `NotFound` 错误

### Requirement: update_task command (PATCH 语义)
Rust 后端 SHALL 提供 `update_task` Tauri Command：

- 参数：`id: String`, `name: Option<String>`, `description: Option<String>`, `schema: Option<String>`
- 行为：使用 `COALESCE` 跳过所有 NULL 参数，NULL 表示保留原值

SQL：
```sql
UPDATE tasks
SET name = COALESCE(?1, name),
    description = COALESCE(?2, description),
    schema = COALESCE(?3, schema),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?4
```

- 错误：`NotFound { source_id: "task:<id>" }`

#### Scenario: 仅更新名称，保留 description 和 schema
- **WHEN** 调用 `update_task(id, Some("新名称"), None, None)`
- **THEN** name 更新为 "新名称"
- **THEN** description 和 schema 保持原值不变
- **THEN** `updated_at` 更新为当前时间

#### Scenario: 仅更新 Schema，保留 name
- **WHEN** 调用 `update_task(id, None, None, Some("{\"fields\":[...]}"))`
- **THEN** schema 更新
- **THEN** name 和 description 保持原值不变

#### Scenario: 清空 description
- **WHEN** 调用 `update_task(id, None, Some(""), None)`
- **THEN** description 更新为空字符串 ""

#### Scenario: 保存所有字段
- **WHEN** 调用 `update_task(id, Some("名称"), Some("描述"), Some("{\"fields\":[...]}"))`
- **THEN** 所有三个字段更新为新值

### Requirement: delete_task command
Rust 后端 SHALL 提供 `delete_task` Tauri Command：

- 参数：`id: String`
- 行为：在同一事务中先清除 `app_kv.active_task_id`（如果删除的是激活任务），再物理删除（`DELETE FROM tasks WHERE id = ?1`）
- 事务确保"清 KV + 删行"原子执行，避免"删除成功但 KV 残留悬空指针"
- 错误：`NotFound { source_id: "task:<id>" }`

#### Scenario: 删除普通任务
- **WHEN** 调用 `delete_task("task-uuid")` 且该任务不是激活任务
- **THEN** 任务被物理删除
- **THEN** `active_task_id` 不变

#### Scenario: 删除激活任务
- **WHEN** 调用 `delete_task` 删除当前激活任务
- **THEN** 任务被物理删除
- **THEN** `app_kv` 中的 `active_task_id` 被清除
