import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Cloud, Database, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { readOfflineConfidenceSnapshot, type OfflineConfidenceSnapshot } from "@/features/core/sync/offline-confidence";

function formatAgo(value: string | null) {
  if (!value) return "No cloud backup yet";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Backup time unavailable";
  return formatDistanceToNow(new Date(time), { addSuffix: true });
}

function formatGrace(value: string | null) {
  if (!value) return "No grace date cached";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Grace date unavailable";
  return time > Date.now() ? `${formatDistanceToNow(new Date(time))} left` : "Grace expired";
}

function formatStorage(snapshot: OfflineConfidenceSnapshot | null) {
  if (!snapshot || snapshot.storageUsageRatio === null) return "Storage estimate unavailable";
  return `${Math.round(snapshot.storageUsageRatio * 100)}% used`;
}
export function OfflineConfidenceMeter({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<OfflineConfidenceSnapshot | null>(null);

  useEffect(() => {
    const refresh = () => void readOfflineConfidenceSnapshot().then(setSnapshot);
    refresh();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, []);

  const dbHealthy = snapshot?.dbHealthy ?? true;
  const hasWarning = Boolean(snapshot?.warning);
  const offlineReady = snapshot?.readinessState === "ready";

  return (
    <Card className={hasWarning ? "border-amber-300 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50"}>
      <CardHeader className={compact ? "p-4 pb-2" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {dbHealthy ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
            Offline confidence meter
          </CardTitle>
          <Badge variant={offlineReady ? "secondary" : dbHealthy ? "outline" : "destructive"}>{offlineReady ? "Ready for offline billing" : dbHealthy ? "Offline setup needed" : "Check recovery"}</Badge>
        </div>
      </CardHeader>
      <CardContent className={compact ? "p-4 pt-0" : "space-y-4"}>
        <p className="text-sm text-muted-foreground">{snapshot?.message ?? "Checking local data safety…"}</p>
        {snapshot?.warning && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-100/70 p-2 text-sm font-medium text-amber-900">{snapshot.warning}</p>}
        <div className={`mt-3 grid gap-3 ${compact ? "grid-cols-2" : "sm:grid-cols-4"}`}>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Cloud className="h-3.5 w-3.5" /> Pending backup</div>
            <div className="mt-1 text-xl font-black">{snapshot?.pendingSyncCount ?? 0}</div>
          </div>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> Failed/conflict</div>
            <div className="mt-1 text-xl font-black">{(snapshot?.failedSyncCount ?? 0) + (snapshot?.conflictCount ?? 0)}</div>
          </div>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Last cloud backup</div>
            <div className="mt-1 text-sm font-semibold">{formatAgo(snapshot?.lastCloudBackupAt ?? null)}</div>
          </div>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-3.5 w-3.5" /> Offline grace</div>
            <div className="mt-1 text-sm font-semibold">{formatGrace(snapshot?.offlineGraceUntil ?? null)}</div>
          </div>          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-3.5 w-3.5" /> App restart</div>
            <div className="mt-1 text-sm font-semibold">{snapshot?.appShellCached ? "Cached for offline" : "Cache not verified"}</div>
          </div>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Device storage</div>
            <div className="mt-1 text-sm font-semibold">{snapshot?.persistentStorageGranted ? "Protected" : "May be cleaned"}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{formatStorage(snapshot)}</div>
          </div>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/sync-status"><Button variant="outline" size="sm">Open sync status</Button></Link>
            <Link href="/recovery-mode"><Button variant="outline" size="sm">Open recovery mode</Button></Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
