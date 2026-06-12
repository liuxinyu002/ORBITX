use serde::{Deserialize, Serialize};

/// 模型配置的完整数据库行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub base_url: String,
    pub model_id: String,
    pub model_name: String,
    pub api_key: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 创建/更新模型配置的输入，不含服务端管理的字段。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigInput {
    pub provider: String,
    pub label: String,
    pub base_url: String,
    pub model_id: String,
    pub model_name: String,
    pub api_key: String,
}

/// 对 API key 脱敏：len>8 显示前 4 + *** + 后 4，其余显示 ****。
pub fn mask_api_key(key: &str) -> String {
    if key.len() > 8 {
        format!("{}***{}", &key[..4], &key[key.len() - 4..])
    } else {
        "****".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_normal_key() {
        assert_eq!(
            mask_api_key("sk-a1b2c3d4e5f6g7h8"),
            "sk-a***g7h8"
        );
    }

    #[test]
    fn mask_short_key() {
        assert_eq!(mask_api_key("abc"), "****");
    }

    #[test]
    fn mask_key_5_to_8_chars() {
        assert_eq!(mask_api_key("12345"), "****");
        assert_eq!(mask_api_key("12345678"), "****");
    }

    #[test]
    fn mask_key_9_chars() {
        assert_eq!(mask_api_key("012345678"), "0123***5678");
    }
}
