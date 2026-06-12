use crate::db::state::DbState;
use crate::errors::{AppError, CommandResult, SerializableError};
use crate::models::{mask_api_key, ModelConfig, ModelConfigInput};
use log;
use rusqlite::OptionalExtension;
use tauri::State;
use uuid::Uuid;

// ── 4.1 save_model_config ────────────────────────────────────────────

/// 创建或更新模型配置。如果 input 的 label 匹配已有配置（不区分大小写），则更新；
/// 否则插入新行。返回配置 id。
#[tauri::command]
pub fn save_model_config(
    db: State<'_, DbState>,
    input: ModelConfigInput,
) -> CommandResult<String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    // 不区分大小写唯一性校验
    let existing: Option<(String,)> = conn
        .query_row(
            "SELECT id FROM model_configs WHERE LOWER(label) = LOWER(?1)",
            [&input.label],
            |row| Ok((row.get(0)?,)),
        )
        .optional()
        .map_err(AppError::Database)?;

    if let Some((existing_id,)) = existing {
        // 读取旧值用于 diff 日志
        let old = conn
            .query_row(
                "SELECT provider, label, base_url, model_id, model_name, api_key
                 FROM model_configs WHERE id = ?1",
                [&existing_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .map_err(AppError::Database)?;

        // 更新已有配置
        conn.execute(
            "UPDATE model_configs SET provider=?1, base_url=?2, model_id=?3, model_name=?4, api_key=?5, updated_at=datetime('now')
             WHERE id=?6",
            rusqlite::params![
                input.provider,
                input.base_url,
                input.model_id,
                input.model_name,
                input.api_key,
                existing_id,
            ],
        )
        .map_err(AppError::Database)?;

        // 构建变更列表
        let mut changes: Vec<String> = Vec::new();
        if old.0 != input.provider {
            changes.push(format!("provider: {} → {}", old.0, input.provider));
        }
        if old.1 != input.label {
            changes.push(format!("label: {} → {}", old.1, input.label));
        }
        if old.2 != input.base_url {
            changes.push(format!("base_url: {} → {}", old.2, input.base_url));
        }
        if old.3 != input.model_id {
            changes.push(format!("model_id: {} → {}", old.3, input.model_id));
        }
        if old.4 != input.model_name {
            changes.push(format!("model_name: {} → {}", old.4, input.model_name));
        }
        if old.5 != input.api_key {
            changes.push(format!(
                "api_key: {} → {}",
                mask_api_key(&old.5),
                mask_api_key(&input.api_key)
            ));
        }

        if changes.is_empty() {
            log::info!("模型配置已更新（无变更）: {} ({})", input.label, existing_id);
        } else {
            log::info!(
                "模型配置已更新: {} ({}) | 变更: {}",
                input.label,
                existing_id,
                changes.join(", ")
            );
        }
        Ok(existing_id)
    } else {
        // 插入新配置
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO model_configs (id, provider, label, base_url, model_id, model_name, api_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                id,
                input.provider,
                input.label,
                input.base_url,
                input.model_id,
                input.model_name,
                input.api_key,
            ],
        )
        .map_err(AppError::Database)?;
        log::info!(
            "模型配置已创建: {} ({}) | provider={}, model_id={}, base_url={}, api_key={}",
            input.label,
            id,
            input.provider,
            input.model_id,
            input.base_url,
            mask_api_key(&input.api_key),
        );
        Ok(id)
    }
}

// ── 4.2 get_model_configs ────────────────────────────────────────────

/// 返回所有模型配置列表，api_key 经 mask_api_key() 脱敏。
#[tauri::command]
pub fn get_model_configs(db: State<'_, DbState>) -> CommandResult<Vec<ModelConfig>> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, provider, label, base_url, model_id, model_name, api_key, is_active, created_at, updated_at
             FROM model_configs ORDER BY created_at",
        )
        .map_err(AppError::Database)?;

    let configs = stmt
        .query_map([], |row| {
            Ok(ModelConfig {
                id: row.get(0)?,
                provider: row.get(1)?,
                label: row.get(2)?,
                base_url: row.get(3)?,
                model_id: row.get(4)?,
                model_name: row.get(5)?,
                api_key: mask_api_key(&row.get::<_, String>(6)?),
                is_active: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(AppError::Database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;

    Ok(configs)
}

// ── 4.3 delete_model_config ──────────────────────────────────────────

/// 删除模型配置。如果目标是当前激活模型则拒绝；不存在时返回 NotFound。
#[tauri::command]
pub fn delete_model_config(db: State<'_, DbState>, id: String) -> CommandResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let is_active: i32 = conn
        .query_row(
            "SELECT is_active FROM model_configs WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: format!("model_config:{id}"),
            },
            other => AppError::Database(other),
        })?;

    if is_active != 0 {
        return Err(SerializableError::InvalidState(
            "不能删除当前激活的模型，请先激活其他模型".into(),
        ));
    }

    conn.execute("DELETE FROM model_configs WHERE id = ?1", [&id])
        .map_err(AppError::Database)?;
    log::info!("模型配置已删除: {}", id);
    Ok(())
}

// ── 4.4 set_active_model ─────────────────────────────────────────────

/// 设置激活模型。在事务中：全部置 0 → 目标置 1。
#[tauri::command]
pub fn set_active_model(db: State<'_, DbState>, id: String) -> CommandResult<()> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    // 先验证目标存在
    let _exists: String = conn
        .query_row(
            "SELECT id FROM model_configs WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: format!("model_config:{id}"),
            },
            other => AppError::Database(other),
        })?;

    // 显式事务：全部置 0 和置 1 必须原子执行
    conn.execute("BEGIN", []).map_err(AppError::Database)?;
    if let Err(e) = conn
        .execute("UPDATE model_configs SET is_active = 0", [])
        .map_err(AppError::Database)
    {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e.into());
    }
    if let Err(e) = conn
        .execute(
            "UPDATE model_configs SET is_active = 1 WHERE id = ?1",
            [&id],
        )
        .map_err(AppError::Database)
    {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e.into());
    }
    conn.execute("COMMIT", []).map_err(AppError::Database)?;

    let config = conn
        .query_row(
            "SELECT label, provider, model_id, model_name, base_url, api_key
             FROM model_configs WHERE id = ?1",
            [&id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .map_err(AppError::Database)?;

    log::info!(
        "已切换激活模型: {} | label={}, provider={}, model_id={}, model_name={}, base_url={}, api_key={}",
        id,
        config.0,
        config.1,
        config.2,
        config.3,
        config.4,
        mask_api_key(&config.5),
    );
    Ok(())
}

// ── 4.5 get_active_model ─────────────────────────────────────────────

/// 返回当前激活模型（含完整 api_key）。
#[tauri::command]
pub fn get_active_model(db: State<'_, DbState>) -> CommandResult<ModelConfig> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let config = conn
        .query_row(
            "SELECT id, provider, label, base_url, model_id, model_name, api_key, is_active, created_at, updated_at
             FROM model_configs WHERE is_active = 1",
            [],
            |row| {
                Ok(ModelConfig {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    label: row.get(2)?,
                    base_url: row.get(3)?,
                    model_id: row.get(4)?,
                    model_name: row.get(5)?,
                    api_key: row.get(6)?,
                    is_active: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: "model_config:active".into(),
            },
            other => AppError::Database(other),
        })?;

    Ok(config)
}

// ── 4.6 get_model_api_key ────────────────────────────────────────────

/// 按 id 返回完整 api_key。
#[tauri::command]
pub fn get_model_api_key(db: State<'_, DbState>, id: String) -> CommandResult<String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let api_key: String = conn
        .query_row(
            "SELECT api_key FROM model_configs WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                source_id: format!("model_config:{id}"),
            },
            other => AppError::Database(other),
        })?;

    Ok(api_key)
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

    fn make_input(
        provider: &str,
        label: &str,
        api_key: &str,
    ) -> ModelConfigInput {
        ModelConfigInput {
            provider: provider.into(),
            label: label.into(),
            base_url: match provider {
                "deepseek" => "https://api.deepseek.com/v1".into(),
                "openai" => "https://api.openai.com/v1".into(),
                "zhipu" => "https://open.bigmodel.cn/api/paas/v4".into(),
                _ => "http://localhost:11434/v1".into(),
            },
            model_id: match provider {
                "deepseek" => "deepseek-chat".into(),
                "openai" => "gpt-4o".into(),
                _ => "test-model".into(),
            },
            model_name: match provider {
                "deepseek" => "DeepSeek Chat".into(),
                "openai" => "GPT-4o".into(),
                _ => "Test Model".into(),
            },
            api_key: api_key.into(),
        }
    }

    // ── CP-MC-1: save_model_config 创建新配置 ─────────────────────────

    #[test]
    fn save_creates_new_config() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);
        let state: State<'_, DbState> = app.state();

        let input = make_input("deepseek", "My DeepSeek", "sk-test-key-12345678");
        let id = save_model_config(state, input).unwrap();
        assert!(!id.is_empty());

        let configs = get_model_configs(app.state()).unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].label, "My DeepSeek");
        assert_eq!(configs[0].provider, "deepseek");
    }

    // ── CP-MC-1: save_model_config 更新已有配置（label 不区分大小写匹配）─

    #[test]
    fn save_updates_existing_config_on_label_match() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let input1 = make_input("deepseek", "My Model", "sk-key-aaa");
        let id1 = save_model_config(app.state(), input1).unwrap();

        let input2 = make_input("openai", "my model", "sk-key-bbb");
        let id2 = save_model_config(app.state(), input2).unwrap();

        // 应该更新同一条，id 不变
        assert_eq!(id1, id2);

        let configs = get_model_configs(app.state()).unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].provider, "openai");
        assert_eq!(configs[0].api_key, "sk-k***-bbb"); // masked
    }

    // ── CP-MC-2: get_model_configs 返回脱敏 api_key ────────────────────

    #[test]
    fn get_configs_returns_masked_keys() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        save_model_config(app.state(), make_input("deepseek", "DS", "sk-a1b2c3d4e5f6g7h8"))
            .unwrap();
        save_model_config(app.state(), make_input("openai", "OAI", "abc")).unwrap();

        let configs = get_model_configs(app.state()).unwrap();
        assert_eq!(configs[0].api_key, "sk-a***g7h8");
        assert_eq!(configs[1].api_key, "****");
    }

    // ── CP-MC-2: get_model_configs 空列表 ─────────────────────────────

    #[test]
    fn get_configs_empty() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let configs = get_model_configs(app.state()).unwrap();
        assert!(configs.is_empty());
    }

    // ── CP-MC-3: delete_model_config 拒绝删除激活模型 ──────────────────

    #[test]
    fn delete_rejects_active_model() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id = save_model_config(app.state(), make_input("deepseek", "DS", "sk-key")).unwrap();
        set_active_model(app.state(), id.clone()).unwrap();

        let err = delete_model_config(app.state(), id).unwrap_err();
        match err {
            SerializableError::InvalidState(msg) => {
                assert!(msg.contains("不能删除当前激活的模型"));
            }
            other => panic!("期望 InvalidState，实际: {other:?}"),
        }
    }

    // ── CP-MC-3: delete_model_config 成功删除非激活模型 ────────────────

    #[test]
    fn delete_removes_non_active_config() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id = save_model_config(app.state(), make_input("deepseek", "DS", "sk-key")).unwrap();
        delete_model_config(app.state(), id).unwrap();
        assert!(get_model_configs(app.state()).unwrap().is_empty());
    }

    // ── CP-MC-3: delete_model_config 不存在 id → NotFound ──────────────

    #[test]
    fn delete_non_existent_returns_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = delete_model_config(app.state(), "nonexistent-id".into()).unwrap_err();
        match err {
            SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("model_config:nonexistent-id"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── CP-MC-4: set_active_model 正常切换 ────────────────────────────

    #[test]
    fn set_active_switches_correctly() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id1 = save_model_config(app.state(), make_input("deepseek", "DS", "sk-1")).unwrap();
        let id2 = save_model_config(app.state(), make_input("openai", "OAI", "sk-2")).unwrap();

        // 先激活 id1
        set_active_model(app.state(), id1.clone()).unwrap();
        let active = get_active_model(app.state()).unwrap();
        assert_eq!(active.id, id1);

        // 切换到 id2
        set_active_model(app.state(), id2.clone()).unwrap();
        let active = get_active_model(app.state()).unwrap();
        assert_eq!(active.id, id2);
    }

    // ── CP-MC-4: set_active_model 事务原子性 ──────────────────────────

    #[test]
    fn set_active_only_one_active() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id1 = save_model_config(app.state(), make_input("deepseek", "DS", "sk-1")).unwrap();
        let id2 = save_model_config(app.state(), make_input("openai", "OAI", "sk-2")).unwrap();

        set_active_model(app.state(), id1).unwrap();

        // 查询所有配置，验证只有一个是 is_active
        let configs = get_model_configs(app.state()).unwrap();
        let active_count = configs.iter().filter(|c| c.is_active).count();
        assert_eq!(active_count, 1);

        set_active_model(app.state(), id2).unwrap();
        let configs = get_model_configs(app.state()).unwrap();
        let active_count = configs.iter().filter(|c| c.is_active).count();
        assert_eq!(active_count, 1);
    }

    // ── CP-MC-4: set_active_model 不存在 id → NotFound ────────────────

    #[test]
    fn set_active_non_existent_returns_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = set_active_model(app.state(), "nonexistent-id".into()).unwrap_err();
        match err {
            SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("model_config:nonexistent-id"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── CP-MC-5: get_active_model 返回完整 api_key ───────────────────

    #[test]
    fn get_active_returns_full_key() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id = save_model_config(
            app.state(),
            make_input("deepseek", "DS", "sk-full-key-here"),
        )
        .unwrap();
        set_active_model(app.state(), id).unwrap();

        let active = get_active_model(app.state()).unwrap();
        assert_eq!(active.api_key, "sk-full-key-here");
    }

    // ── CP-MC-5: get_active_model 无激活模型 → NotFound ───────────────

    #[test]
    fn get_active_when_none_returns_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = get_active_model(app.state()).unwrap_err();
        match err {
            SerializableError::NotFound { source_id } => {
                assert_eq!(source_id, "model_config:active");
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── CP-MC-6: get_model_api_key 返回完整 key ──────────────────────

    #[test]
    fn get_api_key_returns_full_key() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let id = save_model_config(
            app.state(),
            make_input("deepseek", "DS", "sk-secret-key-999"),
        )
        .unwrap();

        let key = get_model_api_key(app.state(), id).unwrap();
        assert_eq!(key, "sk-secret-key-999");
    }

    // ── CP-MC-6: get_model_api_key 不存在 id → NotFound ──────────────

    #[test]
    fn get_api_key_non_existent_returns_not_found() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        let err = get_model_api_key(app.state(), "nonexistent-id".into()).unwrap_err();
        match err {
            SerializableError::NotFound { source_id } => {
                assert!(source_id.contains("model_config:nonexistent-id"));
            }
            other => panic!("期望 NotFound，实际: {other:?}"),
        }
    }

    // ── CP-MC-7: label 不区分大小写唯一 ────────────────────────────

    #[test]
    fn label_case_insensitive_unique() {
        let db_state = setup_db();
        let app = tauri::test::mock_app();
        app.manage(db_state);

        save_model_config(app.state(), make_input("deepseek", "My Label", "sk-1")).unwrap();
        // 相同 label 不同大小写 → 更新而非新建
        let _id = save_model_config(app.state(), make_input("openai", "MY LABEL", "sk-2")).unwrap();

        let configs = get_model_configs(app.state()).unwrap();
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].provider, "openai");
    }

    // ── CP-ERR-3: DuplicateModelLabel → Duplicate 转换 ──────────────

    #[test]
    fn duplicate_label_error_converts_to_serializable() {
        let app_err = AppError::DuplicateModelLabel("label 'Test' already exists".into());
        let serializable: SerializableError = app_err.into();
        match serializable {
            SerializableError::Duplicate(msg) => {
                assert!(msg.contains("Test"));
            }
            other => panic!("期望 Duplicate，实际: {other:?}"),
        }
    }
}
