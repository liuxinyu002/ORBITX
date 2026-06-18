use rusqlite;
use serde::Serialize;
use thiserror::Error;

/// 内部错误类型，覆盖所有后端错误场景。
#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库操作失败: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("资源未找到: {source_id}")]
    NotFound { source_id: String },

    #[error("无效状态: {0}")]
    InvalidState(String),

    #[error("无效输入: {0}")]
    InvalidInput(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("标签重复: {0}")]
    DuplicateModelLabel(String),

    #[error("导出数据量过大: {0}")]
    ExportTooLarge(String),
}

/// 可序列化的错误 DTO，通过 Tauri Command 返回给前端。
#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum SerializableError {
    Database(String),
    NotFound { source_id: String },
    InvalidState(String),
    InvalidInput(String),
    Network(String),
    Duplicate(String),
    ExportTooLarge(String),
}

impl From<AppError> for SerializableError {
    fn from(e: AppError) -> Self {
        match e {
            AppError::Database(e) => SerializableError::Database(e.to_string()),
            AppError::NotFound { source_id } => SerializableError::NotFound { source_id },
            AppError::InvalidState(msg) => SerializableError::InvalidState(msg),
            AppError::InvalidInput(msg) => SerializableError::InvalidInput(msg),
            AppError::Io(e) => SerializableError::InvalidState(format!("IO error: {e}")),
            AppError::DuplicateModelLabel(msg) => SerializableError::Duplicate(msg),
            AppError::ExportTooLarge(msg) => SerializableError::ExportTooLarge(msg),
        }
    }
}

/// 所有 Tauri Command 的统一返回类型。
pub type CommandResult<T> = Result<T, SerializableError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializable_error_json_format() {
        let err = SerializableError::Database("table not found".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, r#"{"type":"Database","message":"table not found"}"#);
    }

    #[test]
    fn not_found_includes_source_id() {
        let err = SerializableError::NotFound {
            source_id: "task-123".into(),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"type":"NotFound","message":{"source_id":"task-123"}}"#
        );
    }

    #[test]
    fn app_error_database_converts_to_serializable() {
        let app_err = AppError::InvalidState("DB mutex lock poisoned".into());
        let serializable: SerializableError = app_err.into();
        match serializable {
            SerializableError::InvalidState(msg) => {
                assert_eq!(msg, "DB mutex lock poisoned");
            }
            _ => panic!("expected InvalidState"),
        }
    }

    #[test]
    fn app_error_io_converts_to_invalid_state() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err = AppError::Io(io_err);
        let serializable: SerializableError = app_err.into();
        match serializable {
            SerializableError::InvalidState(msg) => {
                assert!(msg.starts_with("IO error:"));
            }
            _ => panic!("expected InvalidState"),
        }
    }
}
