import { useState, useEffect, useRef, useCallback } from "react";
import { AgentProvider, PROVIDER_PRESETS, useAgent } from "@/agent";
import type { ModelConfig, ModelConfigInput } from "@/agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ProviderId = "deepseek" | "openai" | "zhipu" | "custom";

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
      // 清空 tab 级 UI 状态
      setShowKey(false);
      setTestResult(null);
      setTestState("idle");
      setNewModelInput("");
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
      const current = form.modelIds;
      if (current.includes(modelId)) {
        updateField("modelIds", current.filter((id) => id !== modelId));
      } else {
        updateField("modelIds", [...current, modelId]);
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
    updateField("modelIds", [...form.modelIds, trimmed]);
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

    const result = await testConnection(mockConfig);
    setTestResult(result);
    setTestState("done");

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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── 渲染 ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center px-4 py-8">
      <Card className="w-full max-w-4xl mx-auto">
        {/* Header */}
        <CardHeader>
          <CardTitle>AI 模型连接设置</CardTitle>
          <CardDescription className="mb-6">配置您的 API 密钥以启用智能功能</CardDescription>
        </CardHeader>

        {/* Segmented Control */}
        <CardContent>
          <div className="inline-flex rounded-lg ring-1 ring-foreground/10">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => switchTab(p.id)}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg",
                  activeTab === p.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </CardContent>

        {/* 双栏表单 */}
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* 左栏：连接凭证配置 */}
            <div className="flex flex-col gap-3">
              {/* 配置别名 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">配置别名</label>
                <Input
                  className="h-10"
                  placeholder="为此配置命名"
                  value={form.label}
                  onChange={(e) => updateField("label", e.target.value)}
                />
              </div>

              {/* API 密钥 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">API 密钥</label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="输入 API Key"
                    value={form.apiKey}
                    onChange={(e) => updateField("apiKey", e.target.value)}
                    className="h-10 pr-8"
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
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">接口代理地址</label>
                <Input
                  className="h-10"
                  placeholder={
                    activePreset.builtin ? "" : "例如 http://localhost:11434/v1"
                  }
                  value={form.baseUrl}
                  onChange={(e) => updateField("baseUrl", e.target.value)}
                />
              </div>
            </div>

            {/* 右栏：模型管理与诊断 */}
            <div className="flex flex-col gap-4">
              {/* 启用模型 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">启用模型</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* 常用模型 chips */}
                  {activePreset.commonModels.map((m) => {
                    const selected = form.modelIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleChip(m.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                          selected
                            ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                            : "bg-muted text-muted-foreground hover:bg-muted/80",
                        )}
                      >
                        {m.name}
                        {selected && (
                          <X
                            className="size-3 cursor-pointer hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeChip(m.id);
                            }}
                          />
                        )}
                      </button>
                    );
                  })}

                  {/* 手动添加的模型（非 commonModels 中的） */}
                  {form.modelIds
                    .filter((id) => !activePreset.commonModels.some((m) => m.id === id))
                    .map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/30"
                      >
                        {id}
                        <X
                          className="size-3 cursor-pointer hover:text-destructive"
                          onClick={() => removeChip(id)}
                        />
                      </span>
                    ))}

                  {/* 手动输入框 */}
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-7 w-32 text-xs"
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
                </div>
              </div>

              {/* 连接测试栏 */}
              <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2">
                <span className={cn("size-2 shrink-0 rounded-full", indicatorColor)} />
                <span className="min-w-0 flex-1 text-xs text-muted-foreground truncate">
                  {indicatorLabel}
                </span>
                <Button
                  size="xs"
                  variant="outline"
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
          </div>
        </CardContent>

        {/* Footer */}
        <CardFooter className="justify-between">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            重置默认
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存并应用"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

// ── 路由入口：包裹 AgentProvider ─────────────────────────────────────

/** Phase-2: AgentProvider 仅包裹在 /settings 路由内。Phase-5 提升到 App 级别。 */
export default function Settings() {
  return (
    <AgentProvider>
      <SettingsContent />
    </AgentProvider>
  );
}
