/**
 * Phase 5: 提取管线监听器（无头组件）。
 *
 * 挂载在主窗口 <AgentProvider> 内部，监听两条事件通道：
 * - `task:silent-extract`（快捷键 A）：静默后台提取
 * - `task:manual-extract`（快捷键 B / 降级面板）：手动确认提取
 *
 * 渲染 null，不产生 DOM。
 */

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAgent } from "@/agent";
import { runExtraction } from "@/agent/pipeline";
import { log } from "@/lib/logger";
import type { TaskListResponse } from "@/lib/task-types";

/** `task:silent-extract` payload（Rust 侧发射） */
interface SilentExtractPayload {
  text: string;
  truncated: boolean;
}

/** `task:manual-extract` payload（悬浮窗发射） */
interface ManualExtractPayload {
  text: string;
  taskId: string;
  force?: boolean;
  truncated?: boolean;
}

export default function ExtractionListener() {
  const { activeModel } = useAgent();

  useEffect(() => {
    let unlistenSilent: UnlistenFn | undefined;
    let unlistenManual: UnlistenFn | undefined;
    let cancelled = false;

    // ── 监听 task:silent-extract（快捷键 A）──────────────────────────
    listen<SilentExtractPayload>("task:silent-extract", async (event) => {
      if (cancelled) return;

      log("info", "pipeline", "收到 task:silent-extract 事件");

      if (!activeModel) {
        log("warn", "pipeline", "无激活模型，跳过静默提取");
        return;
      }

      // 获取当前激活任务 ID
      let activeTaskId: string | null = null;
      try {
        const resp = await invoke<TaskListResponse>("list_tasks");
        activeTaskId = resp.activeTaskId;
      } catch {
        log("error", "pipeline", "获取激活任务失败");
        return;
      }

      // 立即显示 loading toast（提供按键即时反馈）
      try {
        await invoke("show_toast_command", {
          payload: {
            state: "loading",
            message: "正在提取…",
          },
        });
      } catch {
        log("warn", "pipeline", "Loading toast 显示失败，降级到 sonner");
        toast("正在提取…");
      }

      await runExtraction(
        event.payload.text,
        "silent",
        activeModel,
        activeTaskId ?? undefined,
        false,
        event.payload.truncated,
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenSilent = fn;
      }
    });

    // ── 监听 task:manual-extract（悬浮窗 / 降级面板）─────────────────
    listen<ManualExtractPayload>("task:manual-extract", async (event) => {
      if (cancelled) return;

      log(
        "info",
        "pipeline",
        `收到 task:manual-extract 事件，taskId=${event.payload.taskId}，force=${event.payload.force ?? false}`,
      );

      if (!activeModel) {
        log("warn", "pipeline", "无激活模型，跳过手动提取");
        return;
      }

      await runExtraction(
        event.payload.text,
        "manual",
        activeModel,
        event.payload.taskId,
        event.payload.force,
        event.payload.truncated,
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenManual = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenSilent?.();
      unlistenManual?.();
    };
  }, [activeModel]);

  return null;
}
