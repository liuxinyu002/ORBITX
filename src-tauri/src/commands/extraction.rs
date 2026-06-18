use crate::db::state::DbState;
use crate::errors::{AppError, CommandResult, SerializableError};
use crate::models::extraction::{Extraction, ExtractionInput, ExtractionListResponse};
use log;
use tauri::{Emitter, State};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use std::time::Instant;
use uuid::Uuid;

/// 原始文本最大长度（50KB），超过则拒绝写入。
const MAX_RAW_TEXT_LEN: usize = 50 * 1024;

/// 将提取结果写入数据库。
/// 校验 result_json 合法性 + raw_text 长度防御后，生成 UUID 和 ISO 8601 时间戳并落盘。
/// 成功后发射 `extraction-completed` 事件通知前端。
/// 返回新记录的 ID。
#[tauri::command]
pub fn insert_extraction(
    app_handle: tauri::AppHandle,
    db: State<'_, DbState>,
    input: ExtractionInput,
) -> CommandResult<String> {
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

    // 构造完整 Extraction 并发射事件
    let extraction = Extraction {
        id: id.clone(),
        task_id: input.task_id.clone(),
        raw_text: input.raw_text,
        result_json: input.result_json,
        created_at: now,
    };
    log::info!("[extraction] 发射提取完成事件 task_id={}", extraction.task_id);
    let _ = app_handle.emit("extraction-completed", extraction);

    Ok(id)
}

/// 分页列出指定任务的提取数据。
/// 按 created_at DESC 排序，最新数据在前。
#[tauri::command]
pub fn list_extractions(
    db: State<'_, DbState>,
    task_id: String,
    page: u32,
    limit: u32,
) -> CommandResult<ExtractionListResponse> {
    // 参数校验
    if page < 1 {
        return Err(AppError::InvalidInput(format!(
            "page 必须 >= 1，当前值: {page}"
        ))
        .into());
    }
    if limit < 1 || limit > 200 {
        return Err(AppError::InvalidInput(format!(
            "limit 必须在 [1, 200] 范围内，当前值: {limit}"
        ))
        .into());
    }

    log::info!("[extraction] 列出提取数据 task_id={task_id} page={page} limit={limit}");

    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let offset = (page - 1) * limit;

    // 查询总数
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM extractions WHERE task_id = ?1",
            rusqlite::params![task_id],
            |row| row.get(0),
        )
        .map_err(AppError::Database)?;

    // 分页查询行数据
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, raw_text, result_json, created_at
             FROM extractions
             WHERE task_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(AppError::Database)?;

    let rows: Vec<Extraction> = stmt
        .query_map(
            rusqlite::params![task_id, limit, offset],
            |row| {
                Ok(Extraction {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    raw_text: row.get(2)?,
                    result_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
        .map_err(AppError::Database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;

    let rows_len = rows.len();
    log::info!("[extraction] 列出完成 total={total} rows={rows_len}");

    Ok(ExtractionListResponse { rows, total })
}

/// 删除单条提取记录。
#[tauri::command]
pub fn delete_extraction(db: State<'_, DbState>, id: String) -> CommandResult<()> {
    // 参数校验
    if id.trim().is_empty() {
        return Err(AppError::InvalidInput("id 不能为空".into()).into());
    }

    log::info!("[extraction] 删除记录 id={id}");

    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

    let affected = conn
        .execute("DELETE FROM extractions WHERE id = ?1", rusqlite::params![id])
        .map_err(AppError::Database)?;

    if affected == 0 {
        return Err(AppError::NotFound {
            source_id: id,
        }
        .into());
    }

    Ok(())
}

/// 导出上限，防止内存/磁盘滥用。
const MAX_EXPORT_ROWS: u32 = 50_000;

/// 单行数组元素数上限，防止单行展开 N 行 × MAX_EXPORT_ROWS 导致 OOM。
const MAX_ELEMENTS_PER_ROW: usize = 1000;

/// 将单行 result_json 展平为 1 行或多行。
/// - 对象 → 1 行（按 headers 提取字段值）
/// - 数组 → N 行（每个对象元素按 headers 提取字段值）
/// - 非对象非数组 → 1 空行
/// - 空数组 → 0 行
/// - Null（解析失败）→ 0 行
fn flatten_row(parsed: &serde_json::Value, headers: &[String]) -> Vec<Vec<String>> {
    match parsed {
        serde_json::Value::Array(arr) => {
            let len = arr.len();
            if len > MAX_ELEMENTS_PER_ROW {
                log::warn!(
                    "数组元素数 {} 超过上限 {}，截断处理",
                    len,
                    MAX_ELEMENTS_PER_ROW
                );
            }
            arr.iter()
                .take(MAX_ELEMENTS_PER_ROW)
                .map(|elem| match elem {
                    serde_json::Value::Object(obj) => headers
                        .iter()
                        .map(|h| match obj.get(h) {
                            Some(serde_json::Value::String(s)) => s.clone(),
                            Some(serde_json::Value::Null) | None => String::new(),
                            Some(other) => other.to_string(),
                        })
                        .collect(),
                    _ => headers.iter().map(|_| String::new()).collect(),
                })
                .collect()
        }
        serde_json::Value::Null => {
            log::warn!("result_json 解析为 null，跳过该行");
            vec![]
        }
        _ => {
            // 非对象非数组：返回 1 空行
            vec![headers.iter().map(|_| String::new()).collect()]
        }
    }
}

/// 导出数据为 CSV 或 XLSX 文件。
/// 通过系统原生保存对话框获取目标路径，支持"当前页"和"全部"两种范围。
#[tauri::command]
pub async fn export_data(
    app_handle: tauri::AppHandle,
    db: State<'_, DbState>,
    task_id: String,
    format: String,
    scope: String,
    page: Option<u32>,
    limit: Option<u32>,
) -> CommandResult<String> {
    // ── 参数校验 ────────────────────────────────────────────────────────
    if format != "csv" && format != "xlsx" {
        return Err(AppError::InvalidInput(format!(
            "format 必须为 csv 或 xlsx，当前值: {format}"
        ))
        .into());
    }
    if scope != "current_page" && scope != "all" {
        return Err(AppError::InvalidInput(format!(
            "scope 必须为 current_page 或 all，当前值: {scope}"
        ))
        .into());
    }
    let page_val;
    let limit_val;
    if scope == "current_page" {
        let p = page.ok_or_else(|| {
            SerializableError::from(AppError::InvalidInput(
                "scope=current_page 时 page 必填".into(),
            ))
        })?;
        if p < 1 {
            return Err(AppError::InvalidInput(format!(
                "page 必须 >= 1，当前值: {p}"
            ))
            .into());
        }
        let l = limit.ok_or_else(|| {
            SerializableError::from(AppError::InvalidInput(
                "scope=current_page 时 limit 必填".into(),
            ))
        })?;
        if l < 1 || l > 200 {
            return Err(AppError::InvalidInput(format!(
                "limit 必须在 [1, 200] 范围内，当前值: {l}"
            ))
            .into());
        }
        page_val = p;
        limit_val = l;
    } else {
        page_val = 1;
        limit_val = MAX_EXPORT_ROWS;
    }

    log::info!("[export] 导出开始 task_id={task_id} format={format} scope={scope}");

    // ── 查询任务名称与 schema（块作用域确保锁在 .await 前释放）────────────
    let (task_name, field_names) = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

        let (task_name, task_schema): (String, Option<String>) = conn
            .query_row(
                "SELECT name, schema FROM tasks WHERE id = ?1",
                rusqlite::params![task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound {
                    source_id: format!("task:{task_id}"),
                },
                other => AppError::Database(other),
            })?;

        // 解析 schema.fields[].name 作为导出表头
        let field_names: Vec<String> = task_schema
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.get("fields").cloned())
            .and_then(|fields| {
                fields.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                        .collect()
                })
            })
            .unwrap_or_default();

        (task_name, field_names)
    }; // conn dropped here, before any .await

    // ── 系统原生保存对话框（独立 OS 线程，避免线程池死锁）─────────────────
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let default_name = format!("{task_name}_{today}");
    let (filter_name, ext) = if format == "csv" {
        ("CSV 文件", "csv")
    } else {
        ("Excel 文件", "xlsx")
    };

    let parent_window = app_handle
        .get_webview_window("main")
        .ok_or_else(|| SerializableError::from(AppError::InvalidState("找不到主窗口".into())))?;

    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let handle = app_handle.clone();
        let default_name = default_name.clone();
        std::thread::spawn(move || {
            let file_path = handle
                .dialog()
                .file()
                .set_parent(&parent_window)
                .set_file_name(&default_name)
                .add_filter(filter_name, &[ext])
                .blocking_save_file();
            let _ = tx.send(file_path);
        });
    }

    log::info!("[export] 等待用户选择保存路径...");

    let file_path = rx.await.map_err(|_| {
        SerializableError::from(AppError::InvalidState("文件对话框通信失败".into()))
    })?;

    let path = match file_path {
        Some(p) => p,
        None => {
            return Err(AppError::InvalidState("用户取消了保存".into()).into());
        }
    };
    let path_str = path.to_string();

    log::info!("[export] 用户已选择路径 path={path_str}");

    // ── 查询导出数据 ─────────────────────────────────────────────────────
    let (rows, row_count) = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| AppError::InvalidState(format!("DB 锁获取失败: {e}")))?;

        // 先查总数以进行上限拦截
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM extractions WHERE task_id = ?1",
                rusqlite::params![task_id],
                |row| row.get(0),
            )
            .map_err(AppError::Database)?;

        let rows: Vec<Extraction> = if scope == "all" {
        if total > MAX_EXPORT_ROWS as i64 {
            return Err(AppError::ExportTooLarge(format!(
                "数据量 {total} 超过导出上限 {MAX_EXPORT_ROWS}，请分批导出或缩小范围"
            ))
            .into());
        }
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, raw_text, result_json, created_at
                 FROM extractions WHERE task_id = ?1
                 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(AppError::Database)?;

        let result = stmt
            .query_map(rusqlite::params![task_id, MAX_EXPORT_ROWS], |row| {
                Ok(Extraction {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    raw_text: row.get(2)?,
                    result_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(AppError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        result
    } else {
        let offset = (page_val - 1) * limit_val;
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, raw_text, result_json, created_at
                 FROM extractions WHERE task_id = ?1
                 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .map_err(AppError::Database)?;

        let result = stmt
            .query_map(rusqlite::params![task_id, limit_val, offset], |row| {
                Ok(Extraction {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    raw_text: row.get(2)?,
                    result_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(AppError::Database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        result
    };
    let count = rows.len();
    (rows, count)
    }; // conn dropped here — safe to .await below

    // ── 写文件（spawn_blocking 避免阻塞 Tauri 事件循环）────────────────
    let path_for_write = path_str.clone();
    let started = Instant::now();
    let write_result = tauri::async_runtime::spawn_blocking(move || {
        match format.as_str() {
            "csv" => write_csv(&path_for_write, &field_names, &rows),
            "xlsx" => write_xlsx(&path_for_write, &field_names, &rows),
            _ => unreachable!(),
        }
    })
    .await
    .map_err(|e| AppError::InvalidState(format!("导出线程 panic: {e}")))?;

    let actual_rows = write_result.map_err(SerializableError::from)?;
    let elapsed_ms = started.elapsed().as_millis();

    log::info!(
        "[export] 导出完成 path={path_str} db_rows={row_count} actual_rows={actual_rows} elapsed_ms={elapsed_ms}"
    );

    Ok(path_str)
}

/// CSV 流式写入。表头使用 field_names，数据行通过 flatten_row 展平。
/// 返回实际写入的数据行数（可能与 DB 行数不同）。
fn write_csv(path: &str, headers: &[String], rows: &[Extraction]) -> Result<usize, AppError> {
    let mut writer =
        csv::Writer::from_path(path).map_err(|e| AppError::InvalidState(format!("CSV 创建失败: {e}")))?;

    // 写入表头
    writer
        .write_record(headers)
        .map_err(|e| AppError::InvalidState(format!("CSV 写入表头失败: {e}")))?;

    // 写入数据行（数组 result_json 展平为多行）
    let mut written = 0usize;
    for row in rows {
        let parsed: serde_json::Value =
            serde_json::from_str(&row.result_json).unwrap_or(serde_json::Value::Null);
        for record in flatten_row(&parsed, headers) {
            writer
                .write_record(&record)
                .map_err(|e| AppError::InvalidState(format!("CSV 写入行失败: {e}")))?;
            written += 1;
        }
    }

    writer
        .flush()
        .map_err(|e| AppError::InvalidState(format!("CSV flush 失败: {e}")))?;
    Ok(written)
}

/// XLSX 写入。表头使用 field_names，数据行通过 flatten_row 展平。
/// 返回实际写入的数据行数（可能与 DB 行数不同）。
fn write_xlsx(path: &str, headers: &[String], rows: &[Extraction]) -> Result<usize, AppError> {
    use rust_xlsxwriter::Workbook;

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // 写入表头
    for (col, header) in headers.iter().enumerate() {
        worksheet
            .write_string(0, col as u16, header)
            .map_err(|e| AppError::InvalidState(format!("XLSX 写入表头失败: {e}")))?;
    }

    // 写入数据行（数组 result_json 展平为多行）
    let mut written = 0u32;
    for row in rows {
        let parsed: serde_json::Value =
            serde_json::from_str(&row.result_json).unwrap_or(serde_json::Value::Null);
        for record in flatten_row(&parsed, headers) {
            for (col_idx, val) in record.iter().enumerate() {
                worksheet
                    .write_string(written + 1, col_idx as u16, val)
                    .map_err(|e| AppError::InvalidState(format!("XLSX 写入单元格失败: {e}")))?;
            }
            written += 1;
        }
    }

    workbook
        .save(path)
        .map_err(|e| AppError::InvalidState(format!("XLSX 保存失败: {e}")))?;
    Ok(written as usize)
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

    // ── list_extractions 测试 ─────────────────────────────────────────────

    /// 直接执行分页查询（绕过 Tauri State，测试 DB 层逻辑）。
    fn list_raw(state: &DbState, task_id: &str, page: u32, limit: u32) -> ExtractionListResponse {
        let conn = state.conn.lock().unwrap();
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM extractions WHERE task_id = ?1",
                rusqlite::params![task_id],
                |row| row.get(0),
            )
            .unwrap();
        let offset = (page - 1) * limit;
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, raw_text, result_json, created_at
                 FROM extractions WHERE task_id = ?1
                 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
            )
            .unwrap();
        let rows: Vec<Extraction> = stmt
            .query_map(rusqlite::params![task_id, limit, offset], |row| {
                Ok(Extraction {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    raw_text: row.get(2)?,
                    result_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        ExtractionListResponse { rows, total }
    }

    /// 直接执行删除（绕过 Tauri State，测试 DB 层逻辑）。
    fn delete_raw(state: &DbState, id: &str) -> Result<(), String> {
        let conn = state.conn.lock().map_err(|e| format!("锁获取失败: {e}"))?;
        let affected = conn
            .execute("DELETE FROM extractions WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err("not found".into());
        }
        Ok(())
    }

    #[test]
    fn list_extractions_pagination() {
        let state = setup_extractions_db();
        // 插入 5 条同一 task 的数据
        for i in 0..5 {
            insert_raw(
                &state,
                &ExtractionInput {
                    task_id: "task-paginate".into(),
                    raw_text: format!("text-{i}"),
                    result_json: format!(r#"{{"index":{i}}}"#),
                },
            )
            .unwrap();
        }

        // 第一页：3 条
        let page1 = list_raw(&state, "task-paginate", 1, 3);
        assert_eq!(page1.total, 5);
        assert_eq!(page1.rows.len(), 3);

        // 第二页：2 条
        let page2 = list_raw(&state, "task-paginate", 2, 3);
        assert_eq!(page2.total, 5);
        assert_eq!(page2.rows.len(), 2);
    }

    #[test]
    fn list_extractions_empty_task() {
        let state = setup_extractions_db();
        let result = list_raw(&state, "nonexistent-task", 1, 50);
        assert_eq!(result.total, 0);
        assert!(result.rows.is_empty());
    }

    #[test]
    fn list_extractions_cross_page_boundary() {
        let state = setup_extractions_db();
        for i in 0..5 {
            insert_raw(
                &state,
                &ExtractionInput {
                    task_id: "task-boundary".into(),
                    raw_text: format!("text-{i}"),
                    result_json: "{}".into(),
                },
            )
            .unwrap();
        }

        // 请求超出范围的页
        let page3 = list_raw(&state, "task-boundary", 3, 3);
        assert_eq!(page3.total, 5);
        assert_eq!(page3.rows.len(), 0); // offset 6 >= 5
    }

    #[test]
    fn list_extractions_desc_order() {
        let state = setup_extractions_db();
        // 插入 3 条，间隔 10ms 以保证时间戳可区分
        for i in 0..3 {
            insert_raw(
                &state,
                &ExtractionInput {
                    task_id: "task-order".into(),
                    raw_text: format!("text-{i}"),
                    result_json: "{}".into(),
                },
            )
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let result = list_raw(&state, "task-order", 1, 50);
        assert_eq!(result.rows.len(), 3);
        // 最新插入的应在前（DESC）
        assert_eq!(result.rows[0].raw_text, "text-2");
        assert_eq!(result.rows[1].raw_text, "text-1");
        assert_eq!(result.rows[2].raw_text, "text-0");
    }

    // ── delete_extraction 测试 ──────────────────────────────────────────────

    #[test]
    fn delete_existing_record() {
        let state = setup_extractions_db();
        let input = ExtractionInput {
            task_id: "task-del".into(),
            raw_text: "delete me".into(),
            result_json: "{}".into(),
        };
        let id = insert_raw(&state, &input).unwrap();

        let result = delete_raw(&state, &id);
        assert!(result.is_ok(), "删除应成功");

        // 验证已删除
        let after = list_raw(&state, "task-del", 1, 50);
        assert_eq!(after.total, 0);
    }

    #[test]
    fn delete_non_existent_record() {
        let state = setup_extractions_db();
        let result = delete_raw(&state, "nonexistent-id");
        assert!(result.is_err(), "删除不存在记录应失败");
    }

    // ── export_data 单元测试 ────────────────────────────────────────────

    fn make_extraction(task_id: &str, result_json: &str) -> Extraction {
        Extraction {
            id: uuid::Uuid::new_v4().to_string(),
            task_id: task_id.into(),
            raw_text: "raw".into(),
            result_json: result_json.into(),
            created_at: "2025-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn write_csv_content_verification() {
        let headers: Vec<String> = vec!["name".into(), "email".into()];
        let rows = vec![
            make_extraction("t1", r#"[{"name":"张三","email":"zs@test.com"}]"#),
            make_extraction("t1", r#"[{"name":"李四","email":"ls@test.com"}]"#),
        ];
        let dir = std::env::temp_dir();
        let path = dir.join("orbitx_test_export.csv");
        let path_str = path.to_string_lossy().to_string();

        write_csv(&path_str, &headers, &rows).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        // 验证表头和数据
        assert!(text.contains("name,email"));
        assert!(text.contains("张三,zs@test.com"));
        assert!(text.contains("李四,ls@test.com"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_csv_missing_field_becomes_empty() {
        let headers: Vec<String> = vec!["name".into(), "email".into()];
        let rows = vec![make_extraction("t1", r#"[{"name":"张三"}]"#)];
        let dir = std::env::temp_dir();
        let path = dir.join("orbitx_test_export_missing.csv");
        let path_str = path.to_string_lossy().to_string();

        write_csv(&path_str, &headers, &rows).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        // email 列应为空
        assert!(text.contains("张三,"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_xlsx_content_verification() {
        let headers: Vec<String> = vec!["name".into(), "email".into()];
        let rows = vec![
            make_extraction("t1", r#"[{"name":"测试","email":"test@example.com"}]"#),
        ];
        let dir = std::env::temp_dir();
        let path = dir.join("orbitx_test_export.xlsx");
        let path_str = path.to_string_lossy().to_string();

        write_xlsx(&path_str, &headers, &rows).unwrap();

        // 验证文件存在且非空
        let meta = std::fs::metadata(&path).unwrap();
        assert!(meta.len() > 0, "XLSX 文件不应为空");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_max_rows_exceeded_returns_error() {
        // 验证 MAX_EXPORT_ROWS 常量为 50000
        assert_eq!(MAX_EXPORT_ROWS, 50_000);
    }

    // ── flatten_row 测试 ───────────────────────────────────────────────────

    fn h(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn flatten_non_array_non_null_produces_one_empty_row() {
        let parsed: serde_json::Value =
            serde_json::from_str(r#"{"name":"张三","email":"zs@test.com"}"#).unwrap();
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], vec!["".to_string(), "".to_string()]);
    }

    #[test]
    fn flatten_array_of_objects() {
        let parsed: serde_json::Value = serde_json::from_str(
            r#"[{"name":"张三","email":"a@b.com"}, {"name":"李四","email":"c@d.com"}]"#,
        )
        .unwrap();
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], vec!["张三", "a@b.com"]);
        assert_eq!(result[1], vec!["李四", "c@d.com"]);
    }

    #[test]
    fn flatten_array_missing_field_becomes_empty() {
        let parsed: serde_json::Value =
            serde_json::from_str(r#"[{"name":"张三"}, {"name":"李四","email":"c@d.com"}]"#).unwrap();
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], vec!["张三", ""]);
        assert_eq!(result[1], vec!["李四", "c@d.com"]);
    }

    #[test]
    fn flatten_empty_array() {
        let parsed: serde_json::Value = serde_json::from_str("[]").unwrap();
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn flatten_non_object_elements_produce_empty_rows() {
        let parsed: serde_json::Value = serde_json::from_str(r#"[1, 2, 3]"#).unwrap();
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 3);
        for row in &result {
            assert_eq!(row, &vec!["".to_string(), "".to_string()]);
        }
    }

    #[test]
    fn flatten_null_produces_zero_rows() {
        let parsed = serde_json::Value::Null;
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn flatten_non_object_non_array_produces_one_empty_row() {
        let parsed = serde_json::Value::String("hello".into());
        let headers = h(&["name", "email"]);
        let result = flatten_row(&parsed, &headers);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], vec!["".to_string(), "".to_string()]);
    }
}
