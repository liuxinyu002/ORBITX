import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "@/lib/logger";
import { truncateMiddle } from "@/lib/truncate-middle";

// ── 常量 ──────────────────────────────────────────────────────────────────────

const CAPSULE_H = 48;
const CAPSULE_W = 480;
const ITEM_H = 36;
const DROPDOWN_PADDING = 8;
const MAX_VISIBLE_ITEMS = 6;
const DROPDOWN_MAX_H = MAX_VISIBLE_ITEMS * ITEM_H; // 216
const ANIM_DURATION = 150;
const FALLBACK_TIMER = 300;

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface TaskSimple {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

interface TaskListResponse {
  tasks: TaskSimple[];
  activeTaskId: string | null;
}

interface GrabCompletedPayload {
  requestId: string;
  source: "shortcut-a" | "shortcut-b";
}

type OverlayUiState =
  | { tag: "skeleton" }
  | { tag: "content"; text: string }
  | { tag: "empty" }
  | { tag: "permission-required" };

type DropdownPhase = "closed" | "opening" | "open" | "closing";

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function expandedHeight(taskCount: number): number {
  return CAPSULE_H + Math.min(taskCount, MAX_VISIBLE_ITEMS) * ITEM_H + DROPDOWN_PADDING;
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function TextPreview({ state }: { state: OverlayUiState }) {
  switch (state.tag) {
    case "skeleton":
      return <div className="h-5 w-3/4 rounded bg-muted animate-pulse" />;
    case "content":
      return <span className="text-sm text-foreground">{truncateMiddle(state.text, 240)}</span>;
    case "empty":
      return <span className="text-sm text-muted-foreground">未发现选中文本</span>;
    case "permission-required":
      return null;
  }
}

function PermissionPrompt({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      <span className="text-muted-foreground truncate">
        请在系统设置中授权辅助功能
      </span>
      <button
        type="button"
        className="shrink-0 text-xs text-primary hover:underline"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  );
}

function ToolSlot({ icon, tooltip }: { icon: React.ReactNode; tooltip: string }) {
  return (
    <>
      <div className="w-px h-5 bg-border mx-2 shrink-0" />
      <div
        className="shrink-0 opacity-40 hover:opacity-100 focus:opacity-100 transition-opacity cursor-default"
        title={tooltip}
        tabIndex={0}
        role="button"
      >
        {icon}
      </div>
    </>
  );
}

/** 齿轮占位图标（未来工具） */
function GearIcon() {
  return (
    <svg className="w-4 h-4 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** 方块占位图标（未来工具） */
function BoxIcon() {
  return (
    <svg className="w-4 h-4 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function Overlay() {
  // overlay 窗口透明：通过 CSS class 覆盖全局 html/body { @apply bg-background }
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  const [uiState, setUiState] = useState<OverlayUiState>({ tag: "skeleton" });
  const [tasks, setTasks] = useState<TaskSimple[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [dropdownPhase, setDropdownPhase] = useState<DropdownPhase>("closed");
  const [highlightIndex, setHighlightIndex] = useState(0);

  const prevActiveRef = useRef<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const dropdownOpen = dropdownPhase !== "closed";

  // ── 展开下拉 ──────────────────────────────────────────────────────────

  const openDropdown = useCallback(async () => {
    try {
      const resp = await invoke<TaskListResponse>("list_tasks");
      setTasks(resp.tasks);
      setActiveTaskId(resp.activeTaskId);
      setHighlightIndex(0);

      // 下拉面板 top = 胶囊底部 + 4px 间距；left = 按钮左边缘
      if (buttonContainerRef.current && rootRef.current) {
        const btnRect = buttonContainerRef.current.getBoundingClientRect();
        const rootRect = rootRef.current.getBoundingClientRect();
        setDropdownPos({
          top: CAPSULE_H + 4,
          left: btnRect.left - rootRect.left,
        });
      }

      // 先扩大窗口
      const eh = expandedHeight(resp.tasks.length);
      await getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, eh));
      log("info", "overlay", `窗口已 resize，h=${eh}`);

      // 显示下拉并触发渐入
      setDropdownPhase("opening");
      requestAnimationFrame(() => {
        setDropdownPhase("open");
      });
    } catch (err) {
      log("warn", "overlay", `任务列表加载失败：${err}`);
      toast.error("任务列表加载失败");
    }
  }, []);

  // ── 收起下拉 ──────────────────────────────────────────────────────────

  const closeDropdown = useCallback(() => {
    if (dropdownPhase !== "open" && dropdownPhase !== "opening") return;

    // 清除旧定时器
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    // 开始渐出
    setDropdownPhase("closing");

    // fallback timer：300ms 后强制执行 resize
    closeTimerRef.current = setTimeout(() => {
      getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, CAPSULE_H));
      log("info", "overlay", `窗口已 resize（fallback），h=${CAPSULE_H}`);
      setDropdownPhase("closed");
      closeTimerRef.current = null;
    }, FALLBACK_TIMER);
  }, [dropdownPhase]);

  // ── TransitionEnd 处理器 ──────────────────────────────────────────────

  const handleTransitionEnd = useCallback(() => {
    if (dropdownPhase !== "closing") return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, CAPSULE_H));
    log("info", "overlay", `窗口已 resize，h=${CAPSULE_H}`);
    setDropdownPhase("closed");
  }, [dropdownPhase]);

  // ── 选中任务 ──────────────────────────────────────────────────────────

  const selectTask = useCallback(
    async (taskId: string) => {
      const isDeselect = taskId === activeTaskId;
      prevActiveRef.current = activeTaskId;

      // 乐观更新
      if (isDeselect) {
        setActiveTaskId(null);
      } else {
        setActiveTaskId(taskId);
      }
      closeDropdown();

      try {
        await invoke("set_active_task_id", {
          id: isDeselect ? null : taskId,
        });
        log("info", "overlay", `已切换激活任务，task_id=${isDeselect ? "null" : taskId}`);
      } catch (err) {
        // 回滚本地状态
        setActiveTaskId(prevActiveRef.current);
        log("warn", "overlay", `任务切换失败：${err}`);
        toast.error("任务切换失败");
      }
    },
    [activeTaskId, closeDropdown],
  );

  // ── 重试权限 ──────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setUiState({ tag: "skeleton" });
    invoke("set_overlay_permission_state", { suppressed: false }).catch(() => {});
  }, []);

  // ── Esc 分层关闭 ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dropdownOpen) {
          closeDropdown();
        } else {
          getCurrentWebviewWindow().hide();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropdownOpen, closeDropdown]);

  // ── 上下箭头移动高亮 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!dropdownOpen || tasks.length === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) => {
          const next = prev + 1 >= tasks.length ? 0 : prev + 1;
          // 滚动跟随
          listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => {
          const next = prev - 1 < 0 ? tasks.length - 1 : prev - 1;
          listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (tasks[highlightIndex]) {
          selectTask(tasks[highlightIndex].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropdownOpen, tasks, highlightIndex, selectTask]);

  // ── Click-outside ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !buttonContainerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen, closeDropdown]);

  // ── grab-completed 监听 ───────────────────────────────────────────────

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<GrabCompletedPayload>("grab-completed", async (event) => {
      if (cancelled) return;
      if (event.payload.source !== "shortcut-b") return;

      log("info", "browser", `收到 grab-completed 事件，request_id=${event.payload.requestId}`);

      // 刷新任务列表
      try {
        const resp = await invoke<TaskListResponse>("list_tasks");
        if (cancelled) return;
        setTasks(resp.tasks);
        setActiveTaskId(resp.activeTaskId);
      } catch (err) {
        if (cancelled) return;
        log("warn", "overlay", `任务列表加载失败：${err}`);
        toast.error("任务列表加载失败");
      }

      // 消费抓取结果
      try {
        const result = await invoke<{ text: string; truncated: boolean } | null>(
          "consume_grabbed_result",
          { requestId: event.payload.requestId },
        );
        if (cancelled) return;

        if (result) {
          setUiState({ tag: "content", text: result.text });
          if (result.truncated) {
            toast("文本过长，已按 token 上限截断", { duration: 4000 });
          }
          invoke("set_overlay_permission_state", { suppressed: false }).catch(() => {});
        } else {
          setUiState({ tag: "empty" });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = typeof err === "string" ? err : JSON.stringify(err);

        if (msg.includes("AccessibilityDenied")) {
          setUiState({ tag: "permission-required" });
          invoke("set_overlay_permission_state", { suppressed: true }).catch(() => {});
        } else if (msg.includes("ClipboardTimeout")) {
          setUiState({ tag: "empty" });
          toast.error("目标应用未响应，请重试");
          log("warn", "overlay", "剪贴板降级超时");
        } else if (msg.includes("ClipboardLockFailed")) {
          setUiState({ tag: "empty" });
          toast.error("操作太频繁，请稍后再试");
          log("warn", "overlay", "剪贴板锁冲突");
        } else if (
          msg.includes("NoSelection") ||
          msg.includes("UnsupportedElement")
        ) {
          setUiState({ tag: "empty" });
        } else {
          setUiState({ tag: "empty" });
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ── 派生状态 ──────────────────────────────────────────────────────────

  const activeTaskName =
    activeTaskId != null
      ? (tasks.find((t) => t.id === activeTaskId)?.name ?? activeTaskId)
      : null;

  const dropdownStyle: React.CSSProperties = {
    opacity: dropdownPhase === "open" ? 1 : 0,
    transform: dropdownPhase === "open" ? "translateY(0)" : "translateY(-4px)",
    transition:
      dropdownPhase === "closing"
        ? `opacity ${ANIM_DURATION}ms ease-in, transform ${ANIM_DURATION}ms ease-in`
        : `opacity ${ANIM_DURATION}ms ease-out, transform ${ANIM_DURATION}ms ease-out`,
  };

  // ── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className="w-[480px] bg-transparent relative">
      {/* 主胶囊：固定 48px，背景/圆角/边框只在这个元素上 */}
      <div
        className="flex items-center h-12 px-6 bg-popover border border-border rounded-lg gap-0"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
      >
        {/* 左区：文本预览 */}
        <div className="flex-1 min-w-0">
          {uiState.tag === "permission-required" ? (
            <PermissionPrompt onRetry={handleRetry} />
          ) : (
            <TextPreview state={uiState} />
          )}
        </div>

        {/* 分隔线 */}
        <div className="w-px h-5 bg-border mx-2 shrink-0" />

        {/* 右区：任务切换按钮 */}
        <div ref={buttonContainerRef} className="shrink-0 max-w-[120px]">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm min-w-0 w-full hover:bg-muted rounded-md transition-colors px-1 py-0.5"
            onClick={() => {
              if (dropdownOpen) {
                closeDropdown();
              } else {
                openDropdown();
              }
            }}
          >
            <span className="truncate text-foreground">
              {activeTaskName ?? (
                <span className="text-muted-foreground">选择任务</span>
              )}
            </span>
            <svg
              className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        {/* 未来工具占位 */}
        <ToolSlot icon={<GearIcon />} tooltip="更多工具" />
        <ToolSlot icon={<BoxIcon />} tooltip="扩展功能" />
      </div>

      {/* 下拉面板：独立 DOM 节点，绝对定位相对于 root 容器 */}
      {dropdownOpen && (
        <div
          ref={listRef}
          className="absolute z-50 rounded-lg border border-border overflow-y-auto"
          style={{
            ...dropdownStyle,
            top: dropdownPos.top,
            left: dropdownPos.left,
            minWidth: "120px",
            maxWidth: "240px",
            maxHeight: DROPDOWN_MAX_H,
            background: "hsl(var(--popover))",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          onTransitionEnd={handleTransitionEnd}
        >
          {tasks.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              暂无任务
            </p>
          ) : (
            tasks.map((task, idx) => {
              const isActive = task.id === activeTaskId;
              const isHighlighted = idx === highlightIndex;
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`w-full flex items-center gap-2 py-2 px-3 text-sm text-left transition-colors ${
                    isActive ? "font-medium" : ""
                  } ${
                    isHighlighted
                      ? "bg-muted outline-none ring-2 ring-inset ring-primary/30"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => selectTask(task.id)}
                >
                  <span className="w-4 shrink-0 text-xs text-muted-foreground">
                    {isActive ? "✓" : ""}
                  </span>
                  <span className="truncate">{task.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
