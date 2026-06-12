import { invoke } from "@tauri-apps/api/core";

type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * 统一日志桥接函数。
 *
 * 前端禁止直接使用 console.log / console.error。
 * 所有日志通过此函数发送到 Rust 后端统一输出（控制台 + 文件）。
 */
export async function log(
  level: LogLevel,
  target: string,
  message: string,
): Promise<void> {
  await invoke("log_event", { level, target, message });
}
