/** Schema 字段定义 */
export interface Field {
  name: string;
  type: "String" | "Number" | "Date";
  required: boolean;
  description: string;
}

/** 任务 Schema（JSON 内嵌于 tasks.schema 列） */
export interface TaskSchema {
  fields: Field[];
}

/** Rust Task 对应的前端类型 */
export interface Task {
  id: string;
  name: string;
  description: string | null;
  schema: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Rust TaskSimple 对应的前端类型 */
export interface TaskSimple {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

/** list_tasks 返回类型 */
export interface TaskListResponse {
  tasks: TaskSimple[];
  activeTaskId: string | null;
}

/** 提取数据行（对应 Rust Extraction） */
export interface Extraction {
  id: string;
  taskId: string;
  rawText: string;
  resultJson: string;
  createdAt: string;
}

/** list_extractions 返回类型 */
export interface ExtractionListResponse {
  rows: Extraction[];
  total: number;
}
