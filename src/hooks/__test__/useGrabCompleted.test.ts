/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mock Tauri APIs ──────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockListen = vi.fn();
const mockIsVisible = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ isVisible: () => mockIsVisible() }),
}));

const { mockToast, mockLog } = vi.hoisted(() => {
  const t = vi.fn();
  return {
    mockToast: Object.assign(t, {
      success: vi.fn(),
      error: vi.fn(),
    }),
    mockLog: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/logger", () => ({
  log: mockLog,
}));

import { useGrabCompleted } from "../useGrabCompleted";

// ── Helpers ──────────────────────────────────────────────────────────────────

function grabPayload(source: string, requestId = "test-request-id") {
  return { payload: { requestId, source } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsVisible.mockResolvedValue(true);
  mockInvoke.mockResolvedValue(null);
});

// ── CP-9: Error variant matching ─────────────────────────────────────────────

describe("useGrabCompleted — error handling", () => {
  it("shows toast and logs for ClipboardTimeout", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (_event: string, cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );
    mockInvoke.mockRejectedValue('ClipboardTimeout');

    renderHook(() => useGrabCompleted());

    // 等待 listen 注册 + effect 完成
    await act(() => Promise.resolve());

    // 触发 grab-completed 事件
    await act(async () => {
      capturedCallback!(grabPayload("shortcut-a"));
    });

    expect(mockToast.error).toHaveBeenCalledWith("目标应用未响应，请重试");
    expect(mockLog).toHaveBeenCalledWith("warn", "overlay", "剪贴板降级超时");
  });

  it("shows toast and logs for ClipboardLockFailed", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (_event: string, cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );
    mockInvoke.mockRejectedValue("ClipboardLockFailed");

    renderHook(() => useGrabCompleted());

    await act(() => Promise.resolve());

    await act(async () => {
      capturedCallback!(grabPayload("shortcut-a"));
    });

    expect(mockToast.error).toHaveBeenCalledWith("操作太频繁，请稍后再试");
    expect(mockLog).toHaveBeenCalledWith("warn", "overlay", "剪贴板锁冲突");
  });

  it("ignores shortcut-b events", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (_event: string, cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );

    renderHook(() => useGrabCompleted());
    await act(() => Promise.resolve());

    await act(async () => {
      capturedCallback!(grabPayload("shortcut-b"));
    });

    // invoke 不应被调用
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("shows accessibility denied toast", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (_event: string, cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );
    mockInvoke.mockRejectedValue("AccessibilityDenied");

    renderHook(() => useGrabCompleted());
    await act(() => Promise.resolve());

    await act(async () => {
      capturedCallback!(grabPayload("shortcut-a"));
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "请在系统设置→隐私与安全性→辅助功能中授权 OrbitX",
      { duration: 6000 },
    );
  });

  it("shows generic toast for NoSelection", async () => {
    let capturedCallback: ((event: unknown) => void) | undefined;
    mockListen.mockImplementation(
      (_event: string, cb: (event: unknown) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );
    mockInvoke.mockRejectedValue("NoSelection");

    renderHook(() => useGrabCompleted());
    await act(() => Promise.resolve());

    await act(async () => {
      capturedCallback!(grabPayload("shortcut-a"));
    });

    // toast() 可调用形式
    expect(mockToast).toHaveBeenCalledWith("未发现选中文本");
  });
});

describe("useGrabCompleted — lifecycle", () => {
  it("unlistens on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const { unmount } = renderHook(() => useGrabCompleted());
    await act(() => Promise.resolve());

    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
