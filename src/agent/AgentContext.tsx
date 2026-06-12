import { createContext, useContext } from "react";
import type { ModelConfig } from "./types";
import { useConnectionTest } from "./hooks/useConnectionTest";
import { useModelConfig } from "./hooks/useModelConfig";

interface AgentContextValue {
  activeModel: ModelConfig | null;
  configs: ModelConfig[];
  saveConfig: ReturnType<typeof useModelConfig>["save"];
  deleteConfig: ReturnType<typeof useModelConfig>["remove"];
  getApiKey: ReturnType<typeof useModelConfig>["getApiKey"];
  setActiveModel: (id: string) => Promise<void>;
  refreshConfigs: () => Promise<void>;
  testConnection: ReturnType<typeof useConnectionTest>["test"];
  isTesting: boolean;
  lastTestResult: ReturnType<typeof useConnectionTest>["lastResult"];
}

const AgentCtx = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentCtx);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}

/** Phase-2: 仅在 /settings 路由内包裹。Phase-5 提升到 App 级别。 */
export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { configs, activeModel, save, remove, getApiKey, setActive, refresh } =
    useModelConfig();
  const { test, isTesting, lastResult } = useConnectionTest();

  return (
    <AgentCtx.Provider
      value={{
        activeModel,
        configs,
        saveConfig: save,
        deleteConfig: remove,
        getApiKey,
        setActiveModel: setActive,
        refreshConfigs: refresh,
        testConnection: test,
        isTesting,
        lastTestResult: lastResult,
      }}
    >
      {children}
    </AgentCtx.Provider>
  );
}

// 导出 hooks 类型供内部使用
export type { ModelConfig, ModelConfigInput } from "./types";
