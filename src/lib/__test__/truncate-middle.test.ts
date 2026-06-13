/// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { truncateMiddle } from "../truncate-middle";

describe("truncateMiddle", () => {
  // ── 短文本 ───────────────────────────────────────────────────────────

  it("returns original text when short enough (no truncation)", () => {
    const result = truncateMiddle("hello", 500);
    expect(result).toBe("hello");
  });

  it("returns empty string for empty input", () => {
    const result = truncateMiddle("", 500);
    expect(result).toBe("");
  });

  // ── 降级路径（jsdom 无 Canvas 支持）───────────────────────────────────

  it("fallback: middle-truncates long text with ...*... separator", () => {
    const longText = "a".repeat(100);
    const result = truncateMiddle(longText, 100);
    expect(result).toContain("...*...");
    // 格式：prefix + ...*... + suffix
    const parts = result.split("...*...");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThanOrEqual(3);
    expect(parts[1].length).toBeGreaterThanOrEqual(3);
  });

  it("fallback: short text below fallback threshold returns as-is", () => {
    // 字符数 ≤ MIN_CHARS*2 + SEPARATOR.length (3*2+7=13) 时不过截断
    const short = "abcdefg"; // 7 chars
    const result = truncateMiddle(short, 50);
    expect(result).toBe("abcdefg");
  });

  // ── 边界情况 ─────────────────────────────────────────────────────────

  it("very narrow maxWidth still preserves at least 3+3 chars", () => {
    const longText = "abcdefghijklmnopqrstuvwxyz";
    const result = truncateMiddle(longText, 1);
    // 即使宽度极小，也必须包含分隔符和至少 3+3 字符
    expect(result).toContain("...*...");
    const parts = result.split("...*...");
    expect(parts[0].length).toBeGreaterThanOrEqual(3);
    expect(parts[1].length).toBeGreaterThanOrEqual(3);
  });

  it("text exactly at minimum char boundary", () => {
    // 13 字符（刚好等于 MIN_CHARS*2 + SEPARATOR.length），不应截断
    const exact = "a".repeat(13);
    const result = truncateMiddle(exact, 50);
    expect(result).toBe(exact);
  });
});
