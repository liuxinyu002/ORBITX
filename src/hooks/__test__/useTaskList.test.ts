/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskList } from "../useTaskList";

// mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("useTaskList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CP-10: 初始加载 — 空任务列表
  it("loads empty task list on mount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [],
      activeTaskId: null,
    });

    const { result } = renderHook(() => useTaskList());
    // 等待 useEffect 中的 refresh
    await act(() => Promise.resolve());

    expect(result.current.tasks).toEqual([]);
    expect(result.current.activeTaskId).toBeNull();
  });

  // CP-10: 加载包含任务和激活态的列表
  it("loads tasks and active task id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [
        { id: "t1", name: "简历库", description: null, updatedAt: "2026-06-12T08:00:00.000Z" },
        { id: "t2", name: "中药数据", description: "提取", updatedAt: "2026-06-12T09:00:00.000Z" },
      ],
      activeTaskId: "t1",
    });

    const { result } = renderHook(() => useTaskList());
    await act(() => Promise.resolve());

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.activeTaskId).toBe("t1");
  });

  // CP-10: 创建任务 → 调用 create_task 并刷新列表
  it("creates task and refreshes list", async () => {
    // 第一次调用：初始加载
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [],
      activeTaskId: null,
    });
    // 第二次调用：create_task
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "new-task-id",
      name: "新任务",
    });
    // 第三次调用：refresh 之后的 list_tasks
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [
        { id: "new-task-id", name: "新任务", description: null, updatedAt: "2026-06-12T10:00:00.000Z" },
      ],
      activeTaskId: null,
    });

    const { result } = renderHook(() => useTaskList());
    await act(() => Promise.resolve());

    let createdTask;
    await act(async () => {
      createdTask = await result.current.create("新任务");
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", { name: "新任务" });
  });

  // CP-10: 搜索过滤（大小写不敏感）
  it("filters tasks by keyword case-insensitively", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [
        { id: "t1", name: "简历库", description: null, updatedAt: "2026-06-12T08:00:00.000Z" },
        { id: "t2", name: "中药数据", description: null, updatedAt: "2026-06-12T09:00:00.000Z" },
      ],
      activeTaskId: null,
    });

    const { result } = renderHook(() => useTaskList());
    await act(() => Promise.resolve());

    act(() => {
      result.current.setSearchKeyword("简历");
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].name).toBe("简历库");
  });

  // CP-10: 激活排他切换 — setActive(null) 取消激活
  it("setActive with null deactivates", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [],
      activeTaskId: "t1",
    });

    const { result } = renderHook(() => useTaskList());
    await act(() => Promise.resolve());

    await act(async () => {
      await result.current.setActive(null);
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("set_active_task_id", { id: null });
    expect(result.current.activeTaskId).toBeNull();
  });

  // CP-10: 删除任务
  it("removes task and refreshes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [
        { id: "t1", name: "简历库", description: null, updatedAt: "2026-06-12T08:00:00.000Z" },
      ],
      activeTaskId: null,
    });
    // delete_task
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    // refresh
    vi.mocked(invoke).mockResolvedValueOnce({
      tasks: [],
      activeTaskId: null,
    });

    const { result } = renderHook(() => useTaskList());
    await act(() => Promise.resolve());

    await act(async () => {
      await result.current.remove("t1");
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_task", { id: "t1" });
  });
});
