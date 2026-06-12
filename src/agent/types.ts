// Phase-2 类型定义，与 Rust 侧 ModelConfig/ModelConfigInput 对齐。

export interface ModelConfig {
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

export interface ModelConfigInput {
  provider: string;
  label: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  apiKey: string;
}

export interface ProviderPreset {
  id: "deepseek" | "openai" | "zhipu" | "custom";
  name: string;
  baseUrl: string;
  api: string;
  models: { id: string; name: string }[];
  commonModels: { id: string; name: string }[];
  builtin: boolean;
}
