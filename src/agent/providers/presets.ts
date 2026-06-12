import type { ProviderPreset } from "../types";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    commonModels: [
      { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ],
    builtin: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    models: [{ id: "gpt-4o", name: "GPT-4o" }],
    commonModels: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "o3-mini", name: "o3-mini" },
      { id: "o4-mini", name: "o4-mini" },
    ],
    builtin: true,
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    models: [{ id: "glm-4-flash", name: "GLM-4 Flash" }],
    commonModels: [
      { id: "glm-4-flash", name: "GLM-4 Flash" },
      { id: "glm-4-plus", name: "GLM-4 Plus" },
      { id: "glm-4-air", name: "GLM-4 Air" },
      { id: "glm-4-long", name: "GLM-4 Long" },
      { id: "glm-4", name: "GLM-4" },
    ],
    builtin: false,
  },
  {
    id: "custom",
    name: "自定义",
    baseUrl: "",
    api: "openai-completions",
    models: [],
    commonModels: [],
    builtin: false,
  },
];
