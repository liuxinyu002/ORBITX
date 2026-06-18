import { useCallback, useRef } from "react";
import { useAgent, SCHEMA_GENERATION_PROMPT, parseAIResponse } from "@/agent";
import { resolveModel } from "@/agent";
import { complete } from "@earendil-works/pi-ai";
import { useTaskDraft } from "@/hooks/useTaskDraft";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Field } from "@/lib/task-types";

// ── 类型常量 ───────────────────────────────────────────────────────────

const FIELD_TYPES: Field["type"][] = ["String", "Number", "Date"];

// ═══════════════════════════════════════════════════════════════════════════
// SchemaEditor
// ═══════════════════════════════════════════════════════════════════════════

export default function SchemaEditor({
  selectedTaskId,
  draft,
}: {
  selectedTaskId: string | null;
  draft: ReturnType<typeof useTaskDraft>;
}) {
  const { activeModel } = useAgent();

  // ── AI 生成 ──────────────────────────────────────────────────────────

  const aiInputRef = useRef<HTMLInputElement>(null);

  const handleAIGenerate = useCallback(async () => {
    const userInput = aiInputRef.current?.value.trim();
    if (!userInput) {
      toast.error("请输入需要提取的数据字段描述");
      return;
    }

    if (!activeModel) {
      toast.error("请先在设置中配置并激活模型");
      return;
    }

    draft.setIsGenerating(true);
    try {
      const model = resolveModel(activeModel);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let result;
      try {
        result = await complete(
          model,
          {
            systemPrompt: SCHEMA_GENERATION_PROMPT.content,
            messages: [
              { role: "user", content: userInput, timestamp: Date.now() },
            ],
          },
          {
            apiKey: activeModel.apiKey,
            maxTokens: 4096,
            timeoutMs: 15000,
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (result.stopReason === "error") {
        toast.error("AI 生成失败，请重试");
        return;
      }

      const content = result.content;
      if (!content || (Array.isArray(content) && content.length === 0)) {
        toast.error("AI 返回内容为空，请重试");
        return;
      }

      const responseText = Array.isArray(content)
        ? content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("")
        : String(content);
      const parsed = parseAIResponse(responseText);

      if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.fields)) {
        toast.error("AI 返回格式异常，请重试");
        return;
      }

      const validFields: Field[] = (parsed.fields as Record<string, unknown>[]).map((f) => ({
        name: String(f.name ?? ""),
        type: (["String", "Number", "Date"].includes(f.type as string) ? f.type : "String") as Field["type"],
        required: Boolean(f.required),
        description: String(f.description ?? ""),
      }));

      draft.replaceFields(validFields);
      if (aiInputRef.current) aiInputRef.current.value = "";
      toast.success(`AI 已生成 ${validFields.length} 个字段`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.error("AI 生成超时，请重试");
      } else {
        toast.error(`AI 生成失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      draft.setIsGenerating(false);
    }
  }, [activeModel, draft]);

  // ── 字段名重复实时检测 ──────────────────────────────────────────────

  const duplicateNames = useCallback((): Set<string> => {
    const seen = new Map<string, number>();
    for (const f of draft.fields) {
      if (f.name) seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [draft.fields]);

  const dupes = duplicateNames();

  // ── AI input Enter key ───────────────────────────────────────────────

  const handleAIInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleAIGenerate();
    },
    [handleAIGenerate],
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  if (selectedTaskId === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">请在左侧选择一个任务</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      {/* ── 任务基本信息区域 ───────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            任务名称
          </label>
          <Input
            className="h-9 bg-white shadow-sm border-input"
            value={draft.taskName}
            onChange={(e) => draft.setTaskName(e.target.value)}
            onBlur={() => draft.saveTaskName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            任务描述
          </label>
          <Input
            className="h-9 bg-white shadow-sm border-input"
            placeholder="描述此任务的提取目的（可选）"
            value={draft.taskDescription}
            onChange={(e) => {
              draft.setTaskDescription(e.target.value);
              draft.markDirty();
            }}
          />
        </div>
      </div>

      {/* ── AI Generation Zone ──────────────────────────────── */}
      <div className="rounded-lg border border-border bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          AI 生成字段草稿
        </h3>
        <div className="flex gap-2">
          <Input
            ref={aiInputRef}
            className="h-9 flex-1 bg-muted border-border text-sm"
            placeholder="描述你需要提取的数据字段，例如「提取候选人姓名、邮箱、手机号、工作年限」"
            disabled={draft.isGenerating}
            onKeyDown={handleAIInputKeyDown}
          />
          <Button
            size="sm"
            className="h-9 shrink-0"
            onClick={handleAIGenerate}
            disabled={draft.isGenerating}
          >
            {draft.isGenerating ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                生成中...
              </>
            ) : (
              "生成草稿"
            )}
          </Button>
        </div>
      </div>

      {/* ── Schema Editor Zone ──────────────────────────────── */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">
          字段配置
        </h3>
        <div className="rounded-lg border border-border bg-white overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_100px_50px_1fr_40px] gap-2 px-4 py-2 bg-muted border-b border-border text-xs font-medium text-muted-foreground">
            <span>字段名</span>
            <span>类型</span>
            <span className="text-center">必填</span>
            <span>说明</span>
            <span />
          </div>

          {/* 字段行 */}
          {draft.fields.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              暂无字段，请通过 AI 生成或手动添加
            </div>
          ) : (
            draft.fields.map((field, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_100px_50px_1fr_40px] gap-2 px-4 py-2 border-b border-border last:border-b-0 items-center"
              >
                <div className="relative">
                  <Input
                    className="h-8 text-sm border-border bg-muted"
                    placeholder="field_name"
                    value={field.name}
                    onChange={(e) =>
                      draft.updateField(idx, { name: e.target.value })
                    }
                  />
                  {field.name && dupes.has(field.name) && (
                    <p className="text-destructive-fg text-[10px] absolute -bottom-3.5 left-0">
                      字段名重复
                    </p>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                      className: "h-8 w-[100px] justify-between text-sm font-normal",
                    })}
                  >
                    {field.type}
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuRadioGroup
                      value={field.type}
                      onValueChange={(value) =>
                        draft.updateField(idx, {
                          type: value as Field["type"],
                        })
                      }
                    >
                      {FIELD_TYPES.map((t) => (
                        <DropdownMenuRadioItem key={t} value={t}>
                          {t}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      draft.updateField(idx, {
                        required: !field.required,
                      })
                    }
                    className={cn(
                      "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                      field.required ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                        field.required
                          ? "translate-x-3.5"
                          : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                <Input
                  className="h-8 text-sm border-border bg-muted"
                  placeholder="字段说明（可选）"
                  value={field.description}
                  onChange={(e) =>
                    draft.updateField(idx, {
                      description: e.target.value,
                    })
                  }
                />

                <button
                  type="button"
                  onClick={() => draft.removeField(idx)}
                  className="flex items-center justify-center size-7 rounded hover:bg-destructive-subtle text-muted-foreground hover:text-destructive-fg transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          )}

          {/* 添加字段 */}
          <div className="px-4 py-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={draft.addField}
            >
              <Plus className="size-3" />
              添加字段
            </Button>
          </div>
        </div>
      </div>

      {/* ── 底部 Action Bar ─────────────────────────────────── */}
      <div className="flex justify-end pt-4 border-t border-border">
        <div className="flex items-center gap-3">
          {draft.isDirty && (
            <span className="text-xs text-warning">有未保存的修改</span>
          )}
          <Button onClick={draft.saveSchema} disabled={draft.isSaving}>
            {draft.isSaving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                保存中...
              </>
            ) : (
              "保存修改"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
