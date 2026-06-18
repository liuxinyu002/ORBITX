import { useState, useCallback, useEffect } from "react";
import { useTaskList } from "@/hooks/useTaskList";
import { useTaskDraft } from "@/hooks/useTaskDraft";
import { useConfirm } from "@/components/ConfirmDialog";
import { useNavigationGuard } from "@/lib/navigation-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Trash2 } from "lucide-react";
import SchemaEditor from "./components/SchemaEditor";
import DataBrowser from "./components/DataBrowser";

// ═══════════════════════════════════════════════════════════════════════════
// 主入口组件
// ═══════════════════════════════════════════════════════════════════════════

export default function StructuredExtractor() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const taskList = useTaskList();
  const draft = useTaskDraft({
    selectedTaskId,
    onSaved: () => {
      taskList.refresh();
    },
  });

  const { confirm } = useConfirm();
  const { setGuard } = useNavigationGuard();

  // ── 导航拦截：未保存修改时提醒 ───────────────────────────────────
  useEffect(() => {
    if (draft.isDirty) {
      setGuard(async () =>
        confirm({
          title: "当前编辑内容尚未保存",
          description: "是否放弃当前修改？",
          variant: "danger",
        }),
      );
    } else {
      setGuard(null);
    }
    return () => setGuard(null);
  }, [draft.isDirty, setGuard, confirm]);

  const handleSelectTask = useCallback(
    async (id: string) => {
      if (id === selectedTaskId) return;
      if (draft.isDirty) {
        const ok = await confirm({
          title: "当前编辑内容尚未保存",
          description: "是否放弃当前修改？",
          variant: "danger",
        });
        if (!ok) return;
      }
      setSelectedTaskId(id);
    },
    [draft.isDirty, selectedTaskId, confirm],
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "确定要删除此任务吗？",
        description: "此操作不可撤销。",
        variant: "danger",
        confirmLabel: "删除",
      });
      if (!ok) return;
      if (selectedTaskId === id) {
        setSelectedTaskId(null);
      }
      await taskList.remove(id);
    },
    [selectedTaskId, taskList, confirm],
  );

  const handleActivate = useCallback(
    async (id: string) => {
      if (taskList.activeTaskId === id) {
        await taskList.setActive(null);
      } else {
        await taskList.setActive(id);
      }
    },
    [taskList],
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="flex h-full bg-background">
      {/* ── 左侧栏 ────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-white">
        {/* 搜索框 */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-sm bg-muted border-border"
              placeholder="搜索任务..."
              value={taskList.searchKeyword}
              onChange={(e) => taskList.setSearchKeyword(e.target.value)}
            />
          </div>
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-y-auto px-2">
          {taskList.tasks.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground mt-8">
              {taskList.allTasks.length === 0 ? "暂无任务，点击下方按钮创建" : "无匹配任务"}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {taskList.tasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors group",
                    selectedTaskId === task.id
                      ? "bg-muted"
                      : "hover:bg-muted",
                  )}
                  onClick={() => handleSelectTask(task.id)}
                >
                  {/* 激活 Switch（排他单选） */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActivate(task.id);
                    }}
                    className={cn(
                      "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                      taskList.activeTaskId === task.id
                        ? "bg-primary"
                        : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                        taskList.activeTaskId === task.id
                          ? "translate-x-3.5"
                          : "translate-x-0.5",
                      )}
                    />
                  </button>

                  {/* 任务名 */}
                  <span className="flex-1 truncate text-sm text-foreground">
                    {task.name}
                  </span>

                  {/* 删除按钮 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTask(task.id);
                    }}
                    className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive-fg hover:bg-destructive-subtle transition-colors shrink-0"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 新建任务按钮 */}
        <div className="p-3 border-t border-border">
          <Button
            variant="secondary"
            className="w-full h-8 text-sm"
            onClick={async () => {
              const task = await taskList.create("新建任务");
              setSelectedTaskId(task.id);
            }}
          >
            <Plus className="size-3.5" />
            新建任务
          </Button>
        </div>
      </aside>

      {/* ── 右侧主面板（Tabs） ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="schema" className="h-full flex flex-col">
          <div className="flex justify-center pt-4 pb-0">
            <TabsList variant="line">
              <TabsTrigger value="schema">字段配置</TabsTrigger>
              <TabsTrigger value="data">数据浏览</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="schema" className="flex-1 mt-0 data-[state=inactive]:hidden" forceMount>
            <SchemaEditor selectedTaskId={selectedTaskId} draft={draft} />
          </TabsContent>

          <TabsContent value="data" className="flex-1 mt-0 data-[state=inactive]:hidden" forceMount>
            <DataBrowser selectedTaskId={selectedTaskId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
