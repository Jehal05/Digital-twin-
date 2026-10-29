import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { DashboardProvider } from "./auth/DataContext";
import { AppShell } from "./components/layout/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ReliabilityPage } from "./pages/ReliabilityPage";
import { ReportPage } from "./pages/ReportPage";
import { RiskDetailPage } from "./pages/RiskDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharedPage } from "./pages/SharedPage";
import { SimulatorPage } from "./pages/SimulatorPage";
import { TrendsPage } from "./pages/TrendsPage";

function Gate() {
  const { status } = useAuth();
  if (status === "loading") return <p role="status" className="p-8 text-center text-muted">Loading…</p>;
  if (status === "anonymous") return <AuthPage />;
  return (
    <DashboardProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="risk/:condition" element={<RiskDetailPage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="trends" element={<TrendsPage />} />
          <Route path="reliability" element={<ReliabilityPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DashboardProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/shared/:token" element={<SharedPage />} />
        <Route path="*" element={<AuthProvider><Gate /></AuthProvider>} />
      </Routes>
    </BrowserRouter>
  );
}
