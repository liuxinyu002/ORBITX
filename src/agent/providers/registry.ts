import type { Model } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai";
import type { ModelConfig } from "../types";

/**
 * 将 ModelConfig 解析为 pi-ai 的 Model 对象。
 * - DeepSeek：通过 pi-ai 内置 getModel() 获取基线，覆盖用户自定义的 id/name（pi-ai v0.79.1 中 deepseek 模型使用 openai-completions API）
 * - OpenAI / 智谱 / Custom：手动构造 Model<"openai-completions">（OpenAI 在 v0.79.1 中使用 openai-responses API，需手动构造以兼容 complete()）
 */
export function resolveModel(config: ModelConfig): Model<"openai-completions"> {
  if (config.provider === "deepseek") {
    const base = getModel("deepseek", "deepseek-v4-flash");
    return { ...base, id: config.modelId, name: config.modelName };
  }
  // openai / zhipu / custom: 手动构造 Model 对象
  // 所有三家都使用 OpenAI-compatible API
  return {
    id: config.modelId,
    name: config.modelName,
    api: "openai-completions",
    provider: config.provider,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}
