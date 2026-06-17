import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import Header from "@/components/Header";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";


type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "orbitx_theme";

function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export default function RootLayout() {
  useEffect(() => {
    const stored = getStoredTheme();
    applyTheme(resolveTheme(stored));

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (getStoredTheme() === "system") {
        applyTheme(
          mq.matches ? "dark" : "light",
        );
      }
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <ErrorBoundary>
        <main className="flex-1 min-h-0">
          <Outlet />
        </main>
      </ErrorBoundary>
      <Toaster />
    </div>
  );
}
