import { HashRouter, Routes, Route } from "react-router-dom";
import { AgentProvider } from "@/agent";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { NavigationGuardProvider } from "@/lib/navigation-guard";
import RootLayout from "./routes/__root";
import Dashboard from "./routes/dashboard";
import StructuredExtractor from "./routes/tools/structured-extractor";
import Settings from "./routes/settings";

export default function App() {
  return (
    <AgentProvider>
      <ConfirmProvider>
        <NavigationGuardProvider>
          <HashRouter>
          <Routes>
            <Route element={<RootLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="/tools/extractor" element={<StructuredExtractor />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </HashRouter>
        </NavigationGuardProvider>
      </ConfirmProvider>
    </AgentProvider>
  );
}
