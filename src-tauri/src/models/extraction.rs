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

/// `insert_extraction` command 的输入参数。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionInput {
    pub task_id: String,
    pub raw_text: String,
    pub result_json: String,
}
