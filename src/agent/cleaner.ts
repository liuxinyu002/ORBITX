/**
 * Phase 5: 提取管线 — 数据后处理。
 *
 * Prompt 层负责语义清洗（实体合并/拆分），本层负责确定性治理。
 */

/** 去除 HTML 标签 */
function stripHtml(raw: string): string {
  return raw.replace(/<[^>]*>/g, "");
}

/** 归一化空白字符：合并连续空白为单个空格 */
function normalizeWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ");
}

/** 清洗单个字符串值 */
function cleanString(raw: string): string | null {
  let v = raw.trim();
  v = stripHtml(v);
  v = normalizeWhitespace(v);
  v = v.trim();
  return v.length > 0 ? v : null;
}

/** 判断两个值是否完全相同（用于对象数组去重） */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * 对数组进行去重：
 * - 基本类型 → Set 去重
 * - 对象 → 完全相同的对象去重，不同对象保留（实体合并交给 LLM）
 */
function dedupeArray(arr: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const item of arr) {
    if (!result.some((existing) => isSameValue(existing, item))) {
      result.push(item);
    }
  }
  return result;
}

/** 递归清洗任意值 */
function cleanValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    return cleanString(value);
  }

  if (Array.isArray(value)) {
    const cleaned = value.map(cleanValue);
    return dedupeArray(cleaned);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = cleanValue(v);
    }
    return result;
  }

  return value;
}

/**
 * 清洗提取结果，返回 null 表示整条记录无效（全字段为空）。
 */
export function cleanExtractedData(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const cleaned: Record<string, unknown> = {};
  let hasNonNull = false;

  for (const [key, value] of Object.entries(data)) {
    cleaned[key] = cleanValue(value);
    if (cleaned[key] !== null) {
      hasNonNull = true;
    }
  }

  if (!hasNonNull) return null;
  return cleaned;
}
