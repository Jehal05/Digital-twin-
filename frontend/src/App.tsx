import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { DashboardProvider } from "./auth/DataContext";
import { AppShell } from "./components/layout/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProfilePage } from "./pages/ProfilePage";

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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DashboardProvider>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><Gate /></AuthProvider></BrowserRouter>;
}
