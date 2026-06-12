# Task Activation

## Purpose

Define the global task activation mechanism: single active task stored in `app_kv.active_task_id`, managed via `set_active_task_id` Tauri command, with exclusive radio-style Switch UI in the sidebar.

## Requirements

### Requirement: 任务激活态存储
任务激活态 SHALL 通过 `app_kv` 表存储，键为 `active_task_id`，值为当前激活任务的 UUID。该键在 `app_kv` 中不存在或值为空字符串时，表示无激活任务。

#### Scenario: 读取当前激活任务
- **WHEN** 调用 `get_kv("active_task_id")`
- **THEN** 返回当前激活任务的 UUID 字符串
- **THEN** 如果无激活任务，返回 `NotFound` 错误

#### Scenario: 写入激活任务
- **WHEN** 调用 `set_kv("active_task_id", "task-uuid-1")`
- **THEN** `app_kv` 中 `active_task_id` 的值更新为 `"task-uuid-1"`
- **THEN** 如果该键不存在则插入，存在则更新

### Requirement: set_active_task_id command
Rust 后端 SHALL 提供 `set_active_task_id` Tauri Command：

- 参数：`id: Option<String>`
- 返回：`()`
- 行为：`Some(id)` 时写入 `app_kv.active_task_id`；`None` 时删除该键

#### Scenario: 激活任务
- **WHEN** 调用 `set_active_task_id(Some("task-uuid"))`
- **THEN** `app_kv.active_task_id` 设置为 `"task-uuid"`

#### Scenario: 取消激活
- **WHEN** 调用 `set_active_task_id(None)`
- **THEN** `app_kv` 中的 `active_task_id` 键被删除

### Requirement: 前端激活开关排他行为
前端左侧栏的任务行 Switch 组件 SHALL 实现 Radio（单选）逻辑：开启一个任务的 Switch 会自动关闭上一个激活任务的 Switch。视觉上使用 Switch 组件，但业务行为是互斥的。

#### Scenario: 切换激活任务
- **WHEN** 用户在任务 B 上点击 Switch（此时任务 A 已激活）
- **THEN** 调用 `set_active_task_id(Some("B"))`
- **THEN** 任务 A 的 Switch 变为关闭状态
- **THEN** 任务 B 的 Switch 变为开启状态

#### Scenario: 关闭当前激活任务
- **WHEN** 用户在已激活任务上点击 Switch 再次关闭
- **THEN** 调用 `set_active_task_id(None)`
- **THEN** 全局无激活任务
