import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";

// ── 状态机 ──────────────────────────────────────────────────────────────────

type OverlayUiState =
  | { tag: "skeleton" }
  | { tag: "content"; text: string }
  | { tag: "empty" }
  | { tag: "permission-required" };

interface GrabCompletedPayload {
  requestId: string;
  source: "shortcut-a" | "shortcut-b";
}

// ── 组件 ────────────────────────────────────────────────────────────────────

export default function Overlay() {
  const [state, setState] = useState<OverlayUiState>({ tag: "skeleton" });

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWebviewWindow().hide();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 监听 grab-completed → 定向消费
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<GrabCompletedPayload>("grab-completed", async (event) => {
      if (cancelled) return;
      if (event.payload.source !== "shortcut-b") return;

      try {
        const result = await invoke<{ text: string; truncated: boolean } | null>(
          "consume_grabbed_result",
          { requestId: event.payload.requestId },
        );
        if (cancelled) return;
        if (result) {
          setState({ tag: "content", text: result.text });
          if (result.truncated) {
            toast("文本过长，已按 token 上限截断", { duration: 4000 });
          }
          invoke("set_overlay_permission_state", { suppressed: false }).catch(
            () => {},
          );
        } else {
          setState({ tag: "empty" });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = typeof err === "string" ? err : JSON.stringify(err);

        if (msg.includes("AccessibilityDenied")) {
          setState({ tag: "permission-required" });
          invoke("set_overlay_permission_state", { suppressed: true }).catch(
            () => {},
          );
        } else if (
          msg.includes("NoSelection") ||
          msg.includes("UnsupportedElement")
        ) {
          setState({ tag: "empty" });
        } else {
          setState({ tag: "empty" });
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

  // 权限引导：授权后重试
  const handleRetry = useCallback(async () => {
    setState({ tag: "skeleton" });
    // 关闭权限抑制，重新触发抓取通过再次按快捷键
    invoke("set_overlay_permission_state", { suppressed: false }).catch(
      () => {},
    );
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 命令输入框（Phase 5 启用） */}
      <div className="shrink-0 px-4 pt-4">
        <input
          type="text"
          disabled
          placeholder="命令输入（Phase 5 启用）"
          className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
        />
      </div>

      <div className="mx-4 my-3 border-t border-border" />

      {/* 预览区 */}
      <div className="flex-1 min-h-0 px-4 pb-4 overflow-auto">
        {state.tag === "skeleton" && <SkeletonPreview />}
        {state.tag === "content" && <ContentPreview text={state.text} />}
        {state.tag === "empty" && <EmptyHint />}
        {state.tag === "permission-required" && (
          <PermissionGuide onRetry={handleRetry} />
        )}
      </div>
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────────────────────────

function SkeletonPreview() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-4 w-5/6 rounded bg-muted" />
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
    </div>
  );
}

function ContentPreview({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {text}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      未发现选中文本
    </div>
  );
}

function PermissionGuide({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-sm">
      <p className="text-center text-muted-foreground">
        请在系统设置 → 隐私与安全性 → 辅助功能中授权 OrbitX
      </p>
      <button
        type="button"
        className="rounded-md bg-brand-dark px-4 py-2 text-white hover:bg-brand-dark/90"
        onClick={onRetry}
      >
        我已授权，重试
      </button>
      <p className="text-xs text-muted-foreground">
        授权后请再次按 CmdOrCtrl+Shift+Space 唤出面板
      </p>
    </div>
  );
}
