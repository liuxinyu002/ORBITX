/**
 * Phase 5: 提取管线。
 *
 * Prompt 组装 → AI 调用 → 相关性判定 → 路由分发。
 * 纯函数，不依赖 React hooks/context。所有依赖通过参数注入。
 */

import { complete } from "@earendil-works/pi-ai";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { log } from "@/lib/logger";
import { resolveModel } from "./providers/registry";
import { parseAIResponse } from "./extractor";
import { buildNormalPrompt, buildForcePrompt } from "./prompt/extraction";
import { cleanExtractedData } from "./cleaner";
import type { ModelConfig } from "./types";
import type { Task, TaskSchema } from "@/lib/task-types";

// ── 环境变量 ──────────────────────────────────────────────────────────────

/** 从 Vite 环境变量获取提取超时时间（毫秒），默认 30_000。 */
function getExtractionTimeoutMs(): number {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string> })
    .env;
  const raw = viteEnv?.VITE_EXTRACTION_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30_000;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

/** 从 AssistantMessage content 中提取纯文本。 */
function extractText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && p.text != null,
    )
    .map((p) => p.text)
    .join("");
}

// ── 路由逻辑（任务 3.4）───────────────────────────────────────────────────

/**
 * 根据解析结果和 mode 进行路由分发。
 */
async function routeResult(
  parsed: Record<string, unknown>,
  taskId: string,
  rawText: string,
  truncated: boolean,
): Promise<void> {
  const isRelevant = parsed.is_relevant;
  const data = parsed.data;
  const reason = typeof parsed.reason === "string" ? parsed.reason : null;

  if (isRelevant === true && data != null) {
    // 后处理：清洗脏数据
    const cleaned = cleanExtractedData(data as Record<string, unknown>);
    if (!cleaned) {
      log("warn", "pipeline", "清洗后数据全为 null，视为不相关");
      await invoke("show_overlay", {
        payload: {
          text: rawText,
          truncated,
          fallback: {
            reason: "AI 返回数据经清洗后全为空值",
            failedTaskId: taskId,
          },
        },
      });
      return;
    }

    // 相关 → 写入数据库
    const resultJson = JSON.stringify(cleaned);
    log("info", "pipeline", `相关性判定通过，开始入库，resultJson=${resultJson}`);
    try {
      const recordId = await invoke<string>("insert_extraction", {
        input: {
          taskId,
          rawText,
          resultJson,
        },
      });
      log("info", "pipeline", `入库成功，record_id=${recordId}，task_id=${taskId}`);
      toast.success("已提取");
      if (truncated) {
        toast("文本过长，已按 token 上限截断", { duration: 4000 });
      }
    } catch (err) {
      log(
        "error",
        "pipeline",
        `入库失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      toast.error("入库失败，请重试");
    }
  } else {
    // 不相关 → 降级唤起悬浮窗
    const fallbackReason =
      reason ?? "AI 判定不相关，未能提取到有效信息";
    log("info", "pipeline", `降级打断，reason=${fallbackReason}`);
    try {
      await invoke("show_overlay", {
        payload: {
          text: rawText,
          truncated,
          tag: "content",
          fallback: {
            reason: fallbackReason,
            failedTaskId: taskId,
          },
        },
      });
    } catch (err) {
      log(
        "error",
        "pipeline",
        `唤起悬浮窗失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      toast.error("唤起悬浮窗失败");
    }
  }
}

// ── 公共 API（任务 3.1）───────────────────────────────────────────────────

/**
 * 核心提取管线函数。
 *
 * @param text 抓取的原始文本
 * @param mode 派发模式：silent（静默，快捷键 A）或 manual（手动，快捷键 B / 降级面板确认）
 * @param currentModel 当前激活的 AI 模型配置
 * @param taskId 目标任务 ID（silent 模式从激活任务获取，manual 模式从 overlay 传入）
 * @param force 是否强制提取（跳过相关性判定，直接入库）
 * @param truncated 文本是否经 token 截断
 */
export async function runExtraction(
  text: string,
  mode: "silent" | "manual",
  currentModel: ModelConfig,
  taskId?: string,
  force?: boolean,
  truncated?: boolean,
): Promise<void> {
  // ── 3.5 无激活任务检测 ─────────────────────────────────────────────
  if (mode === "silent" && !taskId) {
    toast("静默失败：无激活任务");
    return;
  }

  // ── 获取任务 ──────────────────────────────────────────────────────
  let task: Task;
  try {
    task = await invoke<Task>("get_task", { id: taskId! });
  } catch (err) {
    log(
      "error",
      "pipeline",
      `获取任务失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    toast.error("获取任务信息失败");
    return;
  }

  // ── 3.8 + 3.9 开始日志 + 计时起点 ─────────────────────────────────
  const startTime = Date.now();
  log(
    "info",
    "pipeline",
    `开始提取，任务=${task.name}，模式=${mode}，force=${force ?? false}，truncated=${truncated ?? false}`,
  );

  let schema: TaskSchema;
  try {
    schema = JSON.parse(task.schema ?? "{}");
  } catch {
    log("error", "pipeline", "任务 Schema JSON 解析失败");
    toast.error("任务 Schema 格式错误");
    return;
  }

  // ── 3.2 Prompt 组装 ────────────────────────────────────────────────
  const systemPrompt = force
    ? buildForcePrompt(schema)
    : buildNormalPrompt(schema);
  log(
    "debug",
    "pipeline",
    `Prompt 组装完成，字段数=${schema.fields?.length ?? 0}，force=${force ?? false}`,
  );

  // ── 3.3 + 3.6 模型调用 ─────────────────────────────────────────────
  const model = resolveModel(currentModel);
  const timeoutMs = getExtractionTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    log("info", "pipeline", "调用模型开始提取");
    const result = await complete(
      model,
      {
        systemPrompt,
        messages: [
          { role: "user", content: text, timestamp: Date.now() },
        ],
      },
      {
        apiKey: currentModel.apiKey,
        maxTokens: 4096,
        timeoutMs,
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    // ── 模型错误 ─────────────────────────────────────────────────
    if (result.stopReason === "error") {
      const errMsg = result.errorMessage ?? "未知错误";
      log("error", "pipeline", `模型调用失败: ${errMsg}`);
      toast.error(`AI 提取失败: ${errMsg.slice(0, 100)}`);
      return;
    }

    // ── 提取响应文本 ─────────────────────────────────────────────
    const responseText = extractText(result.content);
    if (!responseText) {
      log("warn", "pipeline", "模型返回内容为空");
      if (force) {
        toast.error("AI 未返回提取结果");
      } else {
        await invoke("show_overlay", {
          payload: {
            text,
            truncated: truncated ?? false,
            fallback: {
              reason: "模型返回内容为空",
              failedTaskId: task.id,
            },
          },
        });
      }
      return;
    }

    // ── 解析 JSON ─────────────────────────────────────────────────
    const parsed = parseAIResponse(responseText);
    if (!parsed) {
      log("warn", "pipeline", "JSON 解析失败");
      if (force) {
        toast.error("AI 返回格式异常，无法提取");
      } else {
        await invoke("show_overlay", {
          payload: {
            text,
            truncated: truncated ?? false,
            fallback: {
              reason: "AI 返回格式异常，无法解析",
              failedTaskId: task.id,
            },
          },
        });
      }
      return;
    }

    // ── 3.4 路由分发 ──────────────────────────────────────────────
    if (force) {
      // force 模式：parsed 即 data 对象，后处理清洗后直接入库
      const forceCleaned = cleanExtractedData(parsed);
      if (!forceCleaned) {
        log("warn", "pipeline", "强制模式：清洗后数据全为 null");
        toast.error("提取结果为空，请确认文本内容");
        return;
      }
      const forceResultJson = JSON.stringify(forceCleaned);
      log("info", "pipeline", `强制提取模式，跳过相关性判定，直接入库，resultJson=${forceResultJson}`);
      try {
        const recordId = await invoke<string>("insert_extraction", {
          input: {
            taskId: task.id,
            rawText: text,
            resultJson: forceResultJson,
          },
        });
        log("info", "pipeline", `强制入库成功，record_id=${recordId}`);
        toast.success("已强制提取");
        if (truncated) {
          toast("文本过长，已按 token 上限截断", { duration: 4000 });
        }
      } catch (err) {
        log(
          "error",
          "pipeline",
          `强制入库失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        toast.error("入库失败，请重试");
      }
    } else {
      await routeResult(parsed, task.id, text, truncated ?? false);
    }

    // ── 3.9 性能耗时日志 ───────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    log("info", "pipeline", `提取完成，耗时=${elapsed}ms`);
  } catch (err) {
    clearTimeout(timeout);

    // ── 3.6 模型调用失败处理 ────────────────────────────────────────
    const errMsg =
      err instanceof DOMException && err.name === "AbortError"
        ? `调用超时（${timeoutMs / 1000}s）`
        : err instanceof Error
          ? err.message
          : String(err);
    log("error", "pipeline", `模型调用失败: ${errMsg}`);
    toast.error(`AI 提取失败，请重试`);
  }
}
