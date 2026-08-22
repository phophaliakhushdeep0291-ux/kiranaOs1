import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { offlineDB, type OfflineRow, type PendingSyncEvent } from "@/lib/offline/db";
import { runManualSyncCycle } from "@/features/core/sync/manual-sync";

interface Counts { pending: number; failedOrConflict: number }

/**
 * Persistent top-of-app warning whenever any local change hasn't reached the cloud yet.
 * A silent "pending" bill is worse than visible "syncing" — the shopkeeper needs to know
 * the bill isn't backed up. Shows pending and failed/conflict counts separately so the
 * user understands the difference (will-retry vs needs-attention) and can Retry inline.
 */
export function SyncAlertBanner() {
  const { toast } = useToast();
  const [counts, setCounts] = useState<Counts>({ pending: 0, failedOrConflict: 0 });
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await offlineDB.getAll<PendingSyncEvent & OfflineRow>("sync_outbox");
      const pending = rows.filter((r) => r.status === "PENDING" || r.status === "SYNCING").length;
      const failedOrConflict = rows.filter((r) => r.status === "FAILED" || r.status === "CONFLICT").length;
      setCounts({ pending, failedOrConflict });
    } catch {
      setCounts({ pending: 0, failedOrConflict: 0 });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener("kirana:sync-queue-updated", onUpdate);
    window.addEventListener("kirana:local-data-changed", onUpdate);
    const interval = window.setInterval(refresh, 8_000);
    return () => {
      window.removeEventListener("kirana:sync-queue-updated", onUpdate);
      window.removeEventListener("kirana:local-data-changed", onUpdate);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const total = counts.pending + counts.failedOrConflict;
  if (total === 0) return null;

  const isFailing = counts.failedOrConflict > 0;
  const headline = isFailing
    ? `${counts.failedOrConflict} change${counts.failedOrConflict === 1 ? "" : "s"} needs review`
    : `${counts.pending} change${counts.pending === 1 ? "" : "s"} waiting to back up`;
  const sub = isFailing
    ? "Your data is safe on this device. Retry, or open Sync Status to review."
    : "Will retry automatically when the connection is healthy.";

  const onRetry = async () => {
    setRetrying(true);
    try {
      await runManualSyncCycle();
      await refresh();
    } catch {
      toast({ title: "Retry failed", description: "Please check your connection and try again.", variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  const tone = isFailing
    ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";

  return (
    <div className={`flex items-center gap-3 border-b px-3 py-2 ${tone}`}>
      <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight">{headline}</div>
        <div className="text-[11px] leading-tight opacity-80">{sub}</div>
      </div>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={retrying}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3 text-[12px] font-bold disabled:opacity-50 dark:bg-black/20"
      >
        <RefreshCw size={13} className={retrying ? "animate-spin" : ""} aria-hidden="true" />
        {retrying ? "Retrying…" : "Retry now"}
      </button>
      <Link href="/sync-status" className="inline-flex h-11 shrink-0 items-center rounded-lg px-2 text-[12px] font-bold underline-offset-2 hover:underline">View</Link>
    </div>
  );
}
