use serde::{Deserialize, Serialize};

/// 任务的完整数据库行，包含 schema JSON。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 任务列表项，不含 schema JSON 以减少数据传输量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSimple {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub updated_at: String,
}

/// `list_tasks` command 的返回类型，同时包含任务列表和激活状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
    pub tasks: Vec<TaskSimple>,
    pub active_task_id: Option<String>,
}
