use crate::db::{delete_kv, get_kv, set_kv};
use crate::db::state::DbState;
use crate::errors::{AppError, CommandResult};
use crate::models::{Task, TaskListResponse, TaskSimple};
use log;
use tauri::State;
use uuid::Uuid;

// ── 2.1 create_task ────────────────────────────────────────────────────

/// 创建新任务。返回完整 Task 对象。
#[tauri::command]
pub fn create_task(db: State<'_, DbState>, name: String) -> CommandResult<Task> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tasks (id, name) VALUES (?1, ?2)",
        rusqlite::params![id, name],
    )
    .map_err(AppError::Database)?;

    let task = conn
        .query_row(
            "SELECT id, name, description, schema, created_at, updated_at
             FROM tasks WHERE id = ?1",
            [&id],
            |row| {
                Ok(Task {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    schema: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(AppError::Database)?;

    log::info!("任务已创建: {} ({})", task.name, task.id);
    Ok(task)
}

// ── 2.2 list_tasks ─────────────────────────────────────────────────────

/// 返回所有任务（按 updated_at 倒序）及当前激活任务 ID。
#[tauri::command]
pub fn list_tasks(db: State<'_, DbState>) -> CommandResult<TaskListResponse> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, updated_at
             FROM tasks ORDER BY updated_at DESC",
        )
        .map_err(AppError::Database)?;

    let tasks = stmt
        .query_map([], |row| {
            Ok(TaskSimple {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(AppError::Database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;

    // NotFound 时返回 None（无激活任务）
    let active_task_id = match get_kv(&conn, "active_task_id") {
        Ok(id) => Some(id),
        Err(AppError::NotFound { .. }) => None,
        Err(e) => return Err(e.into()),
    };

    Ok(TaskListResponse {
        tasks,
        active_task_id,
    })
}

// ── 2.3 get_task ───────────────────────────────────────────────────────

/// 按 id 返回完整任务（含 schema JSON）。
#[tauri::command]
pub fn get_task(db: State<'_, DbState>, id: String) -> CommandResult<Task> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let task = conn
        .query_row(
            "SELECT id, name, description, schema, created_at, updated_at
             FROM tasks WHERE id = ?1",
            [&id],
            |row| {
                Ok(Task {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    schema: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: format!("task:{id}"),
            },
            other => AppError::Database(other),
        })?;

    Ok(task)
}

// ── 2.4 update_task ────────────────────────────────────────────────────

/// 更新任务（PATCH 语义）。name、description、schema 均为 Option，
/// NULL 表示保留原值。使用 COALESCE 跳过 NULL 参数。
#[tauri::command]
pub fn update_task(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    schema: Option<String>,
) -> CommandResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let affected = conn
        .execute(
            "UPDATE tasks
             SET name = COALESCE(?1, name),
                 description = COALESCE(?2, description),
                 schema = COALESCE(?3, schema),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?4",
            rusqlite::params![name, description, schema, id],
        )
        .map_err(AppError::Database)?;

    if affected == 0 {
        return Err(AppError::NotFound {
            source_id: format!("task:{id}"),
        }
        .into());
    }

    let mut changes = Vec::new();
    if name.is_some() {
        changes.push("name");
    }
    if description.is_some() {
        changes.push("description");
    }
    if schema.is_some() {
        changes.push("schema");
    }
    let changes_str = if changes.is_empty() {
        "无".to_string()
    } else {
        changes.join(", ")
    };
    log::info!("任务已更新: {} | 变更字段: {}", id, changes_str);
    Ok(())
}

// ── 2.5 delete_task ──────────────────────────────────────────────────

/// 删除任务。在事务中先清除激活状态（如果是激活任务），再物理删除。
#[tauri::command]
pub fn delete_task(db: State<'_, DbState>, id: String) -> CommandResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    // 验证任务存在
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE id = ?1",
            [&id],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .map_err(AppError::Database)?;

    if !exists {
        return Err(AppError::NotFound {
            source_id: format!("task:{id}"),
        }
        .into());
    }

    // 事务：先清 KV 再删行，确保原子性
    conn.execute("BEGIN", []).map_err(AppError::Database)?;

    // 如果删除的是激活任务，清除 active_task_id
    if let Ok(active_id) = get_kv(&conn, "active_task_id") {
        if active_id == id {
            if let Err(e) = delete_kv(&conn, "active_task_id") {
                let _ = conn.execute("ROLLBACK", []);
                return Err(e.into());
            }
        }
    }

    if let Err(e) = conn
        .execute("DELETE FROM tasks WHERE id = ?1", [&id])
        .map_err(AppError::Database)
    {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e.into());
    }

    conn.execute("COMMIT", []).map_err(AppError::Database)?;
    log::info!("任务已删除: {}", id);
    Ok(())
}

// ── 2.6 set_active_task_id ─────────────────────────────────────────────

/// 设置/取消激活任务。Some(id) 写入 KV，None 删除 KV 键。
#[tauri::command]
pub fn set_active_task_id(db: State<'_, DbState>, id: Option<String>) -> CommandResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    match id {
        Some(task_id) => {
            set_kv(&conn, "active_task_id", &task_id)?;
            let name: String = conn
                .query_row(
                    "SELECT name FROM tasks WHERE id = ?1",
                    [&task_id],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| task_id.clone());
            log::info!("已激活任务: {}", name);
        }
        None => {
            delete_kv(&conn, "active_task_id")?;
            log::info!("已取消任务激活");
        }
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::state::DbState;
    use rusqlite::Connection;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup_db() -> DbState {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::run_migrations(&mut conn).unwrap();
        DbState {
            conn: Mutex::new(conn),
        }
    }

    // ── create_task ────────────────────────────────────────────────────

    #[test]
    fn create_task_returns_full_task() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "简历库".into()).unwrap();
        assert_eq!(task.name, "简历库");
        assert!(!task.id.is_empty());
        assert!(task.description.is_none());
        assert!(task.schema.is_none());
        assert!(task.created_at.contains('T'));
        assert!(task.updated_at.contains('T'));
    }

    // ── list_tasks ─────────────────────────────────────────────────────

    #[test]
    fn list_tasks_empty() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let resp = list_tasks(app.state()).unwrap();
        assert!(resp.tasks.is_empty());
        assert!(resp.active_task_id.is_none());
    }

    #[test]
    fn list_tasks_returns_tasks_ordered_by_updated_at_desc() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let t1 = create_task(app.state(), "任务A".into()).unwrap();
        let t2 = create_task(app.state(), "任务B".into()).unwrap();

        // 更新 t1 使其 updated_at 变为最新
        update_task(app.state(), t1.id.clone(), Some("任务A-改".into()), None, None).unwrap();

        let resp = list_tasks(app.state()).unwrap();
        assert_eq!(resp.tasks.len(), 2);
        // 最近更新的排最前
        assert_eq!(resp.tasks[0].id, t1.id);
        assert_eq!(resp.tasks[1].id, t2.id);
    }

    #[test]
    fn list_tasks_includes_active_task_id() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "测试".into()).unwrap();
        set_active_task_id(app.state(), Some(task.id.clone())).unwrap();

        let resp = list_tasks(app.state()).unwrap();
        assert_eq!(resp.active_task_id, Some(task.id));
    }

    // ── get_task ───────────────────────────────────────────────────────

    #[test]
    fn get_task_returns_full_task_with_schema() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "测试".into()).unwrap();
        let fetched = get_task(app.state(), task.id.clone()).unwrap();
        assert_eq!(fetched.id, task.id);
        assert_eq!(fetched.name, "测试");
    }

    #[test]
    fn get_task_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = get_task(app.state(), "nonexistent".into()).unwrap_err();
        match err {
            crate::errors::SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("task:nonexistent"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── update_task (PATCH 语义) ───────────────────────────────────────

    #[test]
    fn update_task_partial_name_only() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "旧名称".into()).unwrap();
        update_task(app.state(), task.id.clone(), Some("新名称".into()), None, None).unwrap();

        let updated = get_task(app.state(), task.id).unwrap();
        assert_eq!(updated.name, "新名称");
        assert!(updated.description.is_none());
        assert!(updated.schema.is_none());
    }

    #[test]
    fn update_task_partial_schema_only() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "测试".into()).unwrap();
        let schema_json = r#"{"fields":[{"name":"email","type":"String","required":true,"description":"邮箱"}]}"#;
        update_task(
            app.state(),
            task.id.clone(),
            None,
            None,
            Some(schema_json.into()),
        )
        .unwrap();

        let updated = get_task(app.state(), task.id).unwrap();
        assert_eq!(updated.name, "测试"); // name 未变
        assert!(updated.schema.is_some());
    }

    #[test]
    fn update_task_clear_description() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "测试".into()).unwrap();
        // 先设置 description
        update_task(app.state(), task.id.clone(), None, Some("描述".into()), None).unwrap();
        // 再清空
        update_task(app.state(), task.id.clone(), None, Some("".into()), None).unwrap();

        let updated = get_task(app.state(), task.id).unwrap();
        assert_eq!(updated.description, Some("".into()));
    }

    #[test]
    fn update_task_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = update_task(app.state(), "nonexistent".into(), Some("x".into()), None, None)
            .unwrap_err();
        match err {
            crate::errors::SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("task:nonexistent"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── delete_task ────────────────────────────────────────────────────

    #[test]
    fn delete_task_removes_task() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "待删除".into()).unwrap();
        delete_task(app.state(), task.id.clone()).unwrap();

        let err = get_task(app.state(), task.id).unwrap_err();
        match err {
            crate::errors::SerializableError::NotFound { .. } => {}
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    #[test]
    fn delete_active_task_clears_kv() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "激活任务".into()).unwrap();
        set_active_task_id(app.state(), Some(task.id.clone())).unwrap();

        delete_task(app.state(), task.id.clone()).unwrap();

        // 验证 active_task_id 已清除
        let resp = list_tasks(app.state()).unwrap();
        assert!(resp.active_task_id.is_none());
    }

    #[test]
    fn delete_task_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = delete_task(app.state(), "nonexistent".into()).unwrap_err();
        match err {
            crate::errors::SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("task:nonexistent"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── set_active_task_id ─────────────────────────────────────────────

    #[test]
    fn set_active_task_id_sets_and_clears() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let task = create_task(app.state(), "测试".into()).unwrap();

        // 设置激活
        set_active_task_id(app.state(), Some(task.id.clone())).unwrap();
        let resp = list_tasks(app.state()).unwrap();
        assert_eq!(resp.active_task_id, Some(task.id.clone()));

        // 取消激活
        set_active_task_id(app.state(), None).unwrap();
        let resp = list_tasks(app.state()).unwrap();
        assert_eq!(resp.active_task_id, None);
    }
}
