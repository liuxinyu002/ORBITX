import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { ModelConfig, ModelConfigInput } from "../types";

/**
 * 封装 Tauri command 调用，管理模型配置 CRUD。
 */
export function useModelConfig() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [activeModel, setActiveModel] = useState<ModelConfig | null>(null);

  const refresh = useCallback(async () => {
    const list = await invoke<ModelConfig[]>("get_model_configs");
    setConfigs(list);
    try {
      const active = await invoke<ModelConfig>("get_active_model");
      setActiveModel(active);
    } catch {
      setActiveModel(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: ModelConfigInput): Promise<string> => {
      const id = await invoke<string>("save_model_config", { input });
      await refresh();
      return id;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await invoke("delete_model_config", { id });
      await refresh();
    },
    [refresh],
  );

  const setActive = useCallback(
    async (id: string): Promise<void> => {
      await invoke("set_active_model", { id });
      await refresh();
    },
    [refresh],
  );

  const getApiKey = useCallback(async (id: string): Promise<string> => {
    return await invoke<string>("get_model_api_key", { id });
  }, []);

  return { configs, activeModel, save, remove, setActive, getApiKey, refresh };
}
