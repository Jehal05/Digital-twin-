import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Report } from "../api/types";
import { Logo } from "../components/layout/Logo";
import { ReportView } from "../components/report/ReportView";
import { Skeleton } from "../components/ui/States";

/** Public page: no sign-in, no tokens attached, nothing editable. */
export function SharedPage() {
  const { token = "" } = useParams();
  const [r, setR] = useState<Report | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/v1/shared/${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject())).then(setR).catch(() => setGone(true));
  }, [token]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="glass no-print flex items-center gap-2.5 px-5 py-3"><Logo /><span className="text-lg font-bold">HealthTwin</span><span className="ml-auto text-xs text-muted">Shared read-only summary</span></div>
      {gone ? <div className="glass p-6 text-center" role="alert"><p className="font-semibold">This link is not available.</p><p className="mt-1 text-sm text-muted">It may have expired or been revoked by the person who shared it.</p></div>
        : r ? <ReportView r={r} /> : <Skeleton className="h-64" />}
    </main>
  );
}
