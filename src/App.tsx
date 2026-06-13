import { HashRouter, Routes, Route } from "react-router-dom";
import { AgentProvider } from "@/agent";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { NavigationGuardProvider } from "@/lib/navigation-guard";
import RootLayout from "./routes/__root";
import Dashboard from "./routes/dashboard";
import StructuredExtractor from "./routes/tools/structured-extractor";
import Settings from "./routes/settings";
import Overlay from "./routes/overlay";

function MainApp() {
  return (
    <AgentProvider>
      <ConfirmProvider>
        <NavigationGuardProvider>
          <Routes>
            <Route element={<RootLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="/tools/extractor" element={<StructuredExtractor />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </NavigationGuardProvider>
      </ConfirmProvider>
    </AgentProvider>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* overlay 独立渲染，不挂载 AgentProvider 等含网络能力的 Provider */}
        <Route path="/overlay" element={<Overlay />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </HashRouter>
  );
}
