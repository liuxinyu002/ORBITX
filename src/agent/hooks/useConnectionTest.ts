import { complete } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { useCallback, useState } from "react";
import { log } from "../../lib/logger";
import { resolveModel } from "../providers/registry";
import type { ModelConfig } from "../types";

export interface TestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * 连接测试 hook：通过 pi-ai complete() 发送 ping 请求验证模型可用性。
 */
export function useConnectionTest() {
  const [isTesting, setIsTesting] = useState(false);
  const [lastResult, setLastResult] = useState<TestResult | null>(null);

  const test = useCallback(async (config: ModelConfig): Promise<TestResult> => {
    setIsTesting(true);
    setLastResult(null);

    try {
      const model = resolveModel(config);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const start = Date.now();
      let result: AssistantMessage;
      try {
        result = await complete(
          model,
          {
            messages: [
              { role: "user", content: "ping", timestamp: Date.now() },
            ],
          },
          {
            apiKey: config.apiKey,
            maxTokens: 1,
            timeoutMs: 15000,
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      const latencyMs = Date.now() - start;

      if (result.stopReason === "error") {
        const raw = JSON.stringify({
          provider: config.provider,
          modelId: config.modelId,
          stopReason: result.stopReason,
          errorMessage: result.errorMessage,
        });
        log("info", "connection-test", `连接测试失败: ${raw}`);

        const testResult = classifyError(result.errorMessage ?? "");
        setLastResult(testResult);
        return testResult;
      }

      const testResult: TestResult = { success: true, latencyMs };
      setLastResult(testResult);
      return testResult;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(
        "info",
        "connection-test",
        `连接测试异常: ${JSON.stringify({ provider: config.provider, modelId: config.modelId, error: errMsg })}`,
      );

      if (err instanceof DOMException && err.name === "AbortError") {
        const testResult: TestResult = {
          success: false,
          error: "连接超时（超过 15 秒）",
        };
        setLastResult(testResult);
        return testResult;
      }

      const testResult = classifyError(errMsg);
      setLastResult(testResult);
      return testResult;
    } finally {
      setIsTesting(false);
    }
  }, []);

  return { test, isTesting, lastResult };
}

export function classifyError(msg: string): TestResult {
  const lower = msg.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("403")) {
    return { success: false, error: "认证失败，请检查 API Key" };
  }
  if (lower.includes("not found") || lower.includes("404") || lower.includes("model_not_found")) {
    return { success: false, error: "模型不存在，请检查 Model ID" };
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("dns") ||
    lower.includes("unreachable")
  ) {
    return { success: false, error: "无法连接到服务器，请检查 Base URL" };
  }
  const truncated = msg.length > 100 ? msg.slice(0, 100) : msg;
  return { success: false, error: `连接失败：${truncated}` };
}
