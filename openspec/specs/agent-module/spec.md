# Agent Module

## Purpose

Define the frontend `src/agent/` module structure, TypeScript types, provider preset data, custom model construction for non-built-in providers, and the React context for agent state management. This module serves as the foundation for Agent-based AI functionality (Phase-5).

## Requirements

### Requirement: Agent module directory structure
The frontend SHALL contain an `src/agent/` directory serving as the independent agent module with the following structure:

```
src/agent/
├── index.ts               # public exports
├── types.ts               # ModelConfig, ProviderPreset types
├── AgentContext.tsx        # React context + provider
├── providers/
│   ├── presets.ts         # provider preset data
│   └── registry.ts        # dynamic provider registration logic
└── hooks/
    ├── useModelConfig.ts   # CRUD via Tauri commands
    └── useConnectionTest.ts # connection test via pi-ai
```

#### Scenario: Module has a single public entry point
- **WHEN** other parts of the app import from the agent module
- **THEN** they import from `@/agent` (index.ts re-exports)
- **THEN** internal implementation details are not directly importable

### Requirement: TypeScript type definitions
The agent module SHALL define the following TypeScript types mirroring the Rust data model:

```typescript
interface ModelConfig {
  id: string;
  provider: "deepseek" | "openai" | "zhipu" | "custom";
  label: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ModelConfigInput {
  provider: string;
  label: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  apiKey: string;
}
```

#### Scenario: TypeScript types stay in sync with Rust types
- **WHEN** a field is added to the Rust `ModelConfig` struct
- **THEN** the TypeScript `ModelConfig` interface is updated to match

### Requirement: Provider preset data
The agent module SHALL define provider preset data for the four supported provider types, each containing:
- `id`: provider identifier (`"deepseek"` | `"openai"` | `"zhipu"` | `"custom"`)
- `name`: display name
- `baseUrl`: default API endpoint
- `api`: pi-ai API type (`"openai-completions"` for all four, since all use OpenAI-compatible HTTP APIs)
- `models`: array of `{ id, name }` for commonly used models
- `commonModels`: array of `{ id, name }` for chip selection in UI (3-5 per provider)
- `builtin`: whether pi-ai's `getModel()` can resolve this provider directly

#### Scenario: DeepSeek preset contains correct defaults
- **WHEN** reading the DeepSeek preset
- **THEN** `builtin` is `true` (pi-ai's KnownProvider includes "deepseek")
- **THEN** `baseUrl` is `"https://api.deepseek.com/v1"`
- **THEN** default model is `deepseek-chat`

#### Scenario: Custom preset has empty defaults
- **WHEN** reading the custom (OpenAI-compatible) preset
- **THEN** `builtin` is `false`
- **THEN** `baseUrl` is empty (user must provide)
- **THEN** `models` array is empty (user must provide)

### Requirement: Custom model construction for non-built-in providers
For providers not in pi-ai's `KnownProvider` type (zhipu, custom), the agent module SHALL construct `Model` objects manually conforming to pi-ai's `Model<"openai-completions">` interface. The `registerProvider()` function **does not exist** in pi-ai v0.79.1 — manual construction is the only path.

The manually constructed Model object SHALL include all required fields of the pi-ai `Model` interface: `id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`.

#### Scenario: Zhipu model constructed manually
- **WHEN** resolving a Zhipu model config
- **THEN** a `Model<"openai-completions">` object is constructed with the user's `model_id`, `base_url`, and `model_name`
- **THEN** `api` is set to `"openai-completions"`
- **THEN** `provider` is set to `"zhipu"`
- **THEN** the object is passed directly to `complete()` or to the Agent instance without any registration step

#### Scenario: Custom OpenAI-compatible model constructed manually
- **WHEN** resolving a custom endpoint model config
- **THEN** a `Model<"openai-completions">` object is constructed with the user-provided `base_url` and `model_id`
- **THEN** `api` is set to `"openai-completions"`
- **THEN** `provider` is set to `"custom"`
- **THEN** no `registerApiProvider()` call is needed (built-in `openai-completions` API provider handles it)

#### Scenario: Built-in provider resolution via getModel
- **WHEN** resolving a DeepSeek or OpenAI model config
- **THEN** `getModel("deepseek", modelId)` or `getModel("openai", modelId)` is called to retrieve the pi-ai built-in model object
- **THEN** no manual Model construction is needed for these providers

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

### Requirement: @earendil-works/pi-ai dependency
The project SHALL add `@earendil-works/pi-ai` (v0.79.1, pinned) as a frontend dependency in `package.json`.

Key APIs used in Phase 2:
- `complete(model, context, options)` — single-turn LLM request for connection testing
- `getModel(provider, modelId)` — retrieve built-in model objects for DeepSeek/OpenAI
- `Model` interface — type reference for manual construction of custom provider models

#### Scenario: pi-ai functions available in browser context
- **WHEN** calling `getModel()` or `complete()` from React components in Tauri WebView
- **THEN** all functions execute without Node.js-specific runtime errors

### Requirement: @earendil-works/pi-agent-core dependency
The project SHALL add `@earendil-works/pi-agent-core` (v0.79.1, pinned) as a frontend dependency in `package.json`. The `Agent` class SHALL be importable for type references and module structure preparation. Agent instances SHALL NOT be created in Phase 2.

#### Scenario: Agent class importable
- **WHEN** the agent module imports `Agent` from `@earendil-works/pi-agent-core`
- **THEN** the import succeeds without build errors
- **THEN** No Node.js harness code is executed (harness code is in `./node` subpath export, not the main entry point)
