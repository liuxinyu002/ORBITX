use serde::{Deserialize, Serialize};

/// 提取结果的完整数据库行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extraction {
    pub id: String,
    pub task_id: String,
    pub raw_text: String,
    pub result_json: String,
    pub created_at: String,
}

/// 列表查询中的提取数据行（与 Extraction 字段一致，语义区分）。
pub type ExtractionRow = Extraction;

/// 分页列表查询响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionListResponse {
    pub rows: Vec<ExtractionRow>,
    pub total: i64,
}

/// `insert_extraction` command 的输入参数。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionInput {
    pub task_id: String,
    pub raw_text: String,
    pub result_json: String,
}
