use crate::errors::CommandResult;
use log;

/// 前端日志桥接 Command。前端禁止直接使用 console.log，所有日志通过此命令发送到 Rust 侧统一处理。
#[tauri::command]
pub fn log_event(level: String, target: String, message: String) -> CommandResult<()> {
    match level.as_str() {
        "error" => log::error!(target: &target, "{}", message),
        "warn" => log::warn!(target: &target, "{}", message),
        "info" => log::info!(target: &target, "{}", message),
        "debug" => log::debug!(target: &target, "{}", message),
        _ => log::warn!(target: &target, "[未知级别: {}] {}", level, message),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── CP-LOG-2: log_event 返回 Ok(()) + 未知 level 回退到 warn ────────

    #[test]
    fn log_event_returns_ok_for_all_standard_levels() {
        assert!(log_event("error".into(), "test".into(), "msg".into()).is_ok());
        assert!(log_event("warn".into(), "test".into(), "msg".into()).is_ok());
        assert!(log_event("info".into(), "test".into(), "msg".into()).is_ok());
        assert!(log_event("debug".into(), "test".into(), "msg".into()).is_ok());
    }

    #[test]
    fn log_event_unknown_level_returns_ok() {
        let result = log_event("critical".into(), "test".into(), "msg".into());
        assert!(result.is_ok(), "未知日志级别不应 panic");
    }

    #[test]
    fn log_event_empty_string_level_returns_ok() {
        let result = log_event("".into(), "test".into(), "msg".into());
        assert!(result.is_ok(), "空字符串 level 不应 panic");
    }

    #[test]
    fn log_event_unicode_message_returns_ok() {
        let result =
            log_event("info".into(), "test".into(), "中文日志消息 🎯".into());
        assert!(result.is_ok(), "Unicode 消息不应 panic");
    }
}
