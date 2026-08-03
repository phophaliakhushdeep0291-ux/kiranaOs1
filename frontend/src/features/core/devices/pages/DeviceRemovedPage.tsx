import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Download, HardDrive, LogIn, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offlineDB } from "@/lib/offline/db";

export default function DeviceRemovedPage() {
  const [, setLocation] = useLocation();
  const [pendingCount, setPendingCount] = useState(() => {
    try { return Number(window.sessionStorage.getItem("kirana:revoked-device-pending-count") || 0); } catch { return 0; }
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void offlineDB.getPendingCount().then(setPendingCount).catch(() => undefined);
  }, []);

  async function exportPendingData() {
    setExporting(true);
    try {
      const records = await offlineDB.getPendingEvents();
      const payload = JSON.stringify({
        type: "kiranaos_revoked_device_recovery",
        exportedAt: new Date().toISOString(),
        recordCount: records.length,
        records,
      }, null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `artha-unsynced-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-4 py-8">
      <section className="w-full max-w-xl rounded-lg border border-[#e1e8f2] bg-white p-5 shadow-[0_18px_50px_rgba(15,35,71,0.10)] sm:p-8">
        <div className="grid h-14 w-14 place-items-center rounded-lg bg-rose-50 text-rose-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-[var(--brand-ink)]">This device was removed from the shop</h1>
        <p className="mt-2 text-sm leading-6 text-[#60708e]">
          Cloud access and synchronization have stopped. Local business records remain on this device and have not been deleted.
        </p>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-bold text-amber-950">{pendingCount} unsynced record{pendingCount === 1 ? "" : "s"} preserved</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">An owner can re-register this device when a slot is available. Export the recovery file before clearing browser data.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button variant="outline" onClick={() => void exportPendingData()} disabled={exporting || pendingCount === 0}>
            <Download className="mr-2 h-4 w-4" />{exporting ? "Preparing..." : "Export unsynced data"}
          </Button>
          <Button onClick={() => setLocation("/login")}>
            <LogIn className="mr-2 h-4 w-4" />Sign in with owner approval
          </Button>
        </div>
      </section>
    </main>
  );
}
