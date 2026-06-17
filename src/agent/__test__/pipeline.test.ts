/**
 * CP-8, CP-9, CP-11, CP-12, CP-14: 提取管线 — 单元测试。
 *
 * 覆盖：runExtraction 各路径（no-task abort、model error、
 *   response parse fail→fallback、force bypass）。
 * routeResult 路由逻辑通过 mock complete + invoke 间接覆盖。
 *
 * 注意：complete() 和 invoke() 全部 mock，不发起真实 API 调用。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock Tauri invoke + sonner toast + logger ───────────────────────────────

const mockInvoke = vi.fn();
const mockToast = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockLog = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (...args: unknown[]) => mockToast(...args),
    {
      error: (...args: unknown[]) => mockToastError(...args),
      success: (...args: unknown[]) => mockToastSuccess(...args),
    },
  ),
}));

vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

// ── Mock pi-ai complete ─────────────────────────────────────────────────────

const mockComplete = vi.fn();

vi.mock("@earendil-works/pi-ai", () => ({
  complete: (...args: unknown[]) => mockComplete(...args),
}));

// ── Mock provider registry ──────────────────────────────────────────────────

vi.mock("@/agent/providers/registry", () => ({
  resolveModel: () => ({}),
}));

// ── 辅助函数 ────────────────────────────────────────────────────────────────

import { runExtraction } from "../pipeline";

import type { ModelConfig } from "../types";
import type { Task } from "@/lib/task-types";

function makeModel(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    id: "m1",
    provider: "custom",
    label: "TestGPT",
    baseUrl: "https://api.test.com",
    modelId: "gpt-4",
    modelName: "GPT-4 Test",
    apiKey: "sk-test",
    isActive: true,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "task-1",
    name: "Email Extractor",
    description: "提取邮箱信息",
    schema: JSON.stringify({
      fields: [
        { name: "email", type: "String", required: true, description: "邮箱地址" },
      ],
    }),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeApiResponse(content: string) {
  return {
    stopReason: "end_turn" as const,
    content,
    usage: { inputTokens: 10, outputTokens: 20 },
  };
}

function makeApiError(message: string) {
  return {
    stopReason: "error" as const,
    content: [] as Array<{ type: string; text?: string }>,
    errorMessage: message,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 测试用例 ────────────────────────────────────────────────────────────────

describe("runExtraction — no active task (CP-12)", () => {
  it("aborts with toast when silent mode and no taskId", async () => {
    await runExtraction("some text", "silent", makeModel(), undefined, false, false);

    expect(mockToast).toHaveBeenCalledWith("静默失败：无激活任务");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("does NOT abort when manual mode has no taskId (taskId from overlay payload)", async () => {
    // manual mode with no taskId — will fall through to invoke("get_task")
    // which should fail since taskId is undefined → different path
    mockInvoke.mockRejectedValue(new Error("not found"));
    await runExtraction("some text", "manual", makeModel(), undefined, false, false);

    expect(mockComplete).not.toHaveBeenCalled(); // fails at get_task
  });
});

describe("runExtraction — get_task failure", () => {
  it("toasts error when get_task fails", async () => {
    mockInvoke.mockRejectedValue(new Error("task not found"));

    await runExtraction("text", "silent", makeModel(), "invalid-id", false, false);

    expect(mockToastError).toHaveBeenCalledWith("获取任务信息失败");
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("runExtraction — schema parse failure", () => {
  it("toasts error when task schema is malformed JSON", async () => {
    mockInvoke.mockResolvedValue(
      makeTask({ schema: "not-json{{{[" }),
    );

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockToastError).toHaveBeenCalledWith("任务 Schema 格式错误");
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe("runExtraction — model error (CP-13, zero retry)", () => {
  it("toasts error on model API error, no retry", async () => {
    mockInvoke.mockResolvedValue(makeTask());
    mockComplete.mockResolvedValue(makeApiError("rate limit exceeded"));

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("AI 提取失败"),
    );
    // 确认只调用一次（零重试）
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});

describe("runExtraction — JSON parse fail → fallback (CP-15)", () => {
  it("invokes show_overlay when response cannot be parsed in silent mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "show_overlay") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(
      makeApiResponse("this is not json at all"),
    );

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockInvoke).toHaveBeenCalledWith(
      "show_overlay",
      expect.objectContaining({
        payload: expect.objectContaining({
          text: "text",
          fallback: expect.objectContaining({
            reason: expect.stringContaining("无法解析"),
            failedTaskId: "task-1",
          }),
        }),
      }),
    );
  });
});

describe("runExtraction — empty response → fallback", () => {
  it("invokes show_overlay when model returns empty content in silent mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "show_overlay") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue({
      stopReason: "end_turn" as const,
      content: "",
      usage: { inputTokens: 10, outputTokens: 0 },
    });

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockInvoke).toHaveBeenCalledWith(
      "show_overlay",
      expect.objectContaining({
        payload: expect.objectContaining({
          fallback: expect.objectContaining({
            reason: "模型返回内容为空",
          }),
        }),
      }),
    );
  });
});

describe("runExtraction — relevant → insert (CP-8)", () => {
  it("calls insert_extraction and toasts success when is_relevant=true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "insert_extraction") return Promise.resolve("rec-123");
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(
      makeApiResponse(
        JSON.stringify({
          is_relevant: true,
          reason: null,
          data: { email: "test@test.com" },
        }),
      ),
    );

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockInvoke).toHaveBeenCalledWith(
      "insert_extraction",
      expect.objectContaining({
        input: expect.objectContaining({
          taskId: "task-1",
          rawText: "text",
          resultJson: expect.stringContaining("test@test.com"),
        }),
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("已提取");
  });
});

describe("runExtraction — irrelevant → fallback (CP-9)", () => {
  it("invokes show_overlay with fallback when is_relevant=false in silent mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "show_overlay") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(
      makeApiResponse(
        JSON.stringify({
          is_relevant: false,
          reason: "输入文本是购物清单，与邮箱提取任务无关",
          data: null,
        }),
      ),
    );

    await runExtraction("Apples and oranges", "silent", makeModel(), "task-1", false, false);

    expect(mockInvoke).toHaveBeenCalledWith(
      "show_overlay",
      expect.objectContaining({
        payload: expect.objectContaining({
          text: "Apples and oranges",
          fallback: expect.objectContaining({
            reason: "输入文本是购物清单，与邮箱提取任务无关",
            failedTaskId: "task-1",
          }),
        }),
      }),
    );
  });
});

describe("runExtraction — force mode (CP-11)", () => {
  it("skips relevance check and inserts directly when force=true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "insert_extraction") return Promise.resolve("rec-force-1");
      return Promise.resolve(undefined);
    });
    // force mode output: bare data, no is_relevant wrapper
    mockComplete.mockResolvedValue(
      makeApiResponse(
        JSON.stringify({ email: "forced@test.com" }),
      ),
    );

    await runExtraction("text", "manual", makeModel(), "task-1", true, false);

    expect(mockInvoke).toHaveBeenCalledWith(
      "insert_extraction",
      expect.objectContaining({
        input: expect.objectContaining({
          taskId: "task-1",
          resultJson: expect.stringContaining("forced@test.com"),
        }),
      }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("已强制提取");
  });

  it("force mode: toasts error when parsed data is empty", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "show_overlay") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    // force mode with empty response
    mockComplete.mockResolvedValue({
      stopReason: "end_turn" as const,
      content: "",
      usage: { inputTokens: 10, outputTokens: 0 },
    });

    await runExtraction("text", "manual", makeModel(), "task-1", true, false);

    // force mode + empty content → error toast, no show_overlay
    expect(mockToastError).toHaveBeenCalledWith("AI 未返回提取结果");
    expect(mockInvoke).not.toHaveBeenCalledWith("show_overlay", expect.anything());
  });

  it("force mode: toasts error when response is not valid JSON", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(makeApiResponse("not valid json }"));

    await runExtraction("text", "manual", makeModel(), "task-1", true, false);

    expect(mockToastError).toHaveBeenCalledWith("AI 返回格式异常，无法提取");
  });
});

describe("runExtraction — network failure / abort (CP-14)", () => {
  it("toasts error on AbortError (timeout)", async () => {
    mockInvoke.mockResolvedValue(makeTask());
    // 创建一个 AbortError
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockComplete.mockRejectedValue(abortError);

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockToastError).toHaveBeenCalledWith("AI 提取失败，请重试");
    expect(mockComplete).toHaveBeenCalledTimes(1); // zero retry
  });

  it("toasts error on generic network error", async () => {
    mockInvoke.mockResolvedValue(makeTask());
    mockComplete.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockToastError).toHaveBeenCalledWith("AI 提取失败，请重试");
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});

describe("runExtraction — truncated toast", () => {
  it("shows truncation toast after successful extraction with truncated=true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "insert_extraction") return Promise.resolve("rec-1");
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(
      makeApiResponse(
        JSON.stringify({
          is_relevant: true,
          reason: null,
          data: { email: "test@test.com" },
        }),
      ),
    );

    await runExtraction("text", "silent", makeModel(), "task-1", false, true);

    expect(mockToastSuccess).toHaveBeenCalledWith("已提取");
    expect(mockToast).toHaveBeenCalledWith(
      "文本过长，已按 token 上限截断",
      expect.objectContaining({ duration: 4000 }),
    );
  });
});

describe("runExtraction — insert failure", () => {
  it("toasts error when insert_extraction fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_task") return Promise.resolve(makeTask());
      if (cmd === "insert_extraction") return Promise.reject(new Error("DB constraint violation"));
      return Promise.resolve(undefined);
    });
    mockComplete.mockResolvedValue(
      makeApiResponse(
        JSON.stringify({
          is_relevant: true,
          reason: null,
          data: { email: "test@test.com" },
        }),
      ),
    );

    await runExtraction("text", "silent", makeModel(), "task-1", false, false);

    expect(mockToastError).toHaveBeenCalledWith("入库失败，请重试");
  });
});
