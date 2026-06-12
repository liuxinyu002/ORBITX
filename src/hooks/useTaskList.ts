import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { Task, TaskListResponse } from "@/lib/task-types";

export function useTaskList() {
  const [tasks, setTasks] = useState<TaskListResponse["tasks"]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");

  const refresh = useCallback(async () => {
    const resp = await invoke<TaskListResponse>("list_tasks");
    setTasks(resp.tasks);
    setActiveTaskId(resp.activeTaskId);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string): Promise<Task> => {
      const task = await invoke<Task>("create_task", { name });
      await refresh();
      return task;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await invoke("delete_task", { id });
      await refresh();
    },
    [refresh],
  );

  const setActive = useCallback(
    async (id: string | null): Promise<void> => {
      await invoke("set_active_task_id", { id });
      setActiveTaskId(id);
    },
    [],
  );

  const filteredTasks = searchKeyword
    ? tasks.filter((t) =>
        t.name.toLowerCase().includes(searchKeyword.toLowerCase()),
      )
    : tasks;

  return {
    tasks: filteredTasks,
    allTasks: tasks,
    activeTaskId,
    searchKeyword,
    setSearchKeyword,
    create,
    remove,
    setActive,
    refresh,
  };
}
