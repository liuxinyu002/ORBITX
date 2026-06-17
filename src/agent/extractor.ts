/**
 * 结构化提取器的 System Prompt 模板。
 * Phase-3: Schema 草稿生成
 * Phase-5: 数据提取 prompt（后续添加）
 */

export const SCHEMA_GENERATION_PROMPT = {
  role: "system" as const,
  content: `You are a precise data schema architect. Your job is to convert user's data extraction requirement into a structured JSON Schema.

Strict JSON Format:
{
  "fields": [
    {
      "name": "snake_case_identifer",
      "type": "String" | "Number" | "Date",
      "required": true | false,
      "description": "Specific criteria for extraction, matching the input language."
    }
  ]
}

Rules:
1. 'name' must use english letters and underscores only.
2. Keep fields highly dense and essential. Do not generate redundant fields.
3. Keep description clear, short, and optimized for down-stream LLM extraction.
4. Respond ONLY with valid JSON. If markdown container is used, ensure it is strictly \`\`\`json ... \`\`\`.`,
};

/**
 * 容错解析 AI 返回的 JSON：剥离 markdown 代码块 → JSON.parse。
 * 返回解析后的 TaskSchema，失败返回 null。
 */
export function parseAIResponse(text: string): Record<string, unknown> | null {
  // 尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // 尝试在文本中匹配第一个 { 到最后一个 }
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
