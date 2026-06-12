import { describe, it, expect, vi } from "vitest";
import { resolveModel } from "@/agent/providers/registry";
import type { ModelConfig } from "@/agent/types";

// mock pi-ai 的 getModel，DeepSeek 路径依赖它
vi.mock("@earendil-works/pi-ai", () => ({
  getModel: vi.fn((provider: string, _modelId: string) => {
    if (provider === "deepseek") {
      return {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-completions",
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      };
    }
    throw new Error(`Unknown provider: ${provider}`);
  }),
}));

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: "test-id",
    provider: "deepseek",
    label: "Test",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    modelName: "DeepSeek Chat",
    apiKey: "sk-test",
    isActive: false,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

describe("resolveModel", () => {
  // ── CP-AG-1: DeepSeek 使用 pi-ai 内置 getModel ──────────────
  it("DeepSeek 通过 getModel 获取内置模型并覆盖 id/name", () => {
    const config = makeConfig({
      provider: "deepseek",
      modelId: "deepseek-chat",
      modelName: "DeepSeek Chat",
    });
    const model = resolveModel(config);
    expect(model.id).toBe("deepseek-chat");
    expect(model.name).toBe("DeepSeek Chat");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("deepseek");
  });

  // ── CP-AG-1: OpenAI 手动构造 Model ─────────────────────────
  it("OpenAI 手动构造 Model<openai-completions>", () => {
    const config = makeConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4o",
      modelName: "GPT-4o",
    });
    const model = resolveModel(config);
    expect(model.id).toBe("gpt-4o");
    expect(model.name).toBe("GPT-4o");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("openai");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
  });

  // ── CP-AG-1: 智谱手动构造 Model ───────────────────────────
  it("智谱手动构造 Model<openai-completions>", () => {
    const config = makeConfig({
      provider: "zhipu",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      modelId: "glm-4-flash",
      modelName: "GLM-4 Flash",
    });
    const model = resolveModel(config);
    expect(model.id).toBe("glm-4-flash");
    expect(model.name).toBe("GLM-4 Flash");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("zhipu");
    expect(model.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
  });

  // ── CP-AG-1: Custom 手动构造 Model ─────────────────────────
  it("Custom 手动构造 Model<openai-completions>，使用用户提供的 baseUrl", () => {
    const config = makeConfig({
      provider: "custom",
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3",
      modelName: "Llama 3",
    });
    const model = resolveModel(config);
    expect(model.id).toBe("llama3");
    expect(model.name).toBe("Llama 3");
    expect(model.api).toBe("openai-completions");
    expect(model.provider).toBe("custom");
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
  });

  // ── 必需字段完整性验证 ──────────────────────────────────
  it("手动构造的 Model 包含所有必需字段", () => {
    const config = makeConfig({ provider: "custom" });
    const model = resolveModel(config);

    expect(model).toHaveProperty("id");
    expect(model).toHaveProperty("name");
    expect(model).toHaveProperty("api");
    expect(model).toHaveProperty("provider");
    expect(model).toHaveProperty("baseUrl");
    expect(model).toHaveProperty("reasoning");
    expect(model).toHaveProperty("input");
    expect(model).toHaveProperty("cost");
    expect(model).toHaveProperty("contextWindow");
    expect(model).toHaveProperty("maxTokens");
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text"]);
    expect(model.cost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  // ── baseUrl 正确传递 ─────────────────────────────────────
  it("自定义 baseUrl 正确传递到 Model 对象", () => {
    const config = makeConfig({
      provider: "custom",
      baseUrl: "https://my-proxy.example.com/v1",
    });
    const model = resolveModel(config);
    expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
  });
});
