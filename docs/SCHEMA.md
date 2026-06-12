# SCHEMA.md — OrbitX 全量数据模型 ER 图（已冻结）

> **状态**：已冻结。本文档为全量数据模型权威定义。
> **策略**：方案 C — Phase-1 物理上仅有 `app_kv` 表，但全量 ER 图在工程设计上提前规划并冻结于此。
> **数据库**：SQLite (WAL mode)，通过 rusqlite + Tauri Managed State (`Mutex<Connection>`) 访问。

---

## 1. 实体关系总览

```
┌──────────────────┐       ┌──────────────────┐
│    app_kv        │       │   model_configs  │
│──────────────────│       │──────────────────│
│ key       TEXT PK│       │ id         TEXT PK│
│ value     TEXT   │       │ provider   TEXT   │
│ created_at TEXT   │       │ label      TEXT   │
│ updated_at TEXT   │       │ base_url   TEXT   │
└──────────────────┘       │ model_id   TEXT   │
                           │ model_name TEXT   │
                           │ api_key    TEXT   │
                           │ is_active  INT    │
                           │ created_at TEXT   │
                           │ updated_at TEXT   │
                           └──────────────────┘

┌──────────────────────────────────────────────────────┐
│                      tasks                           │
│──────────────────────────────────────────────────────│
│ id           TEXT PK                                 │
│ name         TEXT NOT NULL                           │
│ description  TEXT DEFAULT ''                         │
│ is_active    INTEGER DEFAULT 0                       │
│ created_at   TEXT NOT NULL                           │
│ updated_at   TEXT NOT NULL                           │
└──────────────┬───────────────────────────────────────┘
               │ 1
               │
               │ N
┌──────────────▼───────────────────────────────────────┐
│                  schema_fields                       │
│──────────────────────────────────────────────────────│
│ id           TEXT PK                                 │
│ task_id      TEXT NOT NULL  FK → tasks(id) ON DELETE  │
│              CASCADE                                │
│ field_name   TEXT NOT NULL                           │
│ field_type   TEXT NOT NULL  CHECK(field_type IN       │
│              ('string','number','date','boolean'))    │
│ sort_order   INTEGER DEFAULT 0                       │
│ created_at   TEXT NOT NULL                           │
│ updated_at   TEXT NOT NULL                           │
└──────────────────────────────────────────────────────┘
               │
               │  (task_id FK, no direct schema_fields FK
               │   to keep extraction flexible — schema
               │   may evolve after data is captured)
               │
┌──────────────▼───────────────────────────────────────┐
│                 extracted_data                       │
│──────────────────────────────────────────────────────│
│ id           TEXT PK                                 │
│ task_id      TEXT NOT NULL  FK → tasks(id) ON DELETE  │
│              CASCADE                                │
│ raw_text     TEXT NOT NULL                           │
│ fields_json  TEXT NOT NULL  (JSON object, extracted   │
│              key:value pairs per Schema at capture     │
│              time)                                   │
│ is_relevant  INTEGER DEFAULT 1                       │
│ is_confirmed INTEGER DEFAULT 0                       │
│ source_app   TEXT DEFAULT ''                         │
│ created_at   TEXT NOT NULL                           │
└──────────────────────────────────────────────────────┘
```

---

## 2. 表详细定义

### 2.1 `app_kv` — 应用键值存储

**用途**：存储全局配置、Schema 版本号、迁移标记等简单键值对。Phase-1 唯一物理存在的表。

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `key` | TEXT | PRIMARY KEY | 配置键名 |
| `value` | TEXT | NOT NULL | 配置值 |
| `created_at` | TEXT | NOT NULL, DEFAULT (datetime('now')) | 创建时间 (ISO 8601 UTC) |
| `updated_at` | TEXT | NOT NULL, DEFAULT (datetime('now')) | 更新时间 (ISO 8601 UTC) |

**Phase-1 种子数据**：

| key | value | 说明 |
|-----|-------|------|
| `schema_version` | `"1"` | 当前 Schema 迁移版本号 |
| `ipc_status` | `"ok"` | IPC 通路验证标记 |

---

### 2.2 `model_configs` — AI 模型配置

**用途**：存储用户配置的所有 AI 模型端点（BYOK + 自定义 OpenAI 兼容）。

**引入阶段**：Phase-2

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `provider` | TEXT | NOT NULL | 厂商标识：`deepseek` / `openai` / `zhipu` / `custom` |
| `label` | TEXT | NOT NULL | 用户自定义的配置名称（如 "我的 DeepSeek"），全局不区分大小写唯一 |
| `base_url` | TEXT | NOT NULL | API Base URL |
| `model_id` | TEXT | NOT NULL | 模型标识符（如 `deepseek-chat`、`glm-4-flash`） |
| `model_name` | TEXT | NOT NULL | 模型显示名称（如 "DeepSeek Chat"） |
| `api_key` | TEXT | NOT NULL, DEFAULT '' | API Key（明文存储） |
| `is_active` | INTEGER | NOT NULL, DEFAULT 0 | 是否为当前激活模型（全局唯一活跃标记） |
| `created_at` | TEXT | NOT NULL | ISO 8601 UTC |
| `updated_at` | TEXT | NOT NULL | ISO 8601 UTC |

**唯一性约束**：`label` 全局唯一。Rust 后端在插入/更新前执行不区分大小写的重复检查。数据库层面通过 `UNIQUE(label)` 作为最后防线（区分大小写）。

**业务规则**：
- 全局只有一个 `is_active = 1` 的配置。激活新配置时，Rust 在事务内先取消所有旧激活再激活目标。
- `api_key` 明文存储，不做二进制混淆。
- 不允许删除当前激活的模型（`is_active = 1`）。Rust 后端直接拒绝，不依赖 UI 禁用。

---

### 2.3 `tasks` — 提取任务

**用途**：数据提取的基本组织单元（如"简历库""价格表"）。

**引入阶段**：Phase-3

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `name` | TEXT | NOT NULL | 任务名称 |
| `description` | TEXT | NOT NULL, DEFAULT '' | 任务描述（自然语言） |
| `is_active` | INTEGER | NOT NULL, DEFAULT 0 | 静默提取的当前激活任务（全局唯一） |
| `created_at` | TEXT | NOT NULL | ISO 8601 UTC |
| `updated_at` | TEXT | NOT NULL | ISO 8601 UTC |

**业务规则**：
- 全局只有一个 `is_active = 1` 的任务。激活新任务时，先取消所有旧激活。

---

### 2.4 `schema_fields` — Schema 字段定义

**用途**：定义每个任务的结构化提取字段。独立表（非 JSON blob），支持精细的字段级操作。

**引入阶段**：Phase-3

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) ON DELETE CASCADE | 所属任务 |
| `field_name` | TEXT | NOT NULL | 字段名（如 `candidate_name`） |
| `field_type` | TEXT | NOT NULL, CHECK(field_type IN ('string','number','date','boolean')) | 字段类型枚举 |
| `sort_order` | INTEGER | NOT NULL, DEFAULT 0 | 排序权重（升序） |
| `created_at` | TEXT | NOT NULL | ISO 8601 UTC |
| `updated_at` | TEXT | NOT NULL | ISO 8601 UTC |

**外键**：`FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE`

**唯一性约束**：`UNIQUE(task_id, field_name)` — 同一任务下字段名不可重复。

---

### 2.5 `extracted_data` — 提取数据记录

**用途**：存储每次提取的结构化结果。

**引入阶段**：Phase-5

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PRIMARY KEY | UUID v4 |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) ON DELETE CASCADE | 所属任务 |
| `raw_text` | TEXT | NOT NULL | 原始选中文本（溯源用） |
| `fields_json` | TEXT | NOT NULL | 提取结果 JSON 对象 |
| `is_relevant` | INTEGER | NOT NULL, DEFAULT 1 | AI 相关性判定：0=不相关, 1=相关 |
| `is_confirmed` | INTEGER | NOT NULL, DEFAULT 0 | 用户是否已确认：0=待确认, 1=已确认 |
| `source_app` | TEXT | NOT NULL, DEFAULT '' | 抓取来源应用名（如 `Chrome`, `Preview`） |
| `created_at` | TEXT | NOT NULL | ISO 8601 UTC |

**外键**：`FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE`

**业务规则**：
- `fields_json` 为 JSON 对象，内容由该任务的当前 Schema 决定（AI 按字段名提取）。
- 相关性降级流程：`is_relevant=0` → 打断静默模式 → 弹出预览卡片让用户选择丢弃或 `is_confirmed=1` 强制入库。
- `is_relevant=1` → 静默入库，仅弹 2 秒 Toast。

---

## 3. 索引策略

| 表 | 索引名 | 列 | 用途 |
|----|--------|-----|------|
| `model_configs` | `idx_model_configs_active` | `is_active` | 快速定位当前激活模型 |
| `tasks` | `idx_tasks_active` | `is_active` | 快速定位当前激活任务 |
| `schema_fields` | `idx_schema_fields_task` | `task_id, sort_order` | 按任务加载 Schema（按排序） |
| `extracted_data` | `idx_extracted_task_time` | `task_id, created_at DESC` | 数据网格分页查询 |
| `extracted_data` | `idx_extracted_relevant` | `task_id, is_relevant` | 相关性过滤查询 |

---

## 4. Phase-by-Phase 迁移计划

### Phase-1 迁移 (V1)

```sql
-- 唯一物理创建的表
CREATE TABLE app_kv (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 种子数据
INSERT INTO app_kv (key, value) VALUES ('schema_version', '1');
INSERT INTO app_kv (key, value) VALUES ('ipc_status', 'ok');
```

### Phase-2 迁移 (V2)

```sql
BEGIN;

CREATE TABLE model_configs (
    id          TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    label       TEXT NOT NULL UNIQUE,
    base_url    TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    model_name  TEXT NOT NULL,
    api_key     TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_model_configs_active ON model_configs(is_active);

UPDATE app_kv SET value = '2' WHERE key = 'schema_version';

COMMIT;
```

### Phase-3 迁移 (V3)

```sql
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE schema_fields (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    field_name  TEXT NOT NULL,
    field_type  TEXT NOT NULL CHECK(field_type IN ('string','number','date','boolean')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, field_name)
);

CREATE INDEX idx_tasks_active ON tasks(is_active);
CREATE INDEX idx_schema_fields_task ON schema_fields(task_id, sort_order);

UPDATE app_kv SET value = '3' WHERE key = 'schema_version';
```

### Phase-5 迁移 (V4)

```sql
CREATE TABLE extracted_data (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    raw_text     TEXT NOT NULL,
    fields_json  TEXT NOT NULL,
    is_relevant  INTEGER NOT NULL DEFAULT 1,
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    source_app   TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_extracted_task_time ON extracted_data(task_id, created_at DESC);
CREATE INDEX idx_extracted_relevant ON extracted_data(task_id, is_relevant);

UPDATE app_kv SET value = '4' WHERE key = 'schema_version';
```

---

## 5. UUID 生成策略

所有 `id` 字段使用 UUID v4，由 Rust 侧生成（`uuid` crate），确保：
- 离线环境下全局唯一
- 与外部系统集成时无 ID 冲突
- 前端不负责 ID 生成

```rust
// Rust 侧 DAO 层统一模式
fn insert_task(conn: &Connection, name: &str, description: &str) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO tasks (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, description, now, now],
    )?;
    Ok(id)
}
```

## 6. 时间戳规范

- 所有 `created_at` / `updated_at` 使用 ISO 8601 UTC 格式 (`YYYY-MM-DDTHH:MM:SS.sssZ`)
- SQLite 默认值使用 `datetime('now')`（UTC）
- Rust 侧使用 `chrono::Utc::now().to_rfc3339()` 生成
- 前后端统一使用字符串传输，不做本地时区转换

---

**冻结日期**：2026-06-11
**下次评审**：Phase-2 启动前
