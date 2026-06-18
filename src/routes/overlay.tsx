import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "@/lib/logger";
import { truncateMiddle } from "@/lib/truncate-middle";

// ── 常量 ──────────────────────────────────────────────────────────────────────

const CAPSULE_H = 48;
const FALLBACK_CAPSULE_H = 140;
const CAPSULE_W = 480;
const ITEM_H = 36;
const DROPDOWN_PADDING = 8;
const MAX_VISIBLE_ITEMS = 6;
const DROPDOWN_MAX_H = MAX_VISIBLE_ITEMS * ITEM_H; // 216
const ANIM_DURATION = 150;
const FALLBACK_TIMER = 300;
const FADE_OUT_MS = 200;

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

interface FallbackInfo {
  reason: string;
  failedTaskId: string;
}

interface ViewRenderOverlayPayload {
  text: string;
  truncated: boolean;
  fallback?: FallbackInfo;
  tag?: string;
}

type OverlayUiState =
  | { tag: "skeleton" }
  | { tag: "content" }
  | { tag: "empty" }
  | { tag: "permission-required" };

type DropdownPhase = "closed" | "opening" | "open" | "closing";

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function expandedHeight(taskCount: number, baseHeight: number): number {
  return baseHeight + Math.min(taskCount, MAX_VISIBLE_ITEMS) * ITEM_H + DROPDOWN_PADDING;
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function TextPreview({ text }: { text: string }) {
  return <span className="text-sm text-foreground">{truncateMiddle(text, 240)}</span>;
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

/** 降级模式：折叠的原文预览 + 展开/收起按钮 */
function FallbackTextPreview({
  text,
  truncated,
  expanded,
  onToggle,
}: {
  text: string;
  truncated: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="text-sm text-foreground">
      <p className={expanded ? "" : "line-clamp-3"}>
        {text}
        {truncated && !expanded && (
          <span className="text-muted-foreground">
            ... (内容受字符阈值限制已在抓取时截断)
          </span>
        )}
      </p>
      {truncated && expanded && (
        <p className="text-muted-foreground text-xs mt-1">
          内容受字符阈值限制已在抓取时截断
        </p>
      )}
      <button
        type="button"
        className="text-xs text-primary hover:underline mt-1"
        onClick={onToggle}
      >
        {expanded ? "▾ 收起原文" : "▸ 展开原文"}
      </button>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function Overlay() {
  // overlay 窗口透明
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  const [uiState, setUiState] = useState<OverlayUiState>({ tag: "skeleton" });
  const [currentText, setCurrentText] = useState("");
  const [currentTruncated, setCurrentTruncated] = useState(false);
  const [fallbackInfo, setFallbackInfo] = useState<FallbackInfo | null>(null);
  const [textExpanded, setTextExpanded] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskSimple[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [dropdownPhase, setDropdownPhase] = useState<DropdownPhase>("closed");
  const [highlightIndex, setHighlightIndex] = useState(0);

  const prevActiveRef = useRef<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const dropdownOpen = dropdownPhase !== "closed";
  const isFallback = fallbackInfo !== null;
  const baseHeight = isFallback ? FALLBACK_CAPSULE_H : CAPSULE_H;

  // ── 展开下拉 ──────────────────────────────────────────────────────────

  const openDropdown = useCallback(async () => {
    try {
      const resp = await invoke<TaskListResponse>("list_tasks");
      setTasks(resp.tasks);
      setActiveTaskId(resp.activeTaskId);

      // 降级模式下，如果 localTaskId 已经设置，保持高亮在它上面
      if (isFallback && localTaskId) {
        const idx = resp.tasks.findIndex((t) => t.id === localTaskId);
        setHighlightIndex(idx >= 0 ? idx : 0);
      } else {
        setHighlightIndex(0);
      }

      if (buttonContainerRef.current && rootRef.current) {
        const btnRect = buttonContainerRef.current.getBoundingClientRect();
        const rootRect = rootRef.current.getBoundingClientRect();
        setDropdownPos({
          top: baseHeight + 4,
          left: btnRect.left - rootRect.left,
        });
      }

      const eh = expandedHeight(resp.tasks.length, baseHeight);
      await getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, eh));
      log("info", "overlay", `窗口已 resize，h=${eh}`);

      setDropdownPhase("opening");
      requestAnimationFrame(() => {
        setDropdownPhase("open");
      });
    } catch (err) {
      log("warn", "overlay", `任务列表加载失败：${err}`);
      toast.error("任务列表加载失败");
    }
  }, [baseHeight, isFallback, localTaskId]);

  // ── 收起下拉 ──────────────────────────────────────────────────────────

  const closeDropdown = useCallback(() => {
    if (dropdownPhase !== "open" && dropdownPhase !== "opening") return;

    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setDropdownPhase("closing");

    closeTimerRef.current = setTimeout(() => {
      getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, baseHeight));
      log("info", "overlay", `窗口已 resize（fallback），h=${baseHeight}`);
      setDropdownPhase("closed");
      closeTimerRef.current = null;
    }, FALLBACK_TIMER);
  }, [dropdownPhase, baseHeight]);

  // ── TransitionEnd 处理器 ──────────────────────────────────────────────

  const handleTransitionEnd = useCallback(() => {
    if (dropdownPhase !== "closing") return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    getCurrentWebviewWindow().setSize(new LogicalSize(CAPSULE_W, baseHeight));
    log("info", "overlay", `窗口已 resize，h=${baseHeight}`);
    setDropdownPhase("closed");
  }, [dropdownPhase, baseHeight]);

  // ── 选中任务 ──────────────────────────────────────────────────────────

  const selectTask = useCallback(
    async (taskId: string) => {
      if (isFallback) {
        // 降级模式：本地选择，不写 DB
        setLocalTaskId(taskId);
        closeDropdown();
        return;
      }

      // 正常模式：写入 DB
      const isDeselect = taskId === activeTaskId;
      prevActiveRef.current = activeTaskId;

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
        setActiveTaskId(prevActiveRef.current);
        log("warn", "overlay", `任务切换失败：${err}`);
        toast.error("任务切换失败");
      }
    },
    [activeTaskId, closeDropdown, isFallback],
  );

  // ── 重试权限 ──────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    getCurrentWebviewWindow().hide();
  }, []);

  // ── 通用 fade-out + hide + 清空状态 ────────────────────────────────────

  const fadeOutAndHide = useCallback(() => {
    setFadingOut(true);
    fadeTimerRef.current = setTimeout(() => {
      getCurrentWebviewWindow().hide();
      // 清空状态
      setUiState({ tag: "skeleton" });
      setCurrentText("");
      setCurrentTruncated(false);
      setFallbackInfo(null);
      setTextExpanded(false);
      setFadingOut(false);
      setLocalTaskId(null);
      setDropdownPhase("closed");
      fadeTimerRef.current = null;
    }, FADE_OUT_MS);
  }, []);

  // ── 正常模式派发 ──────────────────────────────────────────────────────

  const handleDispatch = useCallback(() => {
    if (uiState.tag !== "content" || isFallback || !activeTaskId) return;
    emit("task:manual-extract", {
      text: currentText,
      taskId: activeTaskId,
      force: false,
      truncated: currentTruncated,
    });
    log("info", "overlay", `正常派发，taskId=${activeTaskId}`);
    fadeOutAndHide();
  }, [uiState.tag, isFallback, activeTaskId, currentText, currentTruncated, fadeOutAndHide]);

  // ── 降级模式：强制入库 ────────────────────────────────────────────────

  const handleForceInsert = useCallback(() => {
    const taskId = localTaskId ?? fallbackInfo?.failedTaskId;
    if (!taskId) return;
    emit("task:manual-extract", {
      text: currentText,
      taskId,
      force: true,
      truncated: currentTruncated,
    });
    log("info", "overlay", `强制入库，taskId=${taskId}`);
    fadeOutAndHide();
  }, [localTaskId, fallbackInfo, currentText, currentTruncated, fadeOutAndHide]);

  // ── 降级模式：重新选任务后确认 ────────────────────────────────────────

  const handleReselectConfirm = useCallback(() => {
    if (!localTaskId) return;
    emit("task:manual-extract", {
      text: currentText,
      taskId: localTaskId,
      force: false,
      truncated: currentTruncated,
    });
    log("info", "overlay", `重新选择确认，taskId=${localTaskId}`);
    fadeOutAndHide();
  }, [localTaskId, currentText, currentTruncated, fadeOutAndHide]);

  // ── 降级模式：丢弃 ────────────────────────────────────────────────────

  const handleDiscard = useCallback(() => {
    log("info", "overlay", "降级模式丢弃");
    fadeOutAndHide();
  }, [fadeOutAndHide]);

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

  // ── view:render-overlay 监听 ───────────────────────────────────────────

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<ViewRenderOverlayPayload>("view:render-overlay", async (event) => {
      if (cancelled) return;

      log("info", "overlay", "收到 view:render-overlay 事件");

      const payload = event.payload;

      // 权限引导态
      if (payload.tag === "permission-required") {
        setUiState({ tag: "permission-required" });
        setFallbackInfo(null);
        setCurrentText("");
        setCurrentTruncated(false);
        return;
      }

      // 无选中文本
      if (payload.tag === "empty") {
        setUiState({ tag: "empty" });
        setFallbackInfo(null);
        setCurrentText("");
        setCurrentTruncated(false);
        return;
      }

      // 抓取超时 → Toast + 回退到 empty 态
      if (payload.tag === "timeout") {
        setUiState({ tag: "empty" });
        setFallbackInfo(null);
        setCurrentText("");
        setCurrentTruncated(false);
        toast("抓取超时，请重试");
        return;
      }

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

      // 读取 payload
      setCurrentText(payload.text);
      setCurrentTruncated(payload.truncated);

      if (payload.fallback) {
        // ── 降级模式 ────────────────────────────────────────────────
        setFallbackInfo(payload.fallback);
        setLocalTaskId(payload.fallback.failedTaskId);
        setTextExpanded(false);
        setUiState({ tag: "content" });

        // 调整窗口高度以容纳降级内容
        await getCurrentWebviewWindow().setSize(
          new LogicalSize(CAPSULE_W, FALLBACK_CAPSULE_H),
        );
        log("info", "overlay", `降级模式，reason=${payload.fallback.reason}`);
      } else {
        // ── 正常模式 ─────────────────────────────────────────────────
        setFallbackInfo(null);
        setLocalTaskId(null);
        setTextExpanded(false);
        setUiState({ tag: "content" });

        if (payload.truncated) {
          toast("文本过长，已按 token 上限截断", { duration: 4000 });
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
      // 清理 fade-out 定时器
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  // ── 派生状态 ──────────────────────────────────────────────────────────

  const displayTaskId = isFallback ? localTaskId : activeTaskId;
  const displayTaskName =
    displayTaskId != null
      ? (tasks.find((t) => t.id === displayTaskId)?.name ?? displayTaskId)
      : null;

  const isFailedTask =
    isFallback &&
    localTaskId != null &&
    fallbackInfo != null &&
    localTaskId === fallbackInfo.failedTaskId;

  const showReselectConfirm =
    isFallback &&
    localTaskId != null &&
    fallbackInfo != null &&
    localTaskId !== fallbackInfo.failedTaskId;

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
    <div
      ref={rootRef}
      className={`w-[480px] bg-transparent relative ${
        fadingOut ? "animate-out fade-out duration-200" : ""
      }`}
    >
      {/* 正常模式胶囊 */}
      {!isFallback && (
        <div
          className="flex items-center h-12 px-6 bg-popover border border-border rounded-lg gap-0"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
        >
          {/* 左区：文本预览 */}
          <div className="flex-1 min-w-0">
            {uiState.tag === "permission-required" ? (
              <PermissionPrompt onRetry={handleRetry} />
            ) : uiState.tag === "skeleton" ? (
              <div className="h-5 w-3/4 rounded bg-muted animate-pulse" />
            ) : uiState.tag === "content" ? (
              <TextPreview text={currentText} />
            ) : (
              <span className="text-sm text-muted-foreground">未发现选中文本</span>
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
                {displayTaskName ?? (
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

          {/* 派发按钮 */}
          {uiState.tag === "content" && (
            <>
              <div className="w-px h-5 bg-border mx-2 shrink-0" />
              <button
                type="button"
                className={`shrink-0 text-xs px-3 py-1.5 rounded-md transition-all ${
                  activeTaskId
                    ? "bg-primary text-primary-foreground hover:bg-primary/80 focus:ring-3 focus:ring-ring/50 active:translate-y-px"
                    : "opacity-50 cursor-not-allowed bg-primary text-primary-foreground"
                }`}
                disabled={!activeTaskId}
                onClick={handleDispatch}
              >
                派发
              </button>
            </>
          )}
        </div>
      )}

      {/* 降级模式胶囊 */}
      {isFallback && fallbackInfo && (
        <div
          className="flex flex-col px-6 py-3 bg-popover border border-border rounded-lg gap-2"
          style={{ minHeight: FALLBACK_CAPSULE_H, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
        >
          {/* 警告原因 */}
          <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <span>⚠</span>
            <span>{fallbackInfo.reason}</span>
          </div>

          {/* 折叠原文 */}
          <FallbackTextPreview
            text={currentText}
            truncated={currentTruncated}
            expanded={textExpanded}
            onToggle={() => setTextExpanded((prev) => !prev)}
          />

          {/* 操作栏：任务下拉 + 按钮 */}
          <div className="flex items-center gap-2 mt-1">
            {/* 任务下拉 */}
            <div ref={buttonContainerRef} className="shrink-0 max-w-[140px]">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm min-w-0 w-full hover:bg-muted rounded-md transition-colors px-2 py-1 border border-border"
                onClick={() => {
                  if (dropdownOpen) {
                    closeDropdown();
                  } else {
                    openDropdown();
                  }
                }}
              >
                <span className="truncate text-foreground">
                  {isFailedTask && <span className="mr-1">⚠</span>}
                  {displayTaskName ?? (
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

            <div className="flex-1" />

            {/* 确认（重新选任务后可见） */}
            {showReselectConfirm && (
              <button
                type="button"
                className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/80 focus:ring-3 focus:ring-ring/50 active:translate-y-px transition-all"
                onClick={handleReselectConfirm}
              >
                重新派发
              </button>
            )}

            {/* 强制入库 */}
            <button
              type="button"
              className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-destructive text-destructive hover:bg-destructive/20 focus:ring-3 focus:ring-destructive/20 active:translate-y-px transition-all"
              onClick={handleForceInsert}
            >
              强制入库
            </button>

            {/* 丢弃 */}
            <button
              type="button"
              className="shrink-0 text-xs px-3 py-1.5 rounded-md hover:bg-muted focus:ring-3 focus:ring-ring/50 active:translate-y-px transition-all"
              onClick={handleDiscard}
            >
              丢弃
            </button>
          </div>
        </div>
      )}

      {/* 下拉面板 */}
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
              const isActive = task.id === displayTaskId;
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
                    {isFailedTask && isActive ? "⚠" : isActive ? "✓" : ""}
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
