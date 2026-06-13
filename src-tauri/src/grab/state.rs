use std::collections::VecDeque;

use crate::grab::{GrabError, GrabResult, GrabSource};

/// 队列最大容量
pub const MAX_QUEUE_SIZE: usize = 16;

/// 信封存活时间（毫秒），超时自动淘汰
pub const ENVELOPE_TTL_MS: u64 = 30_000;

/// 单次抓取的结果信封，不包含文本 payload。
#[derive(Debug, Clone)]
pub struct GrabEnvelope {
    pub request_id: String,
    pub source: GrabSource,
    pub result: Result<GrabResult, GrabError>,
    pub created_at_ms: u64,
}

/// 线程安全的抓取结果队列。按 `request_id` 定向消费。
pub struct GrabState(pub std::sync::Mutex<VecDeque<GrabEnvelope>>);

impl GrabState {
    pub fn new() -> Self {
        GrabState(std::sync::Mutex::new(VecDeque::new()))
    }

    /// 入队新信封。超限时淘汰最旧项。
    pub fn push(&self, envelope: GrabEnvelope) {
        let mut queue = self
            .0
            .lock()
            .expect("GrabState Mutex 不应被污染");
        while queue.len() >= MAX_QUEUE_SIZE {
            let old = queue.pop_front();
            log::warn!(
                target: "grab",
                "抓取队列已满（{}），淘汰旧信封 request_id={}",
                MAX_QUEUE_SIZE,
                old.map(|e| e.request_id).unwrap_or_default()
            );
        }
        queue.push_back(envelope);
    }

    /// 清空队列中所有信封。用于 shutdown 清理路径。
    pub fn clear(&self) {
        let mut queue = self
            .0
            .lock()
            .expect("GrabState Mutex 不应被污染");
        queue.clear();
    }

    /// 按 `request_id` 消费信封。先淘汰所有过期项，再查找匹配项。
    /// 返回 `Ok(None)` 表示未找到。
    pub fn consume(&self, request_id: &str) -> Result<Option<Result<GrabResult, GrabError>>, GrabError> {
        let mut queue = self
            .0
            .lock()
            .map_err(|e| GrabError::Internal(format!("GrabState Mutex 已污染: {e}")))?;

        // 淘汰过期信封
        let now = timestamp_ms();
        let expired_count = queue.iter().take_while(|e| now.saturating_sub(e.created_at_ms) > ENVELOPE_TTL_MS).count();
        for _ in 0..expired_count {
            if let Some(old) = queue.pop_front() {
                log::debug!(
                    target: "grab",
                    "淘汰过期信封 request_id={} (已存活 {}ms)",
                    old.request_id,
                    now - old.created_at_ms
                );
            }
        }

        // 查找匹配项
        if let Some(pos) = queue.iter().position(|e| e.request_id == request_id) {
            let envelope = queue.remove(pos).expect("刚确认存在");
            Ok(Some(envelope.result))
        } else {
            Ok(None)
        }
    }
}

fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grab::{GrabResult, GrabSource};

    /// Helper: 返回当前时间戳，所有测试用相对时间避免 TTL 误淘汰。
    fn now() -> u64 {
        timestamp_ms()
    }

    fn make_envelope(id: &str, created_at_ms: u64) -> GrabEnvelope {
        GrabEnvelope {
            request_id: id.to_string(),
            source: GrabSource::ShortcutA,
            result: Ok(GrabResult {
                text: "test".into(),
                truncated: false,
            }),
            created_at_ms,
        }
    }

    fn make_err_envelope(id: &str, created_at_ms: u64) -> GrabEnvelope {
        GrabEnvelope {
            request_id: id.to_string(),
            source: GrabSource::ShortcutA,
            result: Err(GrabError::NoSelection),
            created_at_ms,
        }
    }

    #[test]
    fn push_then_consume_exact_match() {
        let state = GrabState::new();
        let base = now();
        state.push(make_envelope("req-1", base));
        let result = state.consume("req-1").unwrap();
        assert!(result.is_some());
        let inner = result.unwrap().unwrap();
        assert_eq!(inner.text, "test");
        assert!(!inner.truncated);
    }

    #[test]
    fn consume_returns_none_for_wrong_id() {
        let state = GrabState::new();
        let base = now();
        state.push(make_envelope("req-1", base));
        let result = state.consume("req-2").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn consume_returns_none_for_empty_queue() {
        let state = GrabState::new();
        let result = state.consume("req-1").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn push_evicts_oldest_when_queue_full() {
        let state = GrabState::new();
        let base = now();
        // 填满 16 条
        for i in 0..MAX_QUEUE_SIZE {
            state.push(make_envelope(&format!("req-{}", i), base + i as u64));
        }
        // 第 17 条：淘汰 req-0
        state.push(make_envelope("req-overflow", base + 100));
        // req-0 被淘汰
        assert!(state.consume("req-0").unwrap().is_none());
        // req-1 到 req-15 仍在（16 条中，req-0 被淘汰，overflow 还在）
        assert!(state.consume("req-1").unwrap().is_some());
        assert!(state.consume("req-overflow").unwrap().is_some());
    }

    #[test]
    fn consume_removes_only_matching_envelope() {
        let state = GrabState::new();
        let base = now();
        state.push(make_envelope("req-1", base));
        state.push(make_envelope("req-2", base + 1));
        state.push(make_envelope("req-3", base + 2));

        // 消费中间的
        let result = state.consume("req-2").unwrap();
        assert!(result.is_some());

        // req-1 和 req-3 仍在
        assert!(state.consume("req-1").unwrap().is_some());
        assert!(state.consume("req-3").unwrap().is_some());
    }

    #[test]
    fn ttl_expiry_cleans_front_items_before_consume() {
        let state = GrabState::new();
        let base = now();
        // 一个刚过期的信封（排在队首）
        let old_ts = base.saturating_sub(ENVELOPE_TTL_MS + 1000);
        state.push(make_envelope("old-req", old_ts));
        state.push(make_envelope("fresh-req", base));

        // consume "fresh-req" 时，"old-req" 应先被 TTL 淘汰
        let result = state.consume("fresh-req").unwrap();
        assert!(result.is_some());
        // old-req 已被清理
        let old_result = state.consume("old-req").unwrap();
        assert!(old_result.is_none());
    }

    #[test]
    fn push_multiple_then_consume_correctly_distinguishes_sources() {
        let state = GrabState::new();
        let base = now();
        state.push(GrabEnvelope {
            request_id: "a-1".into(),
            source: GrabSource::ShortcutA,
            result: Ok(GrabResult {
                text: "from-a".into(),
                truncated: false,
            }),
            created_at_ms: base,
        });
        state.push(GrabEnvelope {
            request_id: "b-1".into(),
            source: GrabSource::ShortcutB,
            result: Ok(GrabResult {
                text: "from-b".into(),
                truncated: false,
            }),
            created_at_ms: base + 1,
        });

        let a_result = state.consume("a-1").unwrap().unwrap().unwrap();
        assert_eq!(a_result.text, "from-a");

        let b_result = state.consume("b-1").unwrap().unwrap().unwrap();
        assert_eq!(b_result.text, "from-b");
    }

    #[test]
    fn consume_error_envelope_propagates_error() {
        let state = GrabState::new();
        let base = now();
        state.push(make_err_envelope("err-1", base));
        let result = state.consume("err-1").unwrap().unwrap();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), GrabError::NoSelection);
    }
}
