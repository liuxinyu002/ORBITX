/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// ── Mock Tauri event ──────────────────────────────────────────────────────────

const mockListen = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

// ── Mock lottie-react ─────────────────────────────────────────────────────────

const MockLottie = vi.fn();

vi.mock("lottie-react", () => ({
  default: (props: Record<string, unknown>) => MockLottie(props),
}));

// ── Mock tap tap.json ────────────────────────────────────────────────────────

vi.mock("@/assets/tap tap.json", () => ({
  default: { v: "5.0", fr: 60, ip: 0, op: 60 },
}));

import ToastOverlay from "../toast-overlay";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockListenWithCallback() {
  let callback: ((event: unknown) => void) | undefined;
  const unlisten = vi.fn();
  mockListen.mockImplementation(
    (_event: string, cb: (event: unknown) => void) => {
      callback = cb;
      return Promise.resolve(unlisten);
    },
  );
  return {
    getCallback: () => callback!,
    unlisten,
  };
}

/** 构造 toast:render 事件 payload */
function toastPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      state: "loading",
      message: "正在提取…",
      taskName: undefined,
      recordCount: 0,
      previewFields: [],
      durationMs: 0,
      ...overrides,
    },
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 三态渲染测试（CP-10, CP-11）───────────────────────────────────────────

describe("ToastOverlay — three-state rendering", () => {
  it("renders loading state with Lottie animation and message", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({ state: "loading", message: "正在提取「简历库」…" }),
      );
    });

    // 消息文本可见
    expect(document.body.textContent).toContain("正在提取「简历库」…");
    // Lottie 被渲染（loading 态无 error，所以 Lottie 被实际调用）
    expect(MockLottie).toHaveBeenCalledWith(
      expect.objectContaining({ loop: true }),
    );
  });

  it("renders success state with checkmark, message, and record count", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取到「简历库」",
          recordCount: 3,
        }),
      );
    });

    expect(document.body.textContent).toContain("已提取到「简历库」");
    expect(document.body.textContent).toContain("3 条");
    // ✓ 字符存在
    expect(document.querySelector(".text-green-600")).toBeTruthy();
  });

  it("renders success state with field previews", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取到「简历库」",
          recordCount: 2,
          previewFields: [
            { key: "姓名", value: "张三" },
            { key: "电话", value: "138xxxx" },
          ],
        }),
      );
    });

    // 次行字段预览
    expect(document.body.textContent).toContain("姓名: 张三");
    expect(document.body.textContent).toContain("电话: 138xxxx");
  });

  it("renders success state without field previews (only first row)", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取到「简历库」",
          recordCount: 0,
          previewFields: [],
        }),
      );
    });

    expect(document.body.textContent).toContain("已提取到「简历库」");
    // 无 record count badge（recordCount=0 不渲染）
    expect(document.querySelector(".text-muted-foreground")).toBeFalsy();
  });

  it("renders error state with cross mark and message", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "error",
          message: "AI 提取失败: 调用超时",
        }),
      );
    });

    expect(document.body.textContent).toContain("AI 提取失败: 调用超时");
    // ✗ 字符存在
    expect(document.querySelector(".text-red-600")).toBeTruthy();
  });

  it("renders loading state with CSS spinner fallback when Lottie throws", async () => {
    // 让 Lottie 抛出错误 → 触发 LottieErrorBoundary 降级
    MockLottie.mockImplementation(() => {
      throw new Error("Lottie load failed");
    });

    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({ state: "loading", message: "正在提取…" }),
      );
    });

    // 降级 spinner 出现（animate-spin class）
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    // 消息文本仍可见
    expect(document.body.textContent).toContain("正在提取…");
  });
});

// ── Fade-out 定时器测试（CP-9）───────────────────────────────────────────

describe("ToastOverlay — fade-out timer management", () => {
  it("loading state does NOT start fade-out timer", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({ state: "loading", message: "正在提取…", durationMs: 2500 }),
      );
    });

    // 推进 2300ms（此时如果是 success/error 会触发 fadeStart）
    await act(async () => {
      vi.advanceTimersByTime(2300);
    });

    // loading 态不应有 fade-out class
    const container = document.querySelector(".bg-transparent");
    expect(container?.className).not.toContain("fade-out");
  });

  it("success state starts fade-out at durationMs - 200", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取",
          durationMs: 2500,
        }),
      );
    });

    // 2300ms 前：不应 fade-out
    await act(async () => {
      vi.advanceTimersByTime(2200);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).not.toContain("fade-out");

    // 2300ms 后：应 fade-out
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).toContain("fade-out");
  });

  it("error state starts fade-out at durationMs - 200", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "error",
          message: "提取失败",
          durationMs: 1500,
        }),
      );
    });

    // 1300ms 后（1500 - 200 = 1300）：应 fade-out
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).toContain("fade-out");
  });

  it("state transition clears old timer and sets new one", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "第一次",
          durationMs: 2500,
        }),
      );
    });

    // 推进 1000ms（还未到 fadeStart）
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).not.toContain("fade-out");

    // 状态切换到 error：旧定时器应清除，新定时器从 0 开始
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "error",
          message: "第二次",
          durationMs: 2500,
        }),
      );
    });

    // 又过 2200ms：仍不应 fade-out（新定时器从切换时启动，需 2300ms）
    await act(async () => {
      vi.advanceTimersByTime(2200);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).not.toContain("fade-out");

    // 再 100ms 后（从切换开始刚好 2300ms）：应 fade-out
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).toContain("fade-out");
  });

  it("uses default 2500ms when durationMs is 0", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取",
          durationMs: 0,
        }),
      );
    });

    // 2300ms 前不应 fade
    await act(async () => {
      vi.advanceTimersByTime(2200);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).not.toContain("fade-out");

    // 2300ms 后应 fade（默认 2500）
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(
      document.querySelector(".bg-transparent")?.className,
    ).toContain("fade-out");
  });

  it("null initial state renders nothing", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<ToastOverlay />);
    });

    // 无 payload 时返回 null
    expect(document.querySelector(".bg-transparent")).toBeFalsy();
  });
});

// ── 布局样式测试 ─────────────────────────────────────────────────────────

describe("ToastOverlay — layout and styles", () => {
  it("capsule uses design tokens and rounded styling", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({ state: "loading", message: "测试" }),
      );
    });

    const capsule = document.querySelector(".bg-popover");
    expect(capsule).toBeTruthy();
    expect(capsule?.className).toContain("rounded-lg");
    expect(capsule?.className).toContain("border-border");
  });

  it("maintains 480px width across all states", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });

    // Loading state
    await act(async () => {
      getCallback()(toastPayload({ state: "loading", message: "测试" }));
    });
    expect(document.querySelector(".w-\\[480px\\]")).toBeTruthy();

    // Success state
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取",
          previewFields: [{ key: "a", value: "b" }],
        }),
      );
    });
    expect(document.querySelector(".w-\\[480px\\]")).toBeTruthy();

    // Error state
    await act(async () => {
      getCallback()(
        toastPayload({ state: "error", message: "失败" }),
      );
    });
    expect(document.querySelector(".w-\\[480px\\]")).toBeTruthy();
  });

  it("sets overlay-mode class on html and body", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<ToastOverlay />);
    });

    expect(document.documentElement.classList.contains("overlay-mode")).toBe(
      true,
    );
    expect(document.body.classList.contains("overlay-mode")).toBe(true);
  });

  it("removes overlay-mode class on unmount", async () => {
    mockListen.mockResolvedValue(vi.fn());

    const { unmount } = await act(async () => {
      return render(<ToastOverlay />);
    });

    unmount();

    expect(
      document.documentElement.classList.contains("overlay-mode"),
    ).toBe(false);
    expect(document.body.classList.contains("overlay-mode")).toBe(false);
  });
});

// ── Preview fields rendering ──────────────────────────────────────────────

describe("ToastOverlay — preview fields", () => {
  it("displays up to 3 fields separated by |", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取",
          recordCount: 3,
          previewFields: [
            { key: "姓名", value: "张三" },
            { key: "电话", value: "138xxxx" },
            { key: "邮箱", value: "zh@test.com" },
            { key: "地址", value: "北京" },
          ],
        }),
      );
    });

    // 最多 3 个字段
    expect(document.body.textContent).toContain("姓名: 张三");
    expect(document.body.textContent).toContain("电话: 138xxxx");
    expect(document.body.textContent).toContain("邮箱: zh@test.com");
    // 第 4 个字段不应出现
    expect(document.body.textContent).not.toContain("地址: 北京");
  });

  it("filters null/undefined values from preview fields", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<ToastOverlay />);
    });
    await act(async () => {
      getCallback()(
        toastPayload({
          state: "success",
          message: "已提取",
          recordCount: 1,
          previewFields: [
            { key: "姓名", value: "张三" },
          ],
        }),
      );
    });

    expect(document.body.textContent).toContain("姓名: 张三");
  });
});
