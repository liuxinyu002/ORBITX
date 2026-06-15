/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskDraft } from "../useTaskDraft";

// mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

describe("useTaskDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function render(selectedTaskId: string | null = null) {
    const onSaved = vi.fn();
    const result = renderHook(
      ({ id }: { id: string | null }) => useTaskDraft({ selectedTaskId: id, onSaved }),
      {
        initialProps: { id: selectedTaskId },
      },
    );
    return { ...result, onSaved };
  }

  // ── CP-13: 字段增删改 + isDirty ─────────────────────────────────────

  it("starts with empty fields and not dirty", () => {
    const { result } = render(null);
    expect(result.current.fields).toEqual([]);
    expect(result.current.isDirty).toBe(false);
  });

  it("addField appends default field and marks dirty", () => {
    const { result } = render(null);

    act(() => {
      result.current.addField();
    });

    expect(result.current.fields).toHaveLength(1);
    expect(result.current.fields[0]).toEqual({
      name: "",
      type: "String",
      required: false,
      description: "",
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("removeField deletes field and marks dirty", () => {
    const { result } = render(null);

    act(() => {
      result.current.addField();
    });
    act(() => {
      result.current.removeField(0);
    });

    expect(result.current.fields).toHaveLength(0);
    expect(result.current.isDirty).toBe(true);
  });

  it("updateField modifies field and marks dirty", () => {
    const { result } = render(null);

    act(() => {
      result.current.addField();
    });
    // reset dirty for test clarity
    // dirty is already true from addField, just check updateField also works
    act(() => {
      result.current.updateField(0, { name: "user_name", type: "Number" });
    });

    expect(result.current.fields[0].name).toBe("user_name");
    expect(result.current.fields[0].type).toBe("Number");
    expect(result.current.isDirty).toBe(true);
  });

  it("replaceFields overwrites all fields and marks dirty", () => {
    const { result } = render(null);

    act(() => {
      result.current.replaceFields([
        { name: "email", type: "String", required: true, description: "邮箱" },
        { name: "phone", type: "String", required: false, description: "电话" },
      ]);
    });

    expect(result.current.fields).toHaveLength(2);
    expect(result.current.isDirty).toBe(true);
  });

  // ── CP-16: 保存 Schema 流程 (Zod 校验 → update_task) ─────────────────

  it("saveSchema passes valid fields to update_task", async () => {
    // loadTask: get_task
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "task-1",
      name: "测试任务",
      description: null,
      schema: null,
    });

    const { result, onSaved } = render("task-1");
    await act(() => Promise.resolve());

    // reset invoke mock for saveSchema calls
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);

    act(() => {
      result.current.replaceFields([
        { name: "email", type: "String", required: true, description: "邮箱" },
      ]);
    });

    await act(async () => {
      await result.current.saveSchema();
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", {
      id: "task-1",
      name: null,
      description: "",
      schema: JSON.stringify({
        fields: [
          { name: "email", type: "String", required: true, description: "邮箱" },
        ],
      }),
    });
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("保存成功");
    expect(onSaved).toHaveBeenCalled();
    expect(result.current.isDirty).toBe(false);
  });

  it("saveSchema rejects empty field names", async () => {
    // mock loadTask 的 get_task
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "task-1",
      name: "测试任务",
      description: null,
      schema: null,
    });

    const { result } = render("task-1");
    // 等待 useEffect loadTask 完成
    await act(() => Promise.resolve());
    vi.mocked(invoke).mockClear(); // 清除 loadTask 的调用记录

    act(() => {
      result.current.addField(); // adds field with empty name
    });

    await act(async () => {
      await result.current.saveSchema();
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("字段名不能为空");
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("saveSchema rejects duplicate field names", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "task-1",
      name: "测试任务",
      description: null,
      schema: null,
    });

    const { result } = render("task-1");
    await act(() => Promise.resolve());
    vi.mocked(invoke).mockClear(); // 清除 loadTask 的调用记录

    act(() => {
      result.current.replaceFields([
        { name: "user_name", type: "String", required: true, description: "" },
        { name: "user_name", type: "Number", required: false, description: "" },
      ]);
    });

    await act(async () => {
      await result.current.saveSchema();
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "同一任务中的字段名不能重复",
    );
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  // ── CP-18: 任务名失焦自动保存 ───────────────────────────────────────

  it("saveTaskName updates only name", async () => {
    // loadTask: get_task
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "task-1",
      name: "旧名称",
      description: null,
      schema: null,
    });

    const { result, onSaved } = render("task-1");
    await act(() => Promise.resolve());

    // reset mock for update_task call
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);

    act(() => {
      result.current.setTaskName("新名称");
    });

    await act(async () => {
      await result.current.saveTaskName();
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", {
      id: "task-1",
      name: "新名称",
      description: null,
      schema: null,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("saveTaskName rolls back on failure", async () => {
    // loadTask: get_task
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "task-1",
      name: "旧名称",
      description: null,
      schema: null,
    });
    // saveTaskName: update_task fails
    vi.mocked(invoke).mockRejectedValueOnce(new Error("网络错误"));
    // rollback: get_task returns old value
    vi.mocked(invoke).mockResolvedValueOnce({ name: "旧名称" });

    const { result } = render("task-1");
    await act(() => Promise.resolve());

    act(() => {
      result.current.setTaskName("新名称");
    });

    await act(async () => {
      await result.current.saveTaskName();
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "任务名保存失败: 网络错误",
    );
    // 回退到旧值
    expect(result.current.taskName).toBe("旧名称");
  });
});
