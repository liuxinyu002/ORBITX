import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Component, useEffect, useRef, useState } from "react";
import Lottie from "lottie-react";
import { log } from "@/lib/logger";
import tapAnimation from "@/assets/tap tap.json";

// ── Lottie 错误边界 ──────────────────────────────────────────────────────────────

class LottieErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    log("warn", "toast", `Lottie 动画加载失败: ${String(error)}，降级到 CSS spinner`);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface FieldPreview {
  key: string;
  value: string;
}

interface ToastRenderPayload {
  state: "loading" | "success" | "error";
  message: string;
  taskName?: string;
  recordCount: number;
  previewFields: FieldPreview[];
  /** 自动消失时间（毫秒），前端据此计算 fade-out 动画起点 */
  durationMs: number;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const FADE_DURATION_MS = 200;

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function ToastOverlay() {
  // toast 窗口透明
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  const [payload, setPayload] = useState<ToastRenderPayload | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<ToastRenderPayload>("toast:render", (event) => {
      if (cancelled) return;

      log("info", "toast", `收到 toast:render 事件，state=${event.payload.state}`);

      // 清除旧的 fade-out 定时器（状态切换时重置）
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }

      setFadingOut(false);
      setPayload(event.payload);

      // loading 态不启动 fade-out 定时器
      if (event.payload.state === "loading") return;

      // success / error 态：根据 durationMs 计算 fade-out 起点
      const durationMs = event.payload.durationMs || 2500;
      const fadeStartMs = Math.max(0, durationMs - FADE_DURATION_MS);
      fadeTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setFadingOut(true);
        fadeTimerRef.current = null;
      }, fadeStartMs);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      unlisten?.();
    };
  }, []);

  if (!payload) return null;

  const hasFields = payload.previewFields && payload.previewFields.length > 0;

  return (
    <>
      <style>{".lottie-icon svg [stroke]{stroke:currentColor}"}</style>
      <div
      className={`w-[480px] bg-transparent ${
        fadingOut ? "animate-out fade-out duration-200" : ""
      }`}
    >
      <div
        className="flex flex-col justify-center px-6 py-2 bg-popover border border-border rounded-lg gap-0.5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
      >
        {payload.state === "loading" && (
          <div className="flex items-center gap-1.5 text-sm">
            <LottieErrorBoundary
              fallback={<span className="shrink-0 animate-spin">⟳</span>}
            >
              <div className="lottie-icon text-foreground">
                <Lottie
                  animationData={tapAnimation}
                  loop={true}
                  style={{ width: 24, height: 24 }}
                />
              </div>
            </LottieErrorBoundary>
            <span className="text-foreground">{payload.message}</span>
          </div>
        )}

        {payload.state === "success" && (
          <>
            {/* 首行：✓ + message + record count */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-green-600 dark:text-green-400 shrink-0">
                ✓
              </span>
              <span className="text-foreground">{payload.message}</span>
              {payload.recordCount > 0 && (
                <span className="text-muted-foreground">
                  · {payload.recordCount} 条
                </span>
              )}
            </div>

            {/* 次行：字段预览（最多 3 个） */}
            {hasFields && (
              <div className="text-xs text-muted-foreground">
                {payload.previewFields.slice(0, 3).map((field, i) => (
                  <span key={field.key}>
                    {i > 0 && <span className="mx-1">|</span>}
                    {field.key}: {field.value}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {payload.state === "error" && (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-red-600 dark:text-red-400 shrink-0">
              ✗
            </span>
            <span className="text-foreground">{payload.message}</span>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
