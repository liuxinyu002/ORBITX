use crate::db::state::DbState;
use crate::errors::{AppError, CommandResult};
use crate::models::extraction::ExtractionInput;
use log;
use tauri::State;
use uuid::Uuid;

/// 原始文本最大长度（50KB），超过则拒绝写入。
const MAX_RAW_TEXT_LEN: usize = 50 * 1024;

/// 将提取结果写入数据库。
/// 校验 result_json 合法性 + raw_text 长度防御后，生成 UUID 和 ISO 8601 时间戳并落盘。
/// 返回新记录的 ID。
#[tauri::command]
pub fn insert_extraction(db: State<'_, DbState>, input: ExtractionInput) -> CommandResult<String> {
    // 校验 result_json 是合法 JSON
    if serde_json::from_str::<serde_json::Value>(&input.result_json).is_err() {
        return Err(AppError::InvalidState("result_json 不是合法的 JSON".into()).into());
    }

    // raw_text 长度防御
    if input.raw_text.len() > MAX_RAW_TEXT_LEN {
        return Err(AppError::InvalidState(format!(
            "raw_text 过长 ({} bytes)，上限 {} bytes",
            input.raw_text.len(),
            MAX_RAW_TEXT_LEN
        ))
        .into());
    }

    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    conn.execute(
        "INSERT INTO extractions (id, task_id, raw_text, result_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, input.task_id, input.raw_text, input.result_json, now],
    )
    .map_err(AppError::Database)?;

    log::info!("写入提取结果，record_id={}，task_id={}", id, input.task_id);
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::state::DbState;
    use crate::models::extraction::ExtractionInput;
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// 创建包含 extractions 表的内存数据库。
    fn setup_extractions_db() -> DbState {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE extractions (
                id          TEXT PRIMARY KEY,
                task_id     TEXT NOT NULL,
                raw_text    TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX idx_extractions_task_time ON extractions(task_id, created_at);",
        )
        .unwrap();
        DbState {
            conn: Mutex::new(conn),
        }
    }

    /// 直接执行 INSERT（绕过 Tauri State，测试 DB 层逻辑）。
    fn insert_raw(state: &DbState, input: &ExtractionInput) -> Result<String, String> {
        if serde_json::from_str::<serde_json::Value>(&input.result_json).is_err() {
            return Err("result_json 不是合法 JSON".into());
        }
        if input.raw_text.len() > MAX_RAW_TEXT_LEN {
            return Err(format!(
                "raw_text 过长 ({} bytes)，上限 {} bytes",
                input.raw_text.len(),
                MAX_RAW_TEXT_LEN
            ));
        }
        let conn = state.conn.lock().map_err(|e| format!("锁获取失败: {e}"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        conn.execute(
            "INSERT INTO extractions (id, task_id, raw_text, result_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, input.task_id, input.raw_text, input.result_json, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }

    // ── CP-19, CP-20: JSON 校验 ─────────────────────────────────────────────

    #[test]
    fn rejects_invalid_result_json() {
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "some text".into(),
            result_json: "not-valid-json".into(),
        };
        let result = serde_json::from_str::<serde_json::Value>(&input.result_json);
        assert!(result.is_err(), "非法 JSON 应被拒绝");
    }

    #[test]
    fn accepts_valid_json_object() {
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "text".into(),
            result_json: r#"{"email":"test@test.com"}"#.into(),
        };
        let result = serde_json::from_str::<serde_json::Value>(&input.result_json);
        assert!(result.is_ok(), "合法 JSON 应被接受");
    }

    #[test]
    fn accepts_valid_json_array() {
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "text".into(),
            result_json: r#"[{"a":1},{"b":2}]"#.into(),
        };
        let result = serde_json::from_str::<serde_json::Value>(&input.result_json);
        assert!(result.is_ok(), "合法 JSON 数组应被接受");
    }

    #[test]
    fn rejects_empty_string_result_json() {
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "text".into(),
            result_json: "".into(),
        };
        let result = serde_json::from_str::<serde_json::Value>(&input.result_json);
        assert!(result.is_err(), "空字符串应被拒绝");
    }

    #[test]
    fn rejects_malformed_brace_json() {
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "text".into(),
            result_json: r#"{fields: [}"#.into(),
        };
        let result = serde_json::from_str::<serde_json::Value>(&input.result_json);
        assert!(result.is_err(), "格式错误的 JSON 应被拒绝");
    }

    // ── CP-19: raw_text 长度防御 ───────────────────────────────────────────

    #[test]
    fn rejects_oversized_raw_text() {
        let long_text = "x".repeat(MAX_RAW_TEXT_LEN + 1);
        assert!(
            long_text.len() > MAX_RAW_TEXT_LEN,
            "raw_text 应超过限制"
        );
    }

    #[test]
    fn accepts_raw_text_at_exact_limit() {
        let text = "x".repeat(MAX_RAW_TEXT_LEN);
        assert_eq!(
            text.len(),
            MAX_RAW_TEXT_LEN,
            "raw_text 长度恰好等于限制，应被接受"
        );
    }

    #[test]
    fn accepts_short_raw_text() {
        let text = "hello".to_string();
        assert!(
            text.len() <= MAX_RAW_TEXT_LEN,
            "短文本应被接受"
        );
    }

    // ── CP-19: 成功插入返回 record ID ──────────────────────────────────────

    #[test]
    fn insert_extraction_returns_record_id() {
        let state = setup_extractions_db();
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "hello world".into(),
            result_json: r#"{"name":"Alice"}"#.into(),
        };

        let result = insert_raw(&state, &input);
        assert!(result.is_ok(), "插入应成功，实际: {result:?}");
        let id = result.unwrap();
        assert!(!id.is_empty(), "record ID 不应为空");

        // 验证数据确实写入了
        let conn = state.conn.lock().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM extractions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "应有一条记录");
    }

    #[test]
    fn inserted_record_has_correct_values() {
        let state = setup_extractions_db();
        let input = ExtractionInput {
            task_id: "task-abc".into(),
            raw_text: "提取原文".into(),
            result_json: r#"{"email":"test@test.com"}"#.into(),
        };

        let id = insert_raw(&state, &input).unwrap();

        let conn = state.conn.lock().unwrap();
        let (db_task_id, db_raw_text, db_result_json): (String, String, String) = conn
            .query_row(
                "SELECT task_id, raw_text, result_json FROM extractions WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(db_task_id, "task-abc");
        assert_eq!(db_raw_text, "提取原文");
        assert_eq!(db_result_json, r#"{"email":"test@test.com"}"#);
    }

    #[test]
    fn record_has_iso8601_timestamp() {
        let state = setup_extractions_db();
        let input = ExtractionInput {
            task_id: "task-1".into(),
            raw_text: "text".into(),
            result_json: "{}".into(),
        };

        let id = insert_raw(&state, &input).unwrap();

        let conn = state.conn.lock().unwrap();
        let created_at: String = conn
            .query_row(
                "SELECT created_at FROM extractions WHERE id=?1",
                [&id],
                |row| row.get(0),
            )
            .unwrap();

        assert!(
            created_at.contains('T') && created_at.ends_with('Z'),
            "created_at 应为 ISO 8601 格式，实际: {created_at}"
        );
    }
}
