/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";

// ── Mock Tauri APIs ──────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockHide = vi.fn();
const mockSetSize = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    hide: () => mockHide(),
    setSize: (size: { width: number; height: number }) => mockSetSize(size),
  }),
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

// Mock log 函数以避免实际调用
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

import Overlay from "../overlay";

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

function grabPayload(source: string, requestId = "test-request-id") {
  return { payload: { requestId, source } };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_tasks")
      return Promise.resolve({ tasks: [], activeTaskId: null });
    if (cmd === "consume_grabbed_result") return Promise.resolve(null);
    return Promise.resolve(undefined);
  });
});

// ── 状态机测试 ──────────────────────────────────────────────────────────────

describe("Overlay state machine", () => {
  it("renders skeleton on mount", async () => {
    mockListen.mockResolvedValue(vi.fn());
    await act(async () => {
      render(<Overlay />);
    });
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("transitions skeleton → content when grab-completed yields text", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.resolve({ text: "hello world", truncated: false });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(mockInvoke).toHaveBeenCalledWith("list_tasks");
    expect(mockInvoke).toHaveBeenCalledWith("consume_grabbed_result", {
      requestId: "test-request-id",
    });

    // 内容已渲染（truncateMiddle 可能保留原文如果 short enough）
    expect(screen.getByText("hello world")).toBeTruthy();
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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject("AccessibilityDenied: ...");
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(mockInvoke).toHaveBeenCalledWith("set_overlay_permission_state", {
      suppressed: true,
    });
    expect(screen.getByText("重试")).toBeTruthy();
  });

  it("transitions skeleton → empty on NoSelection error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject("NoSelection: ...");
      return Promise.resolve(undefined);
    });

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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject("UnsupportedElement: ...");
      return Promise.resolve(undefined);
    });

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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject('"ClipboardTimeout"');
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("目标应用未响应，请重试");
    });
    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("transitions skeleton → empty on ClipboardLockFailed error", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject('"ClipboardLockFailed"');
      return Promise.resolve(undefined);
    });

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
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject("SomeRandomError");
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("未发现选中文本")).toBeTruthy();
  });

  it("retry button resets to skeleton and unsuppresses permission", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.reject("AccessibilityDenied: ...");
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("重试")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("重试"));
    });

    expect(document.querySelector(".animate-pulse")).toBeTruthy();
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

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("Esc key hides overlay when dropdown is closed", async () => {
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
      fireEvent.keyDown(window, { key: "a" });
    });

    expect(mockHide).not.toHaveBeenCalled();
  });

  it("removes Esc listener on unmount", async () => {
    mockListen.mockResolvedValue(vi.fn());

    const { unmount } = await act(async () => {
      return render(<Overlay />);
    });

    unmount();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockHide).not.toHaveBeenCalled();
  });

  // ── 下拉交互测试 ──────────────────────────────────────────────────────

  it("toggleDropdown: opens dropdown and calls setSize when list_tasks succeeds", async () => {
    mockListen.mockResolvedValue(vi.fn());
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({
          tasks: [
            { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
            { id: "2", name: "Task B", description: null, updatedAt: "2024-01-02" },
          ],
          activeTaskId: "1",
        });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 初始按钮显示 "选择任务"
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    // 等待 opening → open
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 应展开窗口
    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 48 + 2 * 36 + 8 }),
    );
  });

  it("toggleDropdown: shows toast and does not open on list_tasks failure", async () => {
    mockListen.mockResolvedValue(vi.fn());
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks") return Promise.reject("error");
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(mockToast.error).toHaveBeenCalledWith("任务列表加载失败");
    // 不应调用 setSize
    expect(mockSetSize).not.toHaveBeenCalled();
  });

  it("selectTask: optimistic update + rollback on failure", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = [
      { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      if (cmd === "set_active_task_id")
        return Promise.reject("error");
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 打开下拉
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    // 等待 opening → open 阶段完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // 选择任务
    const taskBtn = screen.getByText("Task A");
    await act(async () => {
      fireEvent.click(taskBtn);
    });

    // 应触发 toast
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("任务切换失败");
    });
  });

  it("deselect active task: calls set_active_task_id with null", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = [
      { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 点击 "选择任务" 打开下拉
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 下拉中的任务项（与按钮中的 "Task A" 区分：通过 role 查询 dropdown 内按钮）
    const taskButtons = screen.getAllByText("Task A");
    // 第二个 "Task A" 在下拉列表中
    const dropdownItem = taskButtons[taskButtons.length - 1];
    await act(async () => {
      fireEvent.click(dropdownItem);
    });

    expect(mockInvoke).toHaveBeenCalledWith("set_active_task_id", { id: null });
  });
});

// ── Strict Mode 安全测试 ────────────────────────────────────────────────────

describe("Strict Mode listener safety", () => {
  it("double-mount: only one active listener after final mount", async () => {
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

    expect(callCount).toBe(1);

    unmount();

    await act(async () => {
      render(<Overlay />);
    });

    expect(callCount).toBe(2);
    expect(unlisten1).toHaveBeenCalled();
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

// ── expandedHeight 公式测试 ──────────────────────────────────────────────

describe("expandedHeight formula", () => {
  it("calculates minimum height with 0 tasks", async () => {
    mockListen.mockResolvedValue(vi.fn());
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    // 0 tasks: 48 + 0 + 8 = 56
    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 56 }),
    );
  });

  it("caps at 6 visible items for 10 tasks", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      name: `Task ${i}`,
      description: null,
      updatedAt: "2024-01-01",
    }));
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    // 10 tasks capped at 6: 48 + 6*36 + 8 = 272
    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 272 }),
    );
  });

  it("calculates correct height for 3 tasks", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      id: `${i}`,
      name: `Task ${i}`,
      description: null,
      updatedAt: "2024-01-01",
    }));
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    // 3 tasks: 48 + 3*36 + 8 = 164
    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 164 }),
    );
  });
});

// ── Active task indicator 测试 ──────────────────────────────────────────

describe("Active task indicator", () => {
  it("displays active task name when activeTaskId is set via grab event", async () => {
    const tasks = [
      { id: "t1", name: "Research Project", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "t1" });
      if (cmd === "consume_grabbed_result")
        return Promise.resolve({ text: "hello", truncated: false });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("Research Project")).toBeTruthy();
    expect(screen.queryByText("选择任务")).toBeFalsy();
  });

  it("shows 选择任务 when activeTaskId is null", async () => {
    const tasks = [
      { id: "t1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      if (cmd === "consume_grabbed_result")
        return Promise.resolve({ text: "hello", truncated: false });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(grabPayload("shortcut-b"));
    });

    expect(screen.getByText("选择任务")).toBeTruthy();
  });
});

// ── Esc 分层关闭测试 ────────────────────────────────────────────────────

describe("Esc two-tier close", () => {
  it("closes dropdown on first Esc but does NOT hide overlay", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = [
      { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 打开下拉
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 验证下拉已打开
    expect(mockSetSize).toHaveBeenCalled();
    mockHide.mockClear();

    // 第一次 Esc → 关闭下拉，不隐藏 overlay
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockHide).not.toHaveBeenCalled();

    // 等待 fallback timer 完成关闭
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // 第二次 Esc → 隐藏 overlay
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockHide).toHaveBeenCalled();
  });

  it("hides overlay immediately when Esc pressed with dropdown already closed", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(mockHide).toHaveBeenCalled();
  });
});

// ── TransitionEnd handler 测试 ─────────────────────────────────────────

describe("TransitionEnd handler", () => {
  it("calls setSize(480,48) when dropdown transition ends during closing", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = [
      { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 打开下拉
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 清除 open 阶段的 setSize 调用记录
    mockSetSize.mockClear();

    // 关闭下拉 (toggle)
    await act(async () => {
      fireEvent.click(btn);
    });

    // 等待 closing 阶段开始
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // 找到下拉面板并触发 transitionEnd
    const dropdown = document.querySelector("[class*='overflow-y-auto']");
    expect(dropdown).toBeTruthy();

    await act(async () => {
      fireEvent.transitionEnd(dropdown!);
    });

    // transitionEnd 触发 setSize(480, 48)
    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 48 }),
    );
  });

  it("transitionEnd does NOT trigger setSize when not in closing phase", async () => {
    mockListen.mockResolvedValue(vi.fn());
    const tasks = [
      { id: "1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    // 打开下拉
    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 清除 open 阶段的 setSize 调用记录
    mockSetSize.mockClear();

    // 在下拉打开状态触发 transitionEnd（不应触发 setSize，phase 不是 closing）
    const dropdown = document.querySelector("[class*='overflow-y-auto']");
    await act(async () => {
      fireEvent.transitionEnd(dropdown!);
    });

    expect(mockSetSize).not.toHaveBeenCalled();
  });
});

// ── ToolSlot 渲染测试 ───────────────────────────────────────────────────

describe("ToolSlot rendering", () => {
  it("renders future tool slots with opacity-40 and tabindex=0", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<Overlay />);
    });

    const toolSlots = document.querySelectorAll('[role="button"][tabindex="0"]');
    expect(toolSlots.length).toBe(2);

    toolSlots.forEach((slot) => {
      expect(slot.classList.contains("opacity-40")).toBe(true);
    });
  });

  it("tool slots have tooltip via title attribute", async () => {
    mockListen.mockResolvedValue(vi.fn());

    await act(async () => {
      render(<Overlay />);
    });

    expect(screen.getByTitle("更多工具")).toBeTruthy();
    expect(screen.getByTitle("扩展功能")).toBeTruthy();
  });
});
