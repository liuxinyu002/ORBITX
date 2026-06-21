/// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// ── Mock Tauri APIs ──────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ── Mock sonner ──────────────────────────────────────────────────────────────

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// ── Mock logger ──────────────────────────────────────────────────────────────

const { mockLog } = vi.hoisted(() => ({
  mockLog: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: (...args: unknown[]) => mockLog(...args),
}));

// ── Mock agent (useAgent) ────────────────────────────────────────────────────

const mockUseAgent = vi.fn();

vi.mock("@/agent", () => ({
  useAgent: () => mockUseAgent(),
}));

// ── Mock pipeline ────────────────────────────────────────────────────────────

const mockRunExtraction = vi.fn();

vi.mock("@/agent/pipeline", () => ({
  runExtraction: (...args: unknown[]) => mockRunExtraction(...args),
}));

import ExtractionListener from "../ExtractionListener";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** store callbacks per event channel */
type CallbackMap = Map<string, (event: unknown) => void>;

function mockListenWithCallbacks(): {
  getCallback: (channel: string) => (event: unknown) => void;
  unlisten: ReturnType<typeof vi.fn>;
} {
  const callbacks: CallbackMap = new Map();
  const unlisten = vi.fn();
  mockListen.mockImplementation(
    (channel: string, cb: (event: unknown) => void) => {
      callbacks.set(channel, cb);
      return Promise.resolve(unlisten);
    },
  );
  return {
    getCallback: (channel: string) => {
      const cb = callbacks.get(channel);
      if (!cb) throw new Error(`No callback registered for channel: ${channel}`);
      return cb;
    },
    unlisten,
  };
}

function makeActiveModel() {
  return {
    id: "m1",
    provider: "custom" as const,
    label: "TestGPT",
    baseUrl: "https://api.test.com",
    modelId: "gpt-4",
    modelName: "GPT-4 Test",
    apiKey: "sk-test",
    isActive: true,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  };
}

function silentExtractPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      text: "selected text",
      truncated: false,
      ...overrides,
    },
  };
}

function manualExtractPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      text: "selected text",
      taskId: "task-1",
      force: false,
      truncated: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseAgent.mockReturnValue({ activeModel: makeActiveModel() });
  mockInvoke.mockResolvedValue(undefined);
  mockRunExtraction.mockResolvedValue(undefined);
});

// ── CP-18: Silent extract triggers loading toast ─────────────────────────────

describe("ExtractionListener — silent-extract (CP-18)", () => {
  it("invokes show_toast_command with loading state on silent-extract", async () => {
    const { getCallback } = mockListenWithCallbacks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks") return Promise.resolve({ tasks: [], activeTaskId: null });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:silent-extract")(
        silentExtractPayload({ text: "hello" }),
      );
    });

    expect(mockInvoke).toHaveBeenCalledWith("show_toast_command", {
      payload: {
        state: "loading",
        message: "正在提取…",
      },
    });
  });

  it("calls runExtraction in silent mode after loading toast", async () => {
    const { getCallback } = mockListenWithCallbacks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks")
        return Promise.resolve({ tasks: [], activeTaskId: "task-1" });
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:silent-extract")(
        silentExtractPayload({ text: "hello", truncated: true }),
      );
    });

    // runExtraction 在 show_toast_command 之后调用
    expect(mockRunExtraction).toHaveBeenCalledWith(
      "hello",
      "silent",
      expect.objectContaining({ id: "m1" }),
      "task-1",
      false,
      true,
    );
  });

  it("falls back to sonner toast when show_toast_command fails", async () => {
    const { getCallback } = mockListenWithCallbacks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_tasks") return Promise.resolve({ tasks: [], activeTaskId: null });
      if (cmd === "show_toast_command") return Promise.reject(new Error("window missing"));
      return Promise.resolve(undefined);
    });

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:silent-extract")(silentExtractPayload());
    });

    expect(mockToast).toHaveBeenCalledWith("正在提取…");
  });

  it("skips when activeModel is null", async () => {
    mockUseAgent.mockReturnValue({ activeModel: null });
    const { getCallback } = mockListenWithCallbacks();

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:silent-extract")(silentExtractPayload());
    });

    expect(mockInvoke).not.toHaveBeenCalledWith(
      "show_toast_command",
      expect.anything(),
    );
    expect(mockRunExtraction).not.toHaveBeenCalled();
  });

  it("does not show loading toast when list_tasks fails", async () => {
    const { getCallback } = mockListenWithCallbacks();
    mockInvoke.mockRejectedValue(new Error("db connection lost"));

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:silent-extract")(silentExtractPayload());
    });

    // list_tasks 在 loading toast 之前，失败后提前 return
    // 因此 loading toast 不会被调用
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "show_toast_command",
      expect.anything(),
    );
    expect(mockRunExtraction).not.toHaveBeenCalled();
  });
});

// ── Manual extract ───────────────────────────────────────────────────────────

describe("ExtractionListener — manual-extract", () => {
  it("calls runExtraction without loading toast on manual-extract", async () => {
    const { getCallback } = mockListenWithCallbacks();

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:manual-extract")(
        manualExtractPayload({ text: "hello", taskId: "task-2", force: true }),
      );
    });

    // manual mode 不显示 loading toast
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "show_toast_command",
      expect.anything(),
    );
    expect(mockRunExtraction).toHaveBeenCalledWith(
      "hello",
      "manual",
      expect.objectContaining({ id: "m1" }),
      "task-2",
      true,
      false,
    );
  });

  it("skips when activeModel is null", async () => {
    mockUseAgent.mockReturnValue({ activeModel: null });
    const { getCallback } = mockListenWithCallbacks();

    await act(async () => {
      render(<ExtractionListener />);
    });
    await act(async () => {
      await getCallback("task:manual-extract")(manualExtractPayload());
    });

    expect(mockRunExtraction).not.toHaveBeenCalled();
  });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

describe("ExtractionListener — cleanup", () => {
  it("unregisters listeners on unmount", async () => {
    const { unlisten } = mockListenWithCallbacks();

    const { unmount } = await act(async () => {
      return render(<ExtractionListener />);
    });

    unmount();

    // 两个 listen 注册的 unlisten 都应在取消时被调用
    // cancelled 设为 true 后，unlisten 通过 .then 中的 cancelled 检查，
    // 但 Promise 已 resolve，所以 unlisten 直接调用 fn()
    // wait for promises to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
