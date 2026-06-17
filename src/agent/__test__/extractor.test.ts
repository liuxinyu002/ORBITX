import { describe, expect, it } from "vitest";
import { parseAIResponse } from "../extractor";

describe("parseAIResponse", () => {
  it("parses pure JSON", () => {
    const result = parseAIResponse('{"fields":[{"name":"email","type":"String","required":true,"description":"邮箱"}]}');
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(1);
    expect(((result!.fields as unknown[])[0] as Record<string, unknown>).name).toBe("email");
  });

  it("strips markdown code block", () => {
    const result = parseAIResponse(
      '```json\n{"fields":[{"name":"phone","type":"String","required":false,"description":"电话"}]}\n```',
    );
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(1);
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseAIResponse(
      'Here is the schema: {"fields":[{"name":"age","type":"Number","required":false,"description":"年龄"}]} end.',
    );
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(1);
  });

  it("returns null for invalid JSON", () => {
    const result = parseAIResponse("not json at all");
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const result = parseAIResponse('{"fields": [}');
    expect(result).toBeNull();
  });

  it("parses empty fields array", () => {
    const result = parseAIResponse('{"fields":[]}');
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(0);
  });

  it("strips uppercase JSON markdown block", () => {
    const result = parseAIResponse(
      '```JSON\n{"fields":[{"name":"email","type":"String","required":true,"description":"邮箱"}]}\n```',
    );
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(1);
  });

  it("handles nested braces in field descriptions", () => {
    const result = parseAIResponse(
      '{"fields":[{"name":"data","type":"String","required":false,"description":"匹配 {pattern} 的值"}]}',
    );
    expect(result).not.toBeNull();
    expect(result!.fields as unknown[]).toHaveLength(1);
  });
});
