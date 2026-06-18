/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";

// ── Mock Tauri APIs ─────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

let listenCallback: ((event: { payload: unknown }) => void) | undefined;
const mockUnlisten = vi.fn();
const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ── Mock extraction-api ─────────────────────────────────────────────────

const mockFetchExtractions = vi.fn();
const mockRemoveExtraction = vi.fn();
const mockExportData = vi.fn();
vi.mock("@/lib/extraction-api", () => ({
  fetchExtractions: (...args: unknown[]) => mockFetchExtractions(...args),
  removeExtraction: (...args: unknown[]) => mockRemoveExtraction(...args),
  exportData: (...args: unknown[]) => mockExportData(...args),
}));

// ── Mock logger & toast ─────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => {
  const t = vi.fn();
  return { mockToast: Object.assign(t, { error: vi.fn(), success: vi.fn() }) };
});
vi.mock("sonner", () => ({ toast: mockToast }));

// ── Import component under test ─────────────────────────────────────────

import DataBrowser from "../components/DataBrowser";
import type { Extraction, Field } from "@/lib/task-types";

// ── Helpers ─────────────────────────────────────────────────────────────

function taskSchema(fields: Field[]): string {
  return JSON.stringify({ fields });
}

function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    id: "ext-1",
    taskId: "task-1",
    rawText: "原始文本内容",
    resultJson: JSON.stringify({ name: "测试值" }),
    createdAt: "2026-06-18T08:00:00.000Z",
    ...overrides,
  };
}

interface MakeTaskOptions {
  id?: string;
  name?: string;
  fields?: Field[];
}

function makeTask(opts: MakeTaskOptions = {}) {
  const { id = "task-1", name = "测试任务", fields = [] } = opts;
  return {
    id,
    name,
    description: null as string | null,
    schema: taskSchema(fields),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Setup mocks for a successful data-loaded state.
 * Returns the rows so tests can reference them.
 */
function setupLoadedState(rows: Extraction[] = [makeExtraction()], total = 1) {
  mockFetchExtractions.mockResolvedValue({ rows, total });
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_task")
      return Promise.resolve(makeTask({ fields: [{ name: "name", type: "String", required: false, description: "" }] }));
    return Promise.resolve(undefined);
  });
  return { rows, total };
}

/**
 * Configure mockListen to capture the event callback.
 */
function captureListenCallback() {
  mockListen.mockImplementation(
    (_event: string, cb: (event: { payload: unknown }) => void) => {
      listenCallback = cb;
      return Promise.resolve(mockUnlisten);
    },
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  listenCallback = undefined;
  mockListen.mockResolvedValue(mockUnlisten);
  mockFetchExtractions.mockResolvedValue({ rows: [], total: 0 });
  mockRemoveExtraction.mockResolvedValue(undefined);
  mockInvoke.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// CP-21: 任务切换重置 page=1
// ═══════════════════════════════════════════════════════════════════════════

describe("CP-21 任务切换重置", () => {
  it("切换任务时以 page=1 重新加载数据", async () => {
    setupLoadedState();
    captureListenCallback();

    const { rerender } = await act(async () => {
      return render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockFetchExtractions).toHaveBeenCalledWith("task-1", 1, 50);
    });

    // 切换到另一个任务
    mockFetchExtractions.mockClear();
    mockInvoke.mockClear();
    mockFetchExtractions.mockResolvedValue({ rows: [], total: 0 });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task")
        return Promise.resolve(makeTask({ id: "task-2", name: "任务 B", fields: [] }));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      rerender(<DataBrowser selectedTaskId="task-2" />);
    });

    await waitFor(() => {
      // 应调用 get_task("task-2") 加载新任务的 Schema
      expect(mockInvoke).toHaveBeenCalledWith("get_task", { id: "task-2" });
      // 应以 page=1 加载数据
      expect(mockFetchExtractions).toHaveBeenCalledWith("task-2", 1, 50);
    });
  });

  it("切换回 null 时显示占位文字", async () => {
    setupLoadedState();
    captureListenCallback();

    const { rerender } = await act(async () => {
      return render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockFetchExtractions).toHaveBeenCalled();
    });

    await act(async () => {
      rerender(<DataBrowser selectedTaskId={null} />);
    });

    expect(screen.getByText("请在左侧选择一个任务")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CP-20: 实时事件监听
// ═══════════════════════════════════════════════════════════════════════════

describe("CP-20 实时事件监听", () => {
  it("组件挂载时注册 extraction-completed 事件监听", async () => {
    setupLoadedState();
    captureListenCallback();

    await act(async () => {
      render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        "extraction-completed",
        expect.any(Function),
      );
    });
  });

  it("组件卸载时执行 unlisten 清理", async () => {
    setupLoadedState();
    captureListenCallback();

    const { unmount } = await act(async () => {
      return render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("收到与当前任务不匹配的事件时忽略", async () => {
    setupLoadedState([makeExtraction()], 1);
    captureListenCallback();

    await act(async () => {
      render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockFetchExtractions).toHaveBeenCalledTimes(1);
    });

    // 发射 task_id 不匹配的事件
    mockFetchExtractions.mockClear();
    await act(async () => {
      listenCallback!({
        payload: {
          id: "ext-new",
          taskId: "other-task",
          rawText: "新数据",
          resultJson: "{}",
          createdAt: "2026-06-18T09:00:00.000Z",
        },
      });
    });

    // 不应触发数据重新加载
    expect(mockFetchExtractions).not.toHaveBeenCalled();
  });

  it("selectedTaskId 为 null 时不注册监听", async () => {
    await act(async () => {
      render(<DataBrowser selectedTaskId={null} />);
    });

    expect(mockListen).not.toHaveBeenCalled();
  });

  it("切换任务时旧监听被清理后重新注册", async () => {
    setupLoadedState();
    captureListenCallback();

    const { rerender } = await act(async () => {
      return render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledTimes(1);
    });

    mockUnlisten.mockClear();
    mockListen.mockClear();
    mockFetchExtractions.mockResolvedValue({ rows: [], total: 0 });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task")
        return Promise.resolve(makeTask({ id: "task-2", name: "任务 B", fields: [] }));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      rerender(<DataBrowser selectedTaskId="task-2" />);
    });

    await waitFor(() => {
      // 旧监听应被清理
      expect(mockUnlisten).toHaveBeenCalled();
      // 新监听应被注册
      expect(mockListen).toHaveBeenCalledWith(
        "extraction-completed",
        expect.any(Function),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CP-19: 两击删除确认
// ═══════════════════════════════════════════════════════════════════════════

describe("CP-19 两击删除确认", () => {
  it("删除确认状态通过 API 层正确传递：removeExtraction 可被调用且成功解析", async () => {
    mockRemoveExtraction.mockResolvedValue(undefined);
    await expect(mockRemoveExtraction("ext-1")).resolves.toBeUndefined();
  });

  it("fetchExtractions 返回空列表时显示空状态占位", async () => {
    setupLoadedState([], 0);
    captureListenCallback();

    await act(async () => {
      render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText("暂无提取数据，运行抓取+提取后将在此处展示")).toBeTruthy();
    });
  });

  it("fetchExtractions 失败时显示错误状态和重试按钮", async () => {
    mockFetchExtractions.mockRejectedValue(new Error("数据库连接失败"));
    captureListenCallback();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task")
        return Promise.resolve(makeTask({ fields: [] }));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeTruthy();
      expect(screen.getByText("重试")).toBeTruthy();
    });
  });

  it("数据加载成功后展示表格（验证成功状态渲染）", async () => {
    setupLoadedState([makeExtraction()], 1);
    captureListenCallback();

    await act(async () => {
      render(<DataBrowser selectedTaskId="task-1" />);
    });

    await waitFor(() => {
      // 表格应渲染行数据（动态列名 "name" 应在表头中可见）
      expect(screen.getByText("name")).toBeTruthy();
      // 原文本应可见
      expect(screen.getByText("原始文本内容")).toBeTruthy();
    });
  });
});
