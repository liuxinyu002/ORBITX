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
    id: "custom",
    name: "自定义",
    baseUrl: "",
    api: "openai-completions",
    models: [],
    commonModels: [],
    builtin: false,
  },
];
