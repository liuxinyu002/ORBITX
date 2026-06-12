## MODIFIED Requirements

### Requirement: AgentContext React context
The agent module SHALL export an `AgentContext` React context providing:

- `activeModel`: the currently active `ModelConfig` (or null)
- `setActiveModel(id)`: switch the active model
- `configs`: list of all saved `ModelConfig[]`
- `refreshConfigs()`: reload configs from SQLite

**Phase-3 scope**: `AgentProvider` SHALL be placed at App level (`App.tsx`), wrapping all routes. This enables `useAgent()` in both `/settings` and `/tools/extractor` routes. Phase-3 requires AI model access for Schema draft generation.

#### Scenario: App reads active model from context
- **WHEN** a component calls `useAgent()`
- **THEN** it receives the current `activeModel` and control functions
- **THEN** the context value updates when `setActiveModel` is called

#### Scenario: No active model on first launch
- **WHEN** the app launches with no saved model configs
- **THEN** `activeModel` is `null`
- **THEN** the settings page is accessible to configure the first model

#### Scenario: Extractor page accesses agent context
- **WHEN** the `/tools/extractor` page calls `useAgent()`
- **THEN** it receives the active model configuration
- **THEN** it can call `getApiKey()` for AI Schema generation
