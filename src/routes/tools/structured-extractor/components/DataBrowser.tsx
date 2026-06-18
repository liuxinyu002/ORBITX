import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ExpandedState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  TriangleAlert,
  FileSearch,
  Download,
  Copy,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PAGE_SIZE } from "@/lib/constants";
import { fetchExtractions, removeExtraction, exportData } from "@/lib/extraction-api";
import { log } from "@/lib/logger";
import type { Extraction, Task, TaskSchema, Field } from "@/lib/task-types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseResultJson(raw: string): Record<string, unknown> | unknown[] | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatFieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => formatFieldValueText(v)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatFieldValueText(v)}`)
      .join(", ");
  }
  return String(value);
}

function renderFieldValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50 italic">—</span>;
  }
  return (
    <span className="font-mono text-[13px] text-foreground">
      {formatFieldValueText(value)}
    </span>
  );
}

function getFieldValue(resultJson: string, _fieldName: string): string | undefined {
  const parsed = parseResultJson(resultJson);
  if (parsed === null) return undefined;
  if (Array.isArray(parsed)) {
    return `[包含 ${parsed.length} 项数据]`;
  }
  return undefined;
}

type BrowserStatus = "loading" | "success" | "empty" | "error";

// ═══════════════════════════════════════════════════════════════════════════
// DataBrowser
// ═══════════════════════════════════════════════════════════════════════════

export default function DataBrowser({
  selectedTaskId,
}: {
  selectedTaskId: string | null;
}) {
  // ── Data state ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<Extraction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BrowserStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [taskFields, setTaskFields] = useState<Field[]>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const confirmingIdRef = useRef<string | null>(null);
  const [, setConfirmingTick] = useState(0);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Load task schema ─────────────────────────────────────────────────
  const loadTask = useCallback(async (taskId: string) => {
    try {
      const task = await invoke<Task>("get_task", { id: taskId });
      if (task.schema) {
        const schema: TaskSchema = JSON.parse(task.schema);
        setTaskFields(schema.fields ?? []);
      } else {
        setTaskFields([]);
      }
    } catch {
      setTaskFields([]);
    }
  }, []);

  // ── Load page data ───────────────────────────────────────────────────
  const loadData = useCallback(async (taskId: string, p: number) => {
    setStatus("loading");
    try {
      const result = await fetchExtractions(taskId, p, PAGE_SIZE);
      setRows(result.rows);
      setTotal(result.total);
      setStatus(result.total === 0 ? "empty" : "success");
      setErrorMessage("");
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e));
    }
  }, []);

  // ── Task switch → reset ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTaskId) return;
    setPage(1);
    setExpanded({});
    confirmingIdRef.current = null;
    setConfirmingTick(0);
    setNewRowIds(new Set());
    setDeletingIds(new Set());
    loadTask(selectedTaskId);
    loadData(selectedTaskId, 1);
  }, [selectedTaskId, loadTask, loadData]);

  // ── Page change → reload ─────────────────────────────────────────────
  const prevSelectedTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTaskId) return;
    // skip initial load (handled by task switch effect)
    if (prevSelectedTaskIdRef.current === selectedTaskId) {
      loadData(selectedTaskId, page);
    }
    prevSelectedTaskIdRef.current = selectedTaskId;
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time event listener ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedTaskId) return;
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      unlisten = await listen<Extraction>("extraction-completed", (event) => {
        const payload = event.payload;
        if (payload.taskId !== selectedTaskId) return;
        log("info", "data-browser", `收到新提取数据 task_id=${payload.taskId}`);

        setRows((prev) => {
          // 在第一页：插入到顶部并标记动画
          if (page === 1) {
            setNewRowIds((prevIds) => new Set(prevIds).add(payload.id));
            setTimeout(() => {
              setNewRowIds((prevIds) => {
                const next = new Set(prevIds);
                next.delete(payload.id);
                return next;
              });
            }, 1000);
            return [payload, ...prev];
          }
          return prev;
        });
        // 非首页：仅增加 total（setTotal 会在外部合并）
        if (page !== 1) {
          setTotal((prev) => prev + 1);
        } else {
          setTotal((prev) => prev + 1);
        }
      });
    };
    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [selectedTaskId, page]);

  // ── Delete handler ───────────────────────────────────────────────────
  const resetConfirming = useCallback(() => {
    confirmingIdRef.current = null;
    setConfirmingTick((t) => t + 1);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (confirmingIdRef.current !== id) {
      confirmingIdRef.current = id;
      setConfirmingTick((t) => t + 1);
      return;
    }
    resetConfirming();
    try {
      await removeExtraction(id);
      setDeletingIds((prev) => new Set(prev).add(id));
      log("info", "data-browser", `删除成功 id=${id}`);
      toast.success("已删除");
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      log("error", "data-browser", `删除失败：${msg}`);
      toast.error(`删除失败：${msg}`);
    }
  }, [resetConfirming]);

  // ── 删除动画 fallback：若 onAnimationEnd 未在 200ms 内触发则兜底移除 ─
  useEffect(() => {
    if (deletingIds.size === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    deletingIds.forEach((id) => {
      const timer = setTimeout(() => {
        setDeletingIds((prev) => {
          if (!prev.has(id)) return prev;
          setRows((prevRows) => prevRows.filter((r) => r.id !== id));
          setTotal((prevTotal) => prevTotal - 1);
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 200);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  }, [deletingIds]);

  // ── 删除动画完成回调 ────────────────────────────────────────────────
  const handleDeleteAnimationEnd = useCallback(
    (id: string) => (e: React.AnimationEvent<HTMLTableRowElement>) => {
      if (e.animationName.includes("fade-out") || e.animationName.includes("fadeOut")) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        setTotal((prev) => prev - 1);
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  // ── Export handler ────────────────────────────────────────────────────
  const handleExport = useCallback(
    async (format: "csv" | "xlsx", scope: "current_page" | "all") => {
      try {
        const path = await exportData(
          selectedTaskId!,
          format,
          scope,
          page,
          PAGE_SIZE,
        );
        toast.success(`已导出到 ${path}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        // 用户取消了保存对话框，不是错误
        if (msg.includes("取消")) return;
        toast.error(`导出失败：${msg}`);
      }
    },
    [selectedTaskId, page],
  );

  // ── Columns ──────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<Extraction>[]>(() => [
    {
      id: "expand",
      header: "",
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableResizing: false,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6"
          onClick={() => row.toggleExpanded()}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </Button>
      ),
    },
    {
      id: "raw_text",
      header: "原文本",
      size: 200,
      minSize: 200,
      maxSize: 250,
      cell: ({ row }) => (
        <span className="block truncate max-w-[230px]" title={row.original.rawText}>
          {row.original.rawText}
        </span>
      ),
    },
    ...taskFields.map((field) => ({
      id: `field_${field.name}`,
      header: field.name,
      size: 150,
      minSize: 150,
      cell: ({ row }: { row: { original: Extraction } }) => {
        const val = getFieldValue(row.original.resultJson, field.name);
        if (val === undefined) {
          return <span className="text-muted-foreground/50">—</span>;
        }
        if (val.startsWith("[包含 ") && val.endsWith(" 项数据]")) {
          return <span className="text-muted-foreground">{val}</span>;
        }
        return <span className="block truncate">{val}</span>;
      },
    })),
    {
      id: "created_at",
      header: "时间",
      size: 150,
      minSize: 150,
      maxSize: 150,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">{formatTime(row.original.createdAt)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 80,
      minSize: 80,
      maxSize: 100,
      enableResizing: false,
      cell: ({ row }) => {
        const id = row.original.id;
        const isConfirming = confirmingIdRef.current === id;
        return (
          <div className="flex justify-end">
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) resetConfirming();
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="size-7">
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  className="text-sm cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(row.original.rawText);
                    toast.success("已复制到剪贴板");
                  }}
                >
                  <Copy className="size-3.5" />
                  复制原文本
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-sm cursor-pointer"
                  onClick={() => toast.info("编辑功能开发中")}
                >
                  <Pencil className="size-3.5" />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={cn(
                    "text-sm cursor-pointer",
                    isConfirming
                      ? "text-destructive-fg bg-destructive-subtle focus:bg-destructive-subtle focus:text-destructive-fg"
                      : "text-destructive",
                  )}
                  onSelect={(e) => {
                    if (!isConfirming) {
                      e.preventDefault();
                      confirmingIdRef.current = id;
                      setConfirmingTick((t) => t + 1);
                    } else {
                      handleDelete(id);
                    }
                  }}
                >
                  {isConfirming ? "确认删除？" : "删除"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ], [taskFields]);

  // ── Table instance ───────────────────────────────────────────────────
  const table = useReactTable({
    data: rows,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
  });

  const colCount = table.getVisibleLeafColumns().length;

  // ── Pagination helpers ───────────────────────────────────────────────
  const pageNumbers = useMemo(() => {
    const pages: (number | "...")[] = [];
    const delta = 2;
    const left = Math.max(2, page - delta);
    const right = Math.min(totalPages - 1, page + delta);

    pages.push(1);
    if (left > 2) pages.push("...");
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push("...");
    if (totalPages > 1) pages.push(totalPages);

    return pages;
  }, [page, totalPages]);

  // ── No task selected ─────────────────────────────────────────────────
  if (selectedTaskId === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">请在左侧选择一个任务</p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="shrink-0 h-10 px-4 flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" disabled={status !== "success"}>
              <Download className="size-3.5" />
              导出
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-sm cursor-pointer"
              onClick={() => handleExport("csv", "current_page")}
            >
              CSV（当前页）
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-sm cursor-pointer"
              onClick={() => handleExport("csv", "all")}
            >
              CSV（全部）
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-sm cursor-pointer"
              onClick={() => handleExport("xlsx", "current_page")}
            >
              XLSX（当前页）
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-sm cursor-pointer"
              onClick={() => handleExport("xlsx", "all")}
            >
              XLSX（全部）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Loading: skeleton */}
        {status === "loading" && (
          <div className="flex-1 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.id ?? (col as { accessorKey?: string }).accessorKey}
                      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                      style={{ width: col.size, minWidth: col.minSize }}
                    >
                      {typeof col.header === "string" ? col.header : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td
                        key={col.id ?? (col as { accessorKey?: string }).accessorKey}
                        className="px-3 py-2"
                      >
                        <Skeleton className="h-4 w-[80%] rounded" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <TriangleAlert className="size-5 text-destructive" />
              <p className="text-sm text-muted-foreground">
                加载失败：{errorMessage}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadData(selectedTaskId, page)}
              >
                重试
              </Button>
            </div>
          </div>
        )}

        {/* Empty */}
        {status === "empty" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileSearch className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                暂无提取数据，运行抓取+提取后将在此处展示
              </p>
            </div>
          </div>
        )}

        {/* Data table */}
        {status === "success" && (
          <>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-3 py-2 text-left text-xs font-medium text-muted-foreground
                                     border-b border-border"
                          style={{ width: header.getSize(), minWidth: header.getSize() }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => {
                    const isNew = newRowIds.has(row.original.id);
                    const isDeleting = deletingIds.has(row.original.id);
                    const isExpanded = row.getIsExpanded();
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={cn(
                            "group border-b border-border hover:bg-muted/50 transition-colors",
                            isNew && "bg-info/50",
                            isDeleting && "animate-out fade-out-0 duration-100",
                          )}
                          onAnimationEnd={
                            isDeleting
                              ? handleDeleteAnimationEnd(row.original.id)
                              : undefined
                          }
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td
                              key={cell.id}
                              className={cn(
                                "px-3 py-1.5 text-[13px] leading-5",
                                cell.column.id === "actions" &&
                                  "sticky right-0 bg-background group-hover:bg-muted/50 z-10",
                                isNew && cell.column.id === "actions" &&
                                  "bg-info/50",
                              )}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                        {isExpanded && (() => {
                          const parsed = parseResultJson(row.original.resultJson);
                          return (
                            <tr>
                              <td
                                colSpan={colCount}
                                className="border-b border-border bg-muted/30"
                              >
                                <div className="grid grid-cols-2 gap-6 p-4">
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">源数据</p>
                                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-foreground
                                                    leading-relaxed">
                                      {row.original.rawText}
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-2">结构化结果</p>
                                    {parsed === null ? (
                                      <p className="text-sm text-muted-foreground/50">—</p>
                                    ) : Array.isArray(parsed) ? (
                                      <div className="space-y-3">
                                        {parsed.map((item, i) => (
                                          <div
                                            key={i}
                                            className="bg-card border border-border rounded-lg shadow-sm p-3"
                                          >
                                            <p className="text-xs font-medium text-muted-foreground mb-2">
                                              第 {i + 1} 项
                                            </p>
                                            {typeof item === "object" && !Array.isArray(item) && item !== null ? (
                                              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                                                {Object.entries(item as Record<string, unknown>).map(
                                                  ([key, value]) => (
                                                    <div key={key} className="contents">
                                                      <dt className="text-xs font-medium text-muted-foreground self-start pt-0.5">
                                                        {key}
                                                      </dt>
                                                      <dd className="text-sm text-foreground break-all">
                                                        {renderFieldValue(value)}
                                                      </dd>
                                                    </div>
                                                  ),
                                                )}
                                              </dl>
                                            ) : (
                                              <p className="text-sm text-muted-foreground/50">—</p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground/50">—</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ──────────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="shrink-0 flex items-center justify-center gap-1 py-3 border-t border-border">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>

                {pageNumbers.map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">
                      ...
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={page === p ? "default" : "ghost"}
                      size="icon-sm"
                      className={cn(
                        "size-7 text-xs",
                        page === p && "bg-primary text-primary-foreground",
                      )}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ),
                )}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
