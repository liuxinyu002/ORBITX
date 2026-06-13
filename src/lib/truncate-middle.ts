/**
 * JS 中间截断：保留首尾字符，中间用 * 替代省略部分。
 * 格式: "前段文字...*...后段文字"
 */

const SEPARATOR = "...*...";
const MIN_CHARS = 3;

/** 字符数降级：前 40% + 分隔符 + 后 40% */
function truncateFallback(text: string): string {
  if (text.length <= MIN_CHARS * 2 + SEPARATOR.length) return text;
  const prefixLen = Math.max(MIN_CHARS, Math.floor(text.length * 0.4));
  const suffixLen = Math.max(MIN_CHARS, Math.floor(text.length * 0.4));
  return text.slice(0, prefixLen) + SEPARATOR + text.slice(-suffixLen);
}

/** 查找最长前缀，使其像素宽度 ≤ maxWidth（至少保留 MIN_CHARS 字符） */
function longestPrefix(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): number {
  let lo = MIN_CHARS;
  let hi = text.length - MIN_CHARS;
  let best = MIN_CHARS;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid)).width <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** 查找最长后缀，使其像素宽度 ≤ maxWidth（至少保留 MIN_CHARS 字符） */
function longestSuffix(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): number {
  let lo = MIN_CHARS;
  let hi = text.length - MIN_CHARS;
  let best = MIN_CHARS;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ctx.measureText(text.slice(-mid)).width <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 使用 Canvas measureText 精确截断文本。
 * 短文本（无需截断）返回原文。
 * 空文本返回空串。
 * 极窄容器至少保留 prefix 3 + suffix 3 字符。
 */
export function truncateMiddle(text: string, maxWidth: number): string {
  if (!text) return text;

  // Canvas 精确测量
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // 与胶囊左区 text-sm (13px) 字体匹配
      ctx.font =
        '13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

      // 原文可直接放入
      if (ctx.measureText(text).width <= maxWidth) {
        return text;
      }

      // 即使只保留最小字符数仍放不下，强制 3+3
      const sepWidth = ctx.measureText(SEPARATOR).width;
      const minPrefix = text.slice(0, MIN_CHARS);
      const minSuffix = text.slice(-MIN_CHARS);
      if (
        ctx.measureText(minPrefix + SEPARATOR + minSuffix).width > maxWidth
      ) {
        return minPrefix + SEPARATOR + minSuffix;
      }

      // 二分搜索最佳截断点
      const halfWidth = (maxWidth - sepWidth) / 2;
      const prefixLen = longestPrefix(ctx, text, halfWidth);
      const suffixLen = longestSuffix(
        ctx,
        text,
        halfWidth,
      );

      return text.slice(0, prefixLen) + SEPARATOR + text.slice(-suffixLen);
    }
  } catch {
    // Canvas 不可用，降级到字符数估算
  }

  return truncateFallback(text);
}
