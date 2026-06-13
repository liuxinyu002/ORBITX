import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import { useEffect } from "react";
import { log } from "@/lib/logger";

interface GrabCompletedPayload {
  requestId: string;
  source: "shortcut-a" | "shortcut-b";
}

/**
 * 监听 `grab-completed` 事件，定向消费快捷键 A（静默提取）的抓取结果，
 * 并通过 Toast 反馈给用户。
 *
 * 用闭包局部 `cancelled` 标记替代 `useRef`，解决 Strict Mode 双重挂载
 * 下 `listen()` 返回异步 Promise 导致的竞态（两个 callback 同时存活）。
 */
export function useGrabCompleted() {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<GrabCompletedPayload>("grab-completed", async (event) => {
      if (cancelled) return;
      if (event.payload.source !== "shortcut-a") return;

      // 主窗口不可见时静默跳过：结果不消费，留在队列中自然过期
      const visible = await getCurrentWebviewWindow().isVisible();
      if (!visible) return;

      try {
        const result = await invoke<{ text: string; truncated: boolean } | null>(
          "consume_grabbed_result",
          { requestId: event.payload.requestId },
        );

        if (cancelled) return;

        if (result) {
          toast.success("已提取");
          if (result.truncated) {
            toast("文本过长，已按 token 上限截断", { duration: 4000 });
          }
        } else {
          toast("未发现选中文本");
        }
      } catch (err) {
        if (cancelled) return;

        const msg = typeof err === "string" ? err : JSON.stringify(err);

        if (msg.includes("AccessibilityDenied")) {
          toast.error(
            "请在系统设置→隐私与安全性→辅助功能中授权 OrbitX",
            { duration: 6000 },
          );
        } else if (msg.includes("ClipboardTimeout")) {
          toast.error("目标应用未响应，请重试");
          log("warn", "overlay", "剪贴板降级超时");
        } else if (msg.includes("ClipboardLockFailed")) {
          toast.error("操作太频繁，请稍后再试");
          log("warn", "overlay", "剪贴板锁冲突");
        } else if (
          msg.includes("NoSelection") ||
          msg.includes("UnsupportedElement")
        ) {
          toast("未发现选中文本");
        } else {
          toast.error("提取失败，请重试");
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn(); // 前一个 effect 已 cleanup，立即取消注册
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
