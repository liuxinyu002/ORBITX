/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// ── Mock Tauri APIs ──────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockHide = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ hide: () => mockHide() }),
}));

const { mockToast } = vi.hoisted(() => {
  const t = vi.fn();
  return {
    mockToast: Object.assign(t, {
      error: vi.fn(),
      success: vi.fn(),
    }),
  };
});

vi.mock("sonner", () => ({
  toast: mockToast,
}));

import Overlay from "../overlay";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 创建一个模拟的 listen 实现：注册 callback 并返回 Promise<unlisten> */
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

/** 模拟 grab-completed 事件 payload */
function grabPayload(source: string, requestId = "test-request-id") {
  return { payload: { requestId, source } };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // invoke 默认返回 null（未找到结果），模拟 NoSelection 场景
  mockInvoke.mockResolvedValue(null);
});

// ── 状态机测试 ──────────────────────────────────────────────────────────────

describe("Overlay state machine", () => {
  it("renders skeleton on mount", async () => {
    mockListen.mockResolvedValue(vi.fn()); // no callback fired
    await act(async () => {
      render(<Overlay />);
    });
    // skeleton 渲染闪烁占位块（animate-pulse）
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("transitions skeleton → content when grab-completed yields text", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockResolvedValue({ text: "hello world", truncated: false });

    await act(async () => {
      render(<Overlay />);
    });

    // 触发 grab-completed 事件
    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    // 应该调用 consume_grabbed_result
    expect(mockInvoke).toHaveBeenCalledWith("consume_grabbed_result", {
      requestId: "test-request-id",
    });

    // 内容已渲染
    expect(screen.getByText("hello world")).toBeTruthy();
    // skeleton 应该消失
    expect(document.querySelector(".animate-pulse")).toBeFalsy();
  });

  it("transitions skeleton → empty when consume returns null", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockResolvedValue(null);

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → permission-required on AccessibilityDenied", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue("AccessibilityDenied: ...");

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    // invoke 用于解除 blur-auto-hide 抑制
    expect(mockInvoke).toHaveBeenCalledWith("set_overlay_permission_state", {
      suppressed: true,
    });
    expect(screen.getByText("我已授权，重试")).toBeTruthy();
  });

  it("transitions skeleton → empty on NoSelection error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue("NoSelection: ...");

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → empty on UnsupportedElement error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue("UnsupportedElement: ...");

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → empty on ClipboardTimeout error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue('"ClipboardTimeout"');

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    // 等待 toast.error 被调用以确认异步 catch 块完成
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("目标应用未响应，请重试");
    });
    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → empty on ClipboardLockFailed error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue('"ClipboardLockFailed"');

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("操作太频繁，请稍后再试");
    });
    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → empty on unknown error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue("SomeRandomError");

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    // 未知错误也fallback到empty
    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("retry button resets to skeleton and unsuppresses permission", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockRejectedValue("AccessibilityDenied: ...");

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("我已授权，重试")).toBeTruthy();

    // 点击重试
    await act(async () => {
      fireEvent.click(screen.getByText("我已授权，重试"));
    });

    // 应回到 skeleton
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    // 应解除权限抑制
    expect(mockInvoke).toHaveBeenCalledWith("set_overlay_permission_state", {
      suppressed: false,
    });
  });

  it("ignores shortcut-a events", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-a"));
    });

    // overlay 不应消费 shortcut-a 的事件
    expect(mockInvoke).not.toHaveBeenCalled();
    // 应保持 skeleton 态
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("Esc key hides overlay", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockHide).toHaveBeenCalled();
  });

  it("non-Esc key does not hide overlay", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    expect(mockHide).not.toHaveBeenCalled();
  });

  it("removes Esc listener on unmount", async () => {
    mockListen.mockResolvedValue(vi.fn());

    const { unmount } = await act(async () => {
      return render(<Overlay />);
    });

    unmount();

    // 卸载后 Esc 不再触发 hide
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockHide).not.toHaveBeenCalled();
  });
});

// ── Strict Mode 安全测试 ────────────────────────────────────────────────────

describe("Strict Mode listener safety", () => {
  it("double-mount: only one active listener after final mount", async () => {
    // 模拟 Strict Mode：mount → unmount → mount
    const unlisten1 = vi.fn();
    const unlisten2 = vi.fn();
    let callCount = 0;

    mockListen.mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? unlisten1 : unlisten2);
    });

    const { unmount } = await act(async () => {
      return render(<Overlay />);
    });

    // 第一次 mount 注册了 listener
    expect(callCount).toBe(1);

    // 模拟 Strict Mode unmount（cleanup 调用 unlisten1）
    unmount();

    // 模拟 Strict Mode remount
    await act(async () => {
      render(<Overlay />);
    });

    // 第二次 mount 重新注册
    expect(callCount).toBe(2);

    // 第一次的 unlisten 被 cleanup 调用
    expect(unlisten1).toHaveBeenCalled();
    // 第二次的 unlisten 尚未调用
    expect(unlisten2).not.toHaveBeenCalled();
  });

  it("single mount registers exactly one listener", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    await act(async () => {
      render(<Overlay />);
    });

    expect(mockListen).toHaveBeenCalledTimes(1);
  });
});
