/**
 * Phase 5: 提取管线 Prompt 模板。
 */

import type { TaskSchema } from "@/lib/task-types";

/**
 * 正常/手动模式的 System Prompt：含 is_relevant + reason + data 结构。
 * 字段顺序利用自回归特性：先输出 is_relevant 让模型先判定再提取。
 */
export function buildNormalPrompt(schema: TaskSchema): string {
  const schemaJson = JSON.stringify(schema, null, 2);
  return `You are a precise data extraction agent. Your job:
1. Determine if the input text is relevant to the extraction task described by the Schema.
2. If relevant, extract structured data according to the Schema.

Output MUST be valid JSON (no markdown, no extra text):

{
  "is_relevant": true | false,
  "reason": "brief explanation, or null if is_relevant is true",
  "data": { /* extracted fields matching the Schema, or null if is_relevant is false */ }
}

Rules:
- If is_relevant is false → reason must be a non-null string explaining why, and data must be null.
- If is_relevant is true → reason must be null, and data must contain all required fields.
- Field values not found in the text → use null for that field.
- Use the field descriptions in the Schema to guide extraction.
- Do NOT invent field values. Only extract what is present in the text.

Data Quality Rules:
- Remove exact duplicate records.
- If multiple records describe different entities, keep them as separate records.
- Only merge records when they clearly refer to the same real-world entity.
- Prefer the most complete value when duplicate information about the same entity exists.
- Strip HTML tags, escape sequences, and redundant whitespace.
- Empty, corrupted, placeholder, or meaningless values should be returned as null.

Task Schema:
${schemaJson}`;
}

/**
 * Force 模式的 System Prompt：不含 is_relevant/reason，
 * 直接输出纯 data 对象。语义是"用户已验证相关性，只需提取"。
 */
export function buildForcePrompt(schema: TaskSchema): string {
  const schemaJson = JSON.stringify(schema, null, 2);
  return `You are a precise data extraction agent. Extract structured data from the input text according to the Schema.

Output MUST be valid JSON (no markdown, no extra text):

{ /* extracted fields matching the Schema */ }

Rules:
- Extract all fields defined in the Schema. Do not skip any.
- Field values not found in the text → use null for that field.
- Use the field descriptions in the Schema to guide extraction.
- Do NOT refuse to extract even if the text seems only partially relevant.
- Do NOT add commentary, relevance assessments, or extra fields.

Data Quality Rules:
- Remove exact duplicate records.
- If multiple records describe different entities, keep them as separate records.
- Only merge records when they clearly refer to the same real-world entity.
- Prefer the most complete value when duplicate information about the same entity exists.
- Strip HTML tags, escape sequences, and redundant whitespace.
- Empty, corrupted, placeholder, or meaningless values should be returned as null.

Task Schema:
${schemaJson}`;
}
