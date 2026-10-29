import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { DashboardProvider } from "./auth/DataContext";
import { AppShell } from "./components/layout/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ReliabilityPage } from "./pages/ReliabilityPage";
import { RiskDetailPage } from "./pages/RiskDetailPage";
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DashboardProvider>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><Gate /></AuthProvider></BrowserRouter>;
}
