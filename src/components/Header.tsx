import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/tools/extractor": "结构化提取器",
  "/settings": "设置",
};

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname === "/";
  const pageTitle = pageTitles[location.pathname] || "";

  return (
    <header className="header flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
      {!isRoot && (
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => navigate(-1)}
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </button>
      )}
      <span className="text-sm font-medium text-brand-dark">
        {isRoot ? "ORBITX" : pageTitle}
      </span>
    </header>
  );
}
