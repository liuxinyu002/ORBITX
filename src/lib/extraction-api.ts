import { invoke } from "@tauri-apps/api/core";
import type { ExtractionListResponse } from "./task-types";
import { log } from "./logger";

/**
 * 分页获取提取数据。
 * page 从 1 开始计数。
 */
export async function fetchExtractions(
  taskId: string,
  page: number,
  limit: number,
): Promise<ExtractionListResponse> {
  try {
    log("info", "data-browser", `获取提取数据 taskId=${taskId} page=${page} limit=${limit}`);
    const result = await invoke<ExtractionListResponse>("list_extractions", {
      taskId,
      page,
      limit,
    });
    log("info", "data-browser", `获取提取数据成功 total=${result.total} rows=${result.rows.length}`);
    return result;
  } catch (e) {
    log("error", "data-browser", `获取提取数据失败：${String(e)}`);
    throw e;
  }
}

/**
 * 获取提取数据总数（用于分页器显示）。
 */
export async function fetchExtractionCount(taskId: string): Promise<number> {
  const { total } = await fetchExtractions(taskId, 1, 1);
  return total;
}

/**
 * 导出提取数据为 CSV 或 XLSX 文件。
 * scope: "current_page" | "all"
 * 对话框和文件写入由 Rust 侧处理。
 */
export async function exportData(
  taskId: string,
  format: "csv" | "xlsx",
  scope: "current_page" | "all",
  page?: number,
  limit?: number,
): Promise<string> {
  try {
    log("info", "data-browser", `发起导出请求 format=${format} scope=${scope}`);
    const path = await invoke<string>("export_data", {
      taskId,
      format,
      scope,
      page: scope === "current_page" ? page : undefined,
      limit: scope === "current_page" ? limit : undefined,
    });
    log("info", "data-browser", `导出成功 path=${path}`);
    return path;
  } catch (e) {
    log("error", "data-browser", `导出失败：${String(e)}`);
    throw e;
  }
}

/**
 * 删除单条提取记录。
 */
export async function removeExtraction(id: string): Promise<void> {
  try {
    log("info", "data-browser", `删除记录 id=${id}`);
    await invoke("delete_extraction", { id });
    log("info", "data-browser", `删除成功 id=${id}`);
  } catch (e) {
    log("error", "data-browser", `删除失败：${String(e)}`);
    throw e;
  }
}
