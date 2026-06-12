import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "@/components/ui/card";
import { log } from "@/lib/logger";

export default function Dashboard() {
  const [ipcStatus, setIpcStatus] = useState<string>("检查中...");
  const [ipcOk, setIpcOk] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<string>("check_ipc_status")
      .then((status) => {
        setIpcStatus(status);
        setIpcOk(status === "ok");
        log("info", "dashboard", `IPC 状态检查: ${status}`);
      })
      .catch((err) => {
        setIpcStatus(`IPC 错误: ${err}`);
        setIpcOk(false);
        log("error", "dashboard", `IPC 状态检查失败: ${err}`);
      });
  }, []);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-6">
      <Link to="/tools/extractor">
        <Card className="cursor-pointer p-6 transition-colors hover:bg-muted">
          <h2 className="text-base font-medium text-brand-dark">
            结构化提取器
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            从任意应用中提取结构化数据
          </p>
        </Card>
      </Link>

      <Link to="/settings">
        <Card className="cursor-pointer p-6 transition-colors hover:bg-muted">
          <h2 className="text-base font-medium text-brand-dark">
            全局设置
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理应用配置与偏好
          </p>
        </Card>
      </Link>

      {/* IPC 状态指示器 */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2 rounded-full ${
              ipcOk === null
                ? "bg-yellow-400"
                : ipcOk
                  ? "bg-green-500"
                  : "bg-red-500"
            }`}
          />
          <span className="text-sm text-muted-foreground">
            IPC: {ipcStatus}
          </span>
        </div>
      </Card>
    </div>
  );
}
