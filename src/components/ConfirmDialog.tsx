import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setPending({ ...opts, resolve });
      });
    },
    [],
  );

  const handleClose = useCallback((value: boolean) => {
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
    setPending(null);
  }, []);

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 遮罩层 */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => handleClose(false)}
          />
          {/* 对话框 */}
          <div className="relative z-10 w-80 rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">
              {pending.title}
            </h3>
            {pending.description && (
              <p className="mt-2 text-sm text-slate-500">
                {pending.description}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8"
                onClick={() => handleClose(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                className={cn(
                  "h-8",
                  pending.variant === "danger" && "bg-red-600 hover:bg-red-700",
                )}
                onClick={() => handleClose(true)}
              >
                {pending.confirmLabel ?? "确定"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
