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

    /// 按 `request_id` 消费信封。先淘汰所有过期项，再查找匹配项。
    /// 返回 `Ok(None)` 表示未找到。
    pub fn consume(&self, request_id: &str) -> Result<Option<Result<GrabResult, GrabError>>, GrabError> {
        let mut queue = self
            .0
            .lock()
            .map_err(|e| GrabError::Internal(format!("GrabState Mutex 已污染: {e}")))?;

        // 淘汰过期信封
        let now = timestamp_ms();
        let expired_count = queue.iter().take_while(|e| now - e.created_at_ms > ENVELOPE_TTL_MS).count();
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
