## ADDED Requirements

### Requirement: Model config CRUD via Tauri Commands
The Rust backend SHALL provide the following Tauri Commands for model configuration management:

- `save_model_config(input: ModelConfigInput) -> CommandResult<String>` — create or update a model config, returns the id
- `get_model_configs() -> CommandResult<Vec<ModelConfig>>` — list all saved configs (api_key masked: first 4 + last 4 chars)
- `delete_model_config(id: String) -> CommandResult<()>` — delete a config by id
- `set_active_model(id: String) -> CommandResult<()>` — set one config as active, deactivate all others
- `get_active_model() -> CommandResult<ModelConfig>` — get the currently active config (with full api_key)
- `get_model_api_key(id: String) -> CommandResult<String>` — get full api_key for a specific config

#### Scenario: Save new model config
- **WHEN** the user fills out a provider form and saves
- **THEN** a new row is inserted into `model_configs` with a generated UUID v4
- **THEN** the config id is returned to the frontend

#### Scenario: Update existing model config
- **WHEN** the user edits an existing model config and saves
- **THEN** the corresponding row is updated in `model_configs`
- **THEN** `updated_at` is set to the current timestamp

#### Scenario: List configs with masked API key
- **WHEN** `get_model_configs` is called
- **THEN** each config's `api_key` field contains only the first 4 and last 4 characters (e.g., "sk-a***b1c2")
- **THEN** the full key is not exposed in the list view

#### Scenario: Get active model with full API key
- **WHEN** `get_active_model` is called
- **THEN** the active config is returned with the complete `api_key` field
- **THEN** this is used by the frontend to initialize the Agent module

#### Scenario: Set active model in transaction
- **WHEN** `set_active_model(id)` is called
- **THEN** all `model_configs` rows have `is_active` set to 0
- **THEN** the target row has `is_active` set to 1
- **THEN** both operations happen in a single SQLite transaction

#### Scenario: Delete active model rejected
- **WHEN** `delete_model_config` is called with the id of the currently active model (`is_active = 1`)
- **THEN** a `SerializableError::InvalidState("不能删除当前激活的模型，请先激活其他模型")` is returned
- **THEN** the active model is not deleted (Rust backend enforces this, not just UI)

#### Scenario: Delete non-existent config returns NotFound
- **WHEN** `delete_model_config` is called with an id that does not exist
- **THEN** a `SerializableError::NotFound { source_id: "model_config:<id>" }` is returned

#### Scenario: Set active with non-existent id returns NotFound
- **WHEN** `set_active_model` is called with an id that does not exist
- **THEN** a `SerializableError::NotFound { source_id: "model_config:<id>" }` is returned

### Requirement: Provider coverage
The model configuration system SHALL support the following provider types:

| Provider | `provider` value | pi-ai built-in | Base URL |
|----------|-----------------|----------------|----------|
| DeepSeek | `deepseek` | Yes | `https://api.deepseek.com/v1` |
| OpenAI | `openai` | Yes | `https://api.openai.com/v1` |
| 智谱 GLM | `zhipu` | No (manual Model construction) | `https://open.bigmodel.cn/api/paas/v4` |
| 自定义 (OpenAI 兼容) | `custom` | No (manual Model construction) | User-provided |

#### Scenario: DeepSeek and OpenAI use pi-ai built-in model resolution
- **WHEN** the app initializes the Agent module
- **THEN** DeepSeek and OpenAI models are available via pi-ai's `getModel(provider, modelId)` (both are in the `KnownProvider` type)
- **THEN** no manual Model construction or dynamic registration is needed

#### Scenario: Zhipu and custom providers use manual Model construction
- **WHEN** the app initializes with a saved Zhipu or custom model config
- **THEN** a `Model<"openai-completions">` object is constructed manually with the user's `base_url` and `model_id`
- **THEN** the model object is passed directly to `complete()` without any registration step
- **THEN** pi-ai's built-in `openai-completions` API provider handles the HTTP request (it works with any OpenAI-compatible base URL)

### Requirement: Label uniqueness
Model config labels SHALL be unique across all saved configs (global uniqueness, not per-provider). The Rust backend SHALL enforce this by performing a case-insensitive (`LOWER(label)`) duplicate check before insert/update. The database-level `UNIQUE(label)` constraint serves as a last-resort guard (case-sensitive, so the Rust check is authoritative).

#### Scenario: Duplicate label rejected
- **WHEN** saving a model config with a label that already exists (case-insensitive)
- **THEN** a `SerializableError::Duplicate("label 'xxx' already exists")` is returned
- **THEN** no data is written to the database

#### Scenario: Same label different case rejected
- **WHEN** saving a model config with label "My Model" and another config already has label "my model"
- **THEN** a `SerializableError::Duplicate("label 'My Model' already exists")` is returned

### Requirement: API key masking in list queries
When returning model configs via `get_model_configs`, the `api_key` field SHALL be masked:
- Keys **longer than 8 characters**: show first 4 characters + `"***"` + last 4 characters (e.g., `"sk-a1b2c3d4e5"` → `"sk-a***d4e5"`)
- Keys **5-8 characters**: show `"****"` (too short for meaningful masking)
- Keys **4 characters or fewer**: show `"****"`
- The full key is NEVER sent to the frontend in list queries

#### Scenario: Normal API key masked
- **WHEN** `get_model_configs` is called and a config has `api_key` = `"sk-a1b2c3d4e5f6g7h8"`
- **THEN** the returned `api_key` field value is `"sk-a***g7h8"`

#### Scenario: Short API key fully masked
- **WHEN** `get_model_configs` is called and a config has `api_key` = `"abc"`
- **THEN** the returned `api_key` field value is `"****"`
