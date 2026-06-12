import { useState, useEffect, useRef, useCallback } from "react";
import { PROVIDER_PRESETS, useAgent } from "@/agent";
import type { ModelConfig, ModelConfigInput } from "@/agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";
import { toast } from "sonner";

type ProviderId = "deepseek" | "custom";

interface TabFormData {
  label: string;
  apiKey: string;
  baseUrl: string;
  modelIds: string[];
}

/** 预设默认值——不含用户数据 */
function presetDefaults(preset: (typeof PROVIDER_PRESETS)[number]): TabFormData {
  return {
    label: "",
    apiKey: "",
    baseUrl: preset.baseUrl,
    modelIds: [],
  };
}

// ── 内部内容组件（需在 AgentProvider 内渲染）─────────────────────────

function SettingsContent() {
  const {
    configs,
    activeModel,
    saveConfig,
    setActiveModel,
    getApiKey,
    testConnection,
    isTesting,
  } = useAgent();

  // ── 状态 ──────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<ProviderId>("deepseek");
  const [configData, setConfigData] = useState<Record<ProviderId, TabFormData> | null>(null);
  const [snapshot, setSnapshot] = useState<Record<ProviderId, TabFormData> | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);
  const [testState, setTestState] = useState<"idle" | "testing" | "done">("idle");
  const [newModelInput, setNewModelInput] = useState("");

  const initialized = useRef(false);
  const activePreset = PROVIDER_PRESETS.find((p) => p.id === activeTab)!;

  // ── 初始化：从后端加载配置填充 buffer ──────────────────────────────

  useEffect(() => {
    if (initialized.current) return;

    let cancelled = false;
    const init = async () => {
      if (cancelled || initialized.current) return;
      initialized.current = true;

      const data = {} as Record<ProviderId, TabFormData>;
      for (const p of PROVIDER_PRESETS) {
        const saved = configs.find((c) => c.provider === p.id);
        if (saved) {
          let apiKey = "";
          try {
            apiKey = await getApiKey(saved.id);
          } catch {
            // 获取完整 key 失败则留空
          }
          data[p.id] = {
            label: saved.label,
            apiKey,
            baseUrl: saved.baseUrl || p.baseUrl,
            modelIds: saved.modelId ? [saved.modelId] : [],
          };
        } else {
          data[p.id] = presetDefaults(p);
        }
      }
      if (!cancelled) {
        setConfigData(data);
        setSnapshot(structuredClone(data));
        const initModels = data["deepseek"]?.modelIds;
        if (initModels && initModels.length > 0) {
          setNewModelInput(initModels[0]);
        }
      }
    };

    const timer = setTimeout(init, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [configs, getApiKey]);

  // ── 当前 tab 的表单值（从 buffer 读取）─────────────────────────────

  const form = configData?.[activeTab] ?? presetDefaults(activePreset);

  // ── 切换 tab：先存入当前表单，再载入目标 tab ───────────────────────

  const switchTab = useCallback(
    (target: ProviderId) => {
      if (!configData) return;
      // 当前表单值已通过 onChange 实时写入 configData，无需额外存
      setActiveTab(target);
      setShowKey(false);
      setTestResult(null);
      setTestState("idle");
      const targetModels = configData[target]?.modelIds;
      setNewModelInput(targetModels && targetModels.length > 0 ? targetModels[0] : "");
    },
    [configData],
  );

  // ── 表单字段变更 → 直接写入 buffer ────────────────────────────────

  const updateField = useCallback(
    <K extends keyof TabFormData>(field: K, value: TabFormData[K]) => {
      if (!configData) return;
      setConfigData({
        ...configData,
        [activeTab]: { ...configData[activeTab], [field]: value },
      });
    },
    [configData, activeTab],
  );

  // ── Model chip 操作 ────────────────────────────────────────────────

  const toggleChip = useCallback(
    (modelId: string) => {
      if (form.modelIds.includes(modelId)) {
        updateField("modelIds", []);
        setNewModelInput("");
      } else {
        updateField("modelIds", [modelId]);
        setNewModelInput(modelId);
      }
    },
    [form.modelIds, updateField],
  );

  const addCustomModel = useCallback(() => {
    const trimmed = newModelInput.trim();
    if (!trimmed) return;
    if (form.modelIds.includes(trimmed)) {
      setNewModelInput("");
      return;
    }
    updateField("modelIds", [trimmed]);
    setNewModelInput("");
  }, [newModelInput, form.modelIds, updateField]);

  const removeChip = useCallback(
    (modelId: string) => {
      updateField(
        "modelIds",
        form.modelIds.filter((id) => id !== modelId),
      );
    },
    [form.modelIds, updateField],
  );

  // ── 连接测试 ──────────────────────────────────────────────────────

  const handleTest = useCallback(async () => {
    if (!form.apiKey.trim()) {
      toast.info("请先填写 API 密钥");
      return;
    }
    if (form.modelIds.length === 0) {
      toast.info("请至少选择一个模型");
      return;
    }

    setTestState("testing");
    setTestResult(null);

    const mockConfig: ModelConfig = {
      id: configs.find((c) => c.provider === activeTab)?.id ?? "",
      provider: activeTab,
      label: form.label || activePreset.name,
      baseUrl: form.baseUrl,
      modelId: form.modelIds[0],
      modelName: form.modelIds[0],
      apiKey: form.apiKey,
      isActive: false,
      createdAt: "",
      updatedAt: "",
    };

    const maskedKey = form.apiKey.length > 8
      ? `${form.apiKey.slice(0, 4)}***${form.apiKey.slice(-4)}`
      : "***";
    const prompt = "你好";
    log(
      "info",
      "connection-test",
      `发起连接测试: ${JSON.stringify({ modelName: mockConfig.modelName, baseUrl: mockConfig.baseUrl, apiKey: maskedKey, prompt: prompt.slice(0, 50) })}`,
    );

    const result = await testConnection(mockConfig);
    setTestResult(result);
    setTestState("done");

    log(
      "info",
      "connection-test",
      `连接测试结果: ${JSON.stringify({ success: result.success, latencyMs: result.latencyMs, error: result.error })}`,
    );

    // 10 秒后自动清除
    setTimeout(() => {
      setTestResult(null);
      setTestState("idle");
    }, 10_000);
  }, [form, activeTab, activePreset, configs, testConnection]);

  // testResult 变化时若为 null 切回 idle
  useEffect(() => {
    if (testResult === null && testState === "done") {
      setTestState("idle");
    }
  }, [testResult, testState]);

  // ── 表单校验 ──────────────────────────────────────────────────────

  const validate = useCallback((): string | null => {
    if (!form.label.trim()) return "请输入配置别名";
    if (!form.apiKey.trim()) return "请输入 API 密钥";
    if (form.modelIds.length === 0) return "请至少选择一个模型";
    return null;
  }, [form]);

  // ── 保存并应用 ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const msg = validate();
    if (msg) {
      toast.info(msg);
      return;
    }
    setSaving(true);
    try {
      const input: ModelConfigInput = {
        provider: activeTab,
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim(),
        modelId: form.modelIds[0],
        modelName: form.modelIds[0],
        apiKey: form.apiKey.trim(),
      };
      const id = await saveConfig(input);
      // 保存后自动激活
      try {
        await setActiveModel(id);
      } catch {
        // 激活失败不阻塞
      }
      toast.success("配置已保存并应用");
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [validate, activeTab, form, saveConfig, setActiveModel]);

  // ── 重置默认（仅当前 tab）─────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (!configData) return;
    setConfigData({
      ...configData,
      [activeTab]: presetDefaults(activePreset),
    });
    setShowKey(false);
    setTestResult(null);
    setTestState("idle");
    setNewModelInput("");
  }, [configData, activeTab, activePreset]);

  // ── 取消（恢复快照）───────────────────────────────────────────────

  const handleCancel = useCallback(() => {
    if (!snapshot) return;
    setConfigData(structuredClone(snapshot));
    setShowKey(false);
    setTestResult(null);
    setTestState("idle");
    setNewModelInput("");
  }, [snapshot]);

  // ── 测试指示灯颜色 ────────────────────────────────────────────────

  const indicatorColor = (() => {
    if (testState === "testing") return "bg-yellow-500 animate-pulse";
    if (testState === "done" && testResult?.success) return "bg-green-500";
    if (testState === "done" && !testResult?.success) return "bg-destructive";
    return "bg-muted-foreground/30";
  })();

  const indicatorLabel = (() => {
    if (testState === "testing") return "测试中...";
    if (testState === "done" && testResult?.success) return `连接成功 ${testResult.latencyMs}ms`;
    if (testState === "done" && !testResult?.success) return testResult?.error ?? "连接失败";
    return "未检测";
  })();

  // ── 加载中 ────────────────────────────────────────────────────────

  if (!configData) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── 渲染 ──────────────────────────────────────────────────────────

  return (
    <div className="h-full flex bg-[#F3F4F7]">
      {/* Left Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-200 p-4 overflow-y-auto">
        <nav className="flex flex-col gap-1">
          <a className="rounded-md px-3 py-2 text-sm font-semibold bg-white shadow-sm text-primary">
            AI 模型连接
          </a>
          {activeModel && (
            <div className="px-3 py-1 text-xs text-slate-500 truncate">
              当前使用模型：{activeModel.modelName}
            </div>
          )}
        </nav>
      </aside>

      {/* Right Content Area */}
      <div className="flex-1 overflow-y-auto p-8 md:p-12">
        <div className="max-w-2xl">
          {/* Page Title */}
          <h1 className="text-2xl font-semibold mb-2">AI 模型连接设置</h1>
          <p className="text-sm text-muted-foreground mb-6">配置您的 API 密钥以启用智能功能</p>

          {/* Segmented Control */}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 mb-10">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => switchTab(p.id)}
                className={cn(
                  "px-6 py-2.5 text-base font-medium transition-all rounded-lg",
                  activeTab === p.id
                    ? "bg-white shadow-sm text-foreground"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Section A: API 凭证 */}
          <div className="flex flex-col gap-5">
              {/* 配置别名 */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">配置别名</label>
                <Input
                  className="h-10 bg-white shadow-sm border-slate-300"
                  placeholder="为此配置命名"
                  value={form.label}
                  onChange={(e) => updateField("label", e.target.value)}
                />
              </div>

              {/* API 密钥 */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">API 密钥</label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="输入 API Key"
                    value={form.apiKey}
                    onChange={(e) => updateField("apiKey", e.target.value)}
                    className="h-10 pr-10 bg-white shadow-sm border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {/* 接口代理地址 */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">接口代理地址</label>
                <Input
                  className="h-10 bg-white shadow-sm border-slate-300"
                  placeholder={
                    activePreset.builtin ? "" : "例如 http://localhost:11434/v1"
                  }
                  value={form.baseUrl}
                  onChange={(e) => updateField("baseUrl", e.target.value)}
                />
              </div>
          </div>

          <hr className="border-slate-200 my-5" />

          {/* Section B: 模型配置 */}
          <div className="flex flex-col gap-5">
              {/* 启用模型 */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-800">启用模型</label>
                {activeTab === "custom" ? (
                  <Input
                    className="h-10 bg-white shadow-sm border-slate-300"
                    placeholder="输入模型名称，例如 llama3"
                    value={form.modelIds[0] || ""}
                    onChange={(e) => updateField("modelIds", e.target.value ? [e.target.value.trim()] : [])}
                  />
                ) : (
                  <div className="rounded-lg bg-white border border-slate-300 shadow-sm py-3 px-3">
                    <div className="flex flex-wrap items-center gap-2">
                    {/* 常用模型 chips */}
                    {activePreset.commonModels.map((m) => {
                      const selected = form.modelIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleChip(m.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm transition-colors",
                            selected
                              ? "bg-slate-100 text-slate-700"
                              : "bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100",
                          )}
                        >
                          {m.name}
                          {selected && (
                            <X
                              className="size-3 cursor-pointer hover:text-red-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeChip(m.id);
                              }}
                            />
                          )}
                        </button>
                      );
                    })}

                    {/* 手动添加的模型 */}
                    {form.modelIds
                      .filter((id) => !activePreset.commonModels.some((m) => m.id === id))
                      .map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-sm text-slate-700"
                        >
                          {id}
                          <X
                            className="size-3 cursor-pointer hover:text-red-500"
                            onClick={() => removeChip(id)}
                          />
                        </span>
                      ))}
                  </div>

                  {/* 隐形输入框 */}
                  <input
                    className="w-full mt-2 bg-transparent border-none outline-none ring-0 text-sm placeholder:text-slate-400"
                    placeholder="添加模型..."
                    value={newModelInput}
                    onChange={(e) => setNewModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomModel();
                      }
                    }}
                    onBlur={() => addCustomModel()}
                  />
                </div>
                )}
              </div>
          </div>

          {/* Section C: 状态与测试 */}
          <div className="mt-5">
            <div className="flex items-center gap-4 rounded-lg bg-white shadow-sm border border-slate-200 px-4 py-3">
                <span className={cn("size-2 shrink-0 rounded-full", indicatorColor)} />
                <span className="min-w-0 flex-1 text-xs text-muted-foreground truncate">
                  {indicatorLabel}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTest}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      测试中...
                    </>
                  ) : (
                    "测试连接"
                  )}
                </Button>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            重置默认
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存并应用"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

// ── 路由入口 ─────────────────────────────────────────────────────────

/** AgentProvider 已提升到 App 级别（Phase-3），此处直接渲染内容。 */
export default function Settings() {
  return <SettingsContent />;
}
