/**
 * CP-18: cleanExtractedData 数据清洗 — 单元测试。
 *
 * 覆盖：HTML 剥离、空白归一化、数组去重、全 null 检测、嵌套对象、混合类型。
 */
import { describe, expect, it } from "vitest";
import { cleanExtractedData } from "../cleaner";

describe("cleanExtractedData", () => {
  // ── 字符串清洗 ──────────────────────────────────────────────────────

  it("strips HTML tags from string values", () => {
    const result = cleanExtractedData({ title: "<b>hello</b>" });
    expect(result).toEqual({ title: "hello" });
  });

  it("normalizes multiple whitespace to single space", () => {
    const result = cleanExtractedData({ text: "foo   bar\nbaz" });
    expect(result).toEqual({ text: "foo bar baz" });
  });

  it("trims leading and trailing whitespace", () => {
    const result = cleanExtractedData({ name: "  alice  " });
    expect(result).toEqual({ name: "alice" });
  });

  it("returns null for whitespace-only strings (all-null → top-level null)", () => {
    const result = cleanExtractedData({ empty: "   \n\t  " });
    expect(result).toBeNull();
  });

  it("returns null for empty string (all-null → top-level null)", () => {
    const result = cleanExtractedData({ empty: "" });
    expect(result).toBeNull();
  });

  // ── 非字符串值透传 ──────────────────────────────────────────────────

  it("preserves numbers as-is", () => {
    const result = cleanExtractedData({ count: 42, pi: 3.14 });
    expect(result).toEqual({ count: 42, pi: 3.14 });
  });

  it("preserves booleans as-is", () => {
    const result = cleanExtractedData({ active: true, deleted: false });
    expect(result).toEqual({ active: true, deleted: false });
  });

  it("converts null/undefined to null (all-null → top-level null)", () => {
    const result = cleanExtractedData({ a: null, b: undefined as unknown });
    expect(result).toBeNull();
  });

  it("preserves null fields when other fields have values", () => {
    const result = cleanExtractedData({ a: null, b: "ok", c: undefined as unknown });
    expect(result).toEqual({ a: null, b: "ok", c: null });
  });

  // ── 数组去重 ────────────────────────────────────────────────────────

  it("deduplicates primitive array values", () => {
    const result = cleanExtractedData({ tags: ["a", "b", "a", "c"] });
    expect(result).toEqual({ tags: ["a", "b", "c"] });
  });

  it("deduplicates identical object array values", () => {
    const obj1 = { x: 1 };
    const obj2 = { x: 2 };
    const result = cleanExtractedData({ items: [obj1, obj2, obj1] });
    expect(result).toEqual({ items: [obj1, obj2] });
  });

  it("cleans string elements inside arrays", () => {
    const result = cleanExtractedData({ emails: [" a@b.com ", " <i>x</i> "] });
    expect(result).toEqual({ emails: ["a@b.com", "x"] });
  });

  // ── 嵌套对象 ────────────────────────────────────────────────────────

  it("cleans nested object values recursively", () => {
    const result = cleanExtractedData({
      profile: { name: "  bob  ", age: 30 },
    });
    expect(result).toEqual({ profile: { name: "bob", age: 30 } });
  });

  it("handles deeply nested structures", () => {
    const result = cleanExtractedData({
      user: { contact: { email: " <b>hi@test.com</b> " } },
    });
    expect(result).toEqual({
      user: { contact: { email: "hi@test.com" } },
    });
  });

  // ── 全 null 检测（整条记录无效） ────────────────────────────────────

  it("returns null when all fields clean to null", () => {
    const result = cleanExtractedData({ a: "", b: "   ", c: null });
    expect(result).toBeNull();
  });

  it("returns object when at least one field has value", () => {
    const result = cleanExtractedData({ a: "", b: "valid", c: null });
    expect(result).toEqual({ a: null, b: "valid", c: null });
  });

  // ── HTML + 空白组合 ─────────────────────────────────────────────────

  it("strips HTML then normalizes whitespace", () => {
    const result = cleanExtractedData({
      bio: "<p>Hello</p>  <p>  World  </p>",
    });
    expect(result).toEqual({ bio: "Hello World" });
  });

  // ── 混合数组（不同类型元素） ────────────────────────────────────────

  it("handles mixed-type arrays (duplicate nulls deduped)", () => {
    const result = cleanExtractedData({
      mixed: [42, " <tag>text</tag> ", null, undefined, true],
    });
    // null and undefined both become null, then deduped to one null
    expect(result).toEqual({ mixed: [42, "text", null, true] });
  });

  // ── 空对象 ──────────────────────────────────────────────────────────

  it("returns null for empty input object", () => {
    const result = cleanExtractedData({});
    expect(result).toBeNull();
  });
});
