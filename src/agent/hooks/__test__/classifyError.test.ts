import { describe, it, expect } from "vitest";
import { classifyError } from "@/agent/hooks/useConnectionTest";

describe("classifyError", () => {
  // ── CP-CT-2: 认证失败 — 401/403/unauthorized ─────────────────────
  it("识别 401 为认证失败", () => {
    const result = classifyError("HTTP 401 Unauthorized");
    expect(result.success).toBe(false);
    expect(result.error).toBe("认证失败，请检查 API Key");
  });

  it("识别 403 为认证失败", () => {
    const result = classifyError("403 Forbidden");
    expect(result.success).toBe(false);
    expect(result.error).toBe("认证失败，请检查 API Key");
  });

  it("识别 unauthorized 关键词为认证失败（不区分大小写）", () => {
    const result = classifyError("Unauthorized: invalid token");
    expect(result.success).toBe(false);
    expect(result.error).toBe("认证失败，请检查 API Key");
  });

  // ── CP-CT-2: 模型不存在 — 404/not found/model_not_found ──────────
  it("识别 404 为模型不存在", () => {
    const result = classifyError("HTTP 404 Not Found");
    expect(result.success).toBe(false);
    expect(result.error).toBe("模型不存在，请检查 Model ID");
  });

  it("识别 not found 为模型不存在", () => {
    const result = classifyError("model not found");
    expect(result.success).toBe(false);
    expect(result.error).toBe("模型不存在，请检查 Model ID");
  });

  it("识别 model_not_found 为模型不存在", () => {
    const result = classifyError("error: model_not_found for glm-4");
    expect(result.success).toBe(false);
    expect(result.error).toBe("模型不存在，请检查 Model ID");
  });

  // ── CP-CT-2: 网络不可达 ────────────────────────────────────────
  it("识别 fetch failed 为网络不可达", () => {
    const result = classifyError("fetch failed");
    expect(result.success).toBe(false);
    expect(result.error).toBe("无法连接到服务器，请检查 Base URL");
  });

  it("识别 ECONNREFUSED 为网络不可达", () => {
    const result = classifyError("connect ECONNREFUSED 127.0.0.1:11434");
    expect(result.success).toBe(false);
    expect(result.error).toBe("无法连接到服务器，请检查 Base URL");
  });

  it("识别 DNS 错误为网络不可达", () => {
    const result = classifyError("DNS lookup failed");
    expect(result.success).toBe(false);
    expect(result.error).toBe("无法连接到服务器，请检查 Base URL");
  });

  // ── CP-CT-2: 未归类错误 — 截断至 100 字符 ────────────────────
  it("未归类错误返回通用消息（短于100字符）", () => {
    const result = classifyError("some unknown error");
    expect(result.success).toBe(false);
    expect(result.error).toBe("连接失败：some unknown error");
  });

  it("未归类错误截断超过 100 字符的消息", () => {
    const long = "x".repeat(150);
    const result = classifyError(long);
    expect(result.success).toBe(false);
    expect(result.error!.length).toBeLessThanOrEqual(106); // "连接失败：" + 100 chars
    expect(result.error).toBe("连接失败：" + "x".repeat(100));
  });

  // ── 边界条件 ─────────────────────────────────────────────────
  it("空字符串返回未归类错误", () => {
    const result = classifyError("");
    expect(result.success).toBe(false);
    expect(result.error).toBe("连接失败：");
  });

  it("不区分大小写匹配", () => {
    const r1 = classifyError("UNAUTHORIZED");
    expect(r1.error).toBe("认证失败，请检查 API Key");

    const r2 = classifyError("NOT FOUND");
    expect(r2.error).toBe("模型不存在，请检查 Model ID");

    const r3 = classifyError("NETWORK ERROR");
    expect(r3.error).toBe("无法连接到服务器，请检查 Base URL");
  });

  // ── 匹配优先级：认证 > 模型不存在 > 网络不可达 ──────────────
  it("同时包含多个关键词时按优先级匹配（认证优先）", () => {
    // unauthorized 优先级最高
    const result = classifyError("unauthorized 404 not found network error");
    expect(result.error).toBe("认证失败，请检查 API Key");
  });

  it("网络关键词优先级最低", () => {
    // 不含认证和404关键词时匹配网络
    const result = classifyError("network fetch failed dns unreachable");
    expect(result.error).toBe("无法连接到服务器，请检查 Base URL");
  });
});
