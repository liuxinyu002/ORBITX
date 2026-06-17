/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";

// ── Mock Tauri APIs ──────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockHide = vi.fn();
const mockSetSize = vi.fn();
const mockListen = vi.fn();
const mockEmit = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
  emit: (...args: unknown[]) => mockEmit(...args),
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

/** 构造 view:render-overlay 事件 payload */
function renderOverlayPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      text: "hello world",
      truncated: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_tasks")
      return Promise.resolve({ tasks: [], activeTaskId: null });
    if (cmd === "set_active_task_id") return Promise.resolve(undefined);
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

  it("transitions skeleton → content when view:render-overlay yields text", async () => {
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
    });

    // list_tasks 被调用
    expect(mockInvoke).toHaveBeenCalledWith("list_tasks");
    // 内容已渲染
    expect(screen.getByText("hello world")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeFalsy();
  });

  it("transitions skeleton → permission-required when tag is permission-required", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(renderOverlayPayload({ tag: "permission-required", text: "" }));
    });

    expect(screen.getByText("重试")).toBeTruthy();
    // list_tasks 不应被调用（permission-required 提前返回）
    expect(mockInvoke).not.toHaveBeenCalledWith("list_tasks");
  });

  it("retry button hides overlay", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      getCallback()(renderOverlayPayload({ tag: "permission-required", text: "" }));
    });

    expect(screen.getByText("重试")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("重试"));
    });

    expect(mockHide).toHaveBeenCalled();
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

  // ── 正常模式派发按钮 ──────────────────────────────────────────────────

  it("shows dispatch button when content state has activeTaskId", async () => {
    const tasks = [
      { id: "t1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "t1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
    });

    expect(screen.getByText("派发")).toBeTruthy();
  });

  it("dispatch button is disabled when no activeTaskId", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
    });

    const btn = screen.getByText("派发");
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("dispatch emits task:manual-extract and hides overlay", async () => {
    const tasks = [
      { id: "t1", name: "Task A", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "t1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
    });

    await act(async () => {
      fireEvent.click(screen.getByText("派发"));
    });

    expect(mockEmit).toHaveBeenCalledWith("task:manual-extract", {
      text: "hello world",
      taskId: "t1",
      force: false,
      truncated: false,
    });

    // 等待 fade-out 完成
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(mockHide).toHaveBeenCalled();
  });

  // ── 降级模式测试 ──────────────────────────────────────────────────────

  it("renders fallback mode with warning reason and collapsed text", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "AI 判定不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    // 警告原因可见
    expect(screen.getByText("AI 判定不相关")).toBeTruthy();
    // 折叠文本存在
    expect(screen.getByText("hello world")).toBeTruthy();
    // 降级操作按钮可见
    expect(screen.getByText("强制入库")).toBeTruthy();
    expect(screen.getByText("丢弃")).toBeTruthy();
    // 展开按钮可见
    expect(screen.getByText("▸ 展开原文")).toBeTruthy();
  });

  it("expand/collapse text in fallback mode", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "AI 判定不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    // 初始状态：折叠
    expect(screen.getByText("▸ 展开原文")).toBeTruthy();

    // 点击展开
    await act(async () => {
      fireEvent.click(screen.getByText("▸ 展开原文"));
    });

    expect(screen.getByText("▾ 收起原文")).toBeTruthy();

    // 点击收起
    await act(async () => {
      fireEvent.click(screen.getByText("▾ 收起原文"));
    });

    expect(screen.getByText("▸ 展开原文")).toBeTruthy();
  });

  it("fallback mode shows truncated suffix when truncated=true", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          truncated: true,
          fallback: {
            reason: "AI 判定不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    expect(
      screen.getByText(/内容受字符阈值限制已在抓取时截断/),
    ).toBeTruthy();
  });

  it("force insert emits task:manual-extract with force:true", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText("强制入库"));
    });

    expect(mockEmit).toHaveBeenCalledWith("task:manual-extract", {
      text: "hello world",
      taskId: "task-1",
      force: true,
      truncated: false,
    });
  });

  it("discard hides overlay in fallback mode", async () => {
    const { getCallback } = mockListenWithCallback();

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText("丢弃"));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(mockHide).toHaveBeenCalled();
  });

  it("confirm button appears when reselecting different task in fallback mode", async () => {
    const tasks = [
      { id: "task-1", name: "Failed Task", description: null, updatedAt: "2024-01-01" },
      { id: "task-2", name: "Other Task", description: null, updatedAt: "2024-01-02" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "task-1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    // 重新派发按钮不应可见（还未重新选择）
    expect(screen.queryByText("重新派发")).toBeFalsy();

    // 打开下拉并选择另一个任务
    const triggerBtn = screen.getByText("Failed Task");
    await act(async () => {
      fireEvent.click(triggerBtn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const otherTaskBtn = screen.getByText("Other Task");
    await act(async () => {
      fireEvent.click(otherTaskBtn);
    });

    // 重新派发按钮现在可见
    expect(screen.getByText("重新派发")).toBeTruthy();
  });

  it("confirm emits task:manual-extract with new taskId in fallback mode", async () => {
    const tasks = [
      { id: "task-1", name: "Failed Task", description: null, updatedAt: "2024-01-01" },
      { id: "task-2", name: "Other Task", description: null, updatedAt: "2024-01-02" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "task-1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    // 打开下拉并选择另一个任务
    const triggerBtn = screen.getByText("Failed Task");
    await act(async () => {
      fireEvent.click(triggerBtn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Other Task"));
    });

    // 点击重新派发
    await act(async () => {
      fireEvent.click(screen.getByText("重新派发"));
    });

    expect(mockEmit).toHaveBeenCalledWith("task:manual-extract", {
      text: "hello world",
      taskId: "task-2",
      force: false,
      truncated: false,
    });
  });

  it("shows ⚠ indicator for failed task in fallback dropdown", async () => {
    const tasks = [
      { id: "task-1", name: "Failed Task", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "task-1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(
        renderOverlayPayload({
          fallback: {
            reason: "不相关",
            failedTaskId: "task-1",
          },
        }),
      );
    });

    // 触发按钮中显示 ⚠ + 任务名
    const triggerBtn = screen.getByText("Failed Task");
    expect(triggerBtn).toBeTruthy();
    // ⚠ 字符存在（警告头和触发按钮中各一个）
    const warnings = screen.getAllByText("⚠");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
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

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 48 + 2 * 36 + 8 }),
    );
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

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const taskBtn = screen.getByText("Task A");
    await act(async () => {
      fireEvent.click(taskBtn);
    });

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

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const taskButtons = screen.getAllByText("Task A");
    const dropdownItem = taskButtons[taskButtons.length - 1];
    await act(async () => {
      fireEvent.click(dropdownItem);
    });

    expect(mockInvoke).toHaveBeenCalledWith("set_active_task_id", { id: null });
  });
});

// ── Strict Mode 安全测试 ────────────────────────────────────────────────────

describe("Strict Mode listener safety", () => {
  it("single mount registers exactly one listener", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    await act(async () => {
      render(<Overlay />);
    });

    expect(mockListen).toHaveBeenCalledTimes(1);
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

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockSetSize).toHaveBeenCalled();
    mockHide.mockClear();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockHide).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

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

    const btn = screen.getByText("选择任务");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    mockSetSize.mockClear();

    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const dropdown = document.querySelector("[class*='overflow-y-auto']");
    expect(dropdown).toBeTruthy();

    await act(async () => {
      fireEvent.transitionEnd(dropdown!);
    });

    expect(mockSetSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 480, height: 48 }),
    );
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
  it("displays active task name when activeTaskId comes from list_tasks", async () => {
    const tasks = [
      { id: "t1", name: "Research Project", description: null, updatedAt: "2024-01-01" },
    ];
    const { getCallback } = mockListenWithCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks, activeTaskId: "t1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
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
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<Overlay />);
    });

    await act(async () => {
      await getCallback()(renderOverlayPayload());
    });

    expect(screen.getByText("选择任务")).toBeTruthy();
  });
});
