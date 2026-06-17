/**
 * CP-2, CP-3, CP-4, CP-5, CP-7: Prompt 组装 — 单元测试。
 *
 * 覆盖：
 * - buildNormalPrompt 包含 is_relevant/reason/data 结构
 * - Schema 以 JSON 注入
 * - 不使用 SCHEMA_GENERATION_PROMPT
 * - buildForcePrompt 不含 is_relevant/reason 判定指令
 */
import { describe, expect, it } from "vitest";
import { buildNormalPrompt, buildForcePrompt } from "../prompt/extraction";
import type { TaskSchema } from "@/lib/task-types";

const sampleSchema: TaskSchema = {
  fields: [
    { name: "email", type: "String", required: true, description: "用户邮箱" },
    { name: "age", type: "Number", required: false, description: "年龄" },
  ],
};

describe("buildNormalPrompt", () => {
  it("contains is_relevant instruction (CP-2)", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain("is_relevant");
    expect(prompt).toContain('"is_relevant": true | false');
  });

  it("contains reason field instruction", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain("reason");
  });

  it("contains data field structure", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain("data");
    expect(prompt).toContain("extracted fields matching the Schema");
  });

  it("injects schema fields as JSON (CP-3)", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain('"name": "email"');
    expect(prompt).toContain('"type": "String"');
    expect(prompt).toContain('"required": true');
    expect(prompt).toContain('"description": "用户邮箱"');
  });

  it("does NOT contain SCHEMA_GENERATION_PROMPT content (CP-4)", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    // SCHEMA_GENERATION_PROMPT 的关键特征字符串
    expect(prompt).not.toContain("data schema architect");
    expect(prompt).not.toContain("snake_case_identifer");
  });

  it("instructs is_relevant: false → data must be null", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain("data must be null");
  });

  it("instructs not to invent field values", () => {
    const prompt = buildNormalPrompt(sampleSchema);
    expect(prompt).toContain("Do NOT invent field values");
  });
});

describe("buildForcePrompt", () => {
  it("does NOT contain is_relevant (CP-5)", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).not.toContain("is_relevant");
  });

  it("does NOT contain reason instruction", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).not.toContain("reason");
  });

  it("instructs to NOT refuse extraction", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).toContain("Do NOT refuse to extract");
  });

  it("injects schema fields as JSON", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).toContain('"name": "email"');
    expect(prompt).toContain('"type": "String"');
  });

  it("asks for bare data object (no wrapper)", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).toContain("/* extracted fields matching the Schema */");
  });

  it("does NOT instruct model to judge relevance", () => {
    const prompt = buildForcePrompt(sampleSchema);
    // force 模式不应要求模型做相关性判定（is_relevant: true/false 结构）
    expect(prompt).not.toContain('"is_relevant"');
    expect(prompt).not.toContain("is_relevant");
    // "Do NOT add commentary, relevance assessments, or extra fields" 是禁止性指令
    // 告诉模型不要做相关性评估，与判定型 prompt 完全不同
  });

  it("does NOT contain SCHEMA_GENERATION_PROMPT content (CP-4)", () => {
    const prompt = buildForcePrompt(sampleSchema);
    expect(prompt).not.toContain("data schema architect");
  });
});
