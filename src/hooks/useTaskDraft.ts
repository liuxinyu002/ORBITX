import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Field, Task } from "@/lib/task-types";
import { taskSchemaValidator } from "@/lib/task-validator";
import { toast } from "sonner";

interface UseTaskDraftOptions {
  selectedTaskId: string | null;
  onSaved: () => void;
}

export function useTaskDraft({ selectedTaskId, onSaved }: UseTaskDraftOptions) {
  const [fields, setFields] = useState<Field[]>([]);
  const [taskName, setTaskName] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const prevTaskId = useRef<string | null>(null);

  const loadTask = useCallback(async (id: string) => {
    try {
      const task = await invoke<Task>("get_task", { id });
      setTaskName(task.name);
      setTaskDescription(task.description ?? "");
      if (task.schema) {
        try {
          const parsed = JSON.parse(task.schema);
          setFields(parsed.fields ?? []);
        } catch {
          setFields([]);
        }
      } else {
        setFields([]);
      }
      setIsDirty(false);
    } catch {
      // task not found — should not happen in normal flow
    }
  }, []);

  // 当选中的任务变化时加载数据（脏检测由调用方 handleSelectTask 负责）
  useEffect(() => {
    if (selectedTaskId === prevTaskId.current) return;

    prevTaskId.current = selectedTaskId;
    if (selectedTaskId !== null) {
      loadTask(selectedTaskId);
    } else {
      setFields([]);
      setTaskName("");
      setTaskDescription("");
      setIsDirty(false);
    }
  }, [selectedTaskId, loadTask]);

  function markDirty() {
    setIsDirty(true);
  }

  // ── 字段操作 ────────────────────────────────────────────────────────

  const addField = useCallback(() => {
    setFields((prev) => [
      ...prev,
      { name: "", type: "String", required: false, description: "" },
    ]);
    setIsDirty(true);
  }, []);

  const removeField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  }, []);

  const updateField = useCallback(
    (index: number, patch: Partial<Field>) => {
      setFields((prev) =>
        prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      );
      setIsDirty(true);
    },
    [],
  );

  const replaceFields = useCallback((newFields: Field[]) => {
    setFields(newFields);
    setIsDirty(true);
  }, []);

  // ── 任务名失焦自动保存 ─────────────────────────────────────────────

  const saveTaskName = useCallback(async () => {
    if (!selectedTaskId) return;
    try {
      await invoke("update_task", {
        id: selectedTaskId,
        name: taskName,
        description: null,
        schema: null,
      });
      onSaved();
    } catch (e) {
      toast.error(`任务名保存失败: ${e instanceof Error ? e.message : String(e)}`);
      // 回退到服务端当前值
      try {
        const task = await invoke<Task>("get_task", { id: selectedTaskId });
        setTaskName(task.name);
      } catch {
        // 如果 get_task 也失败，保持当前值
      }
    }
  }, [selectedTaskId, taskName, onSaved]);

  // ── 保存 Schema ─────────────────────────────────────────────────────

  const saveSchema = useCallback(async () => {
    if (!selectedTaskId) return;

    // Zod 校验
    const result = taskSchemaValidator.safeParse({ fields });
    if (!result.success) {
      const firstError = result.error.issues[0];
      toast.error(firstError.message);
      return;
    }

    setIsSaving(true);
    try {
      const schema = JSON.stringify({ fields: result.data.fields });
      await invoke("update_task", {
        id: selectedTaskId,
        name: null,
        description: taskDescription,
        schema,
      });
      setIsDirty(false);
      toast.success("保存成功");
      onSaved();
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [selectedTaskId, fields, taskDescription, onSaved]);

  return {
    fields,
    taskName,
    taskDescription,
    isDirty,
    isSaving,
    isGenerating,
    setTaskName,
    setTaskDescription,
    markDirty,
    addField,
    removeField,
    updateField,
    replaceFields,
    saveTaskName,
    saveSchema,
    setIsGenerating,
  };
}
