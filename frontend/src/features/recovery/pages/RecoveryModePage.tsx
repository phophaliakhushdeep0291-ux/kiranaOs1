import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileClock,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { offlineDB, dexieDB, type PendingSyncEvent } from "@/lib/offline/db";
import {
  runLocalDbHealthCheck,
  type LocalDbHealthReport,
} from "@/features/recovery/health";
import { retryFailedSyncOperations, runSyncCycle } from "@/features/sync";
import { FeatureGate, UpgradePrompt } from "@/features/subscription";
import { OfflineConfidenceMeter } from "@/features/innovation/components/OfflineConfidenceMeter";

const BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";

type DbState = "checking" | "healthy" | "problem";

interface RecoverySnapshot {
  dbState: DbState;
  draftExists: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  healthReport: LocalDbHealthReport | null;
}

const initialSnapshot: RecoverySnapshot = {
  dbState: "checking",
  draftExists: false,
  pendingSyncCount: 0,
  failedSyncCount: 0,
  healthReport: null,
};

function isMeaningfulDraft(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as { cart?: unknown[] };
  return Array.isArray(draft.cart) && draft.cart.length > 0;
}

async function readRecoverySnapshot(): Promise<RecoverySnapshot> {
  try {
    await dexieDB.open();
    const [draft, outbox, healthReport] = await Promise.all([
      offlineDB.getSetting<unknown>(BILLING_DRAFT_KEY).catch(() => null),
      offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
      runLocalDbHealthCheck().catch(() => null),
    ]);
    return {
      dbState: healthReport?.status === "problem" ? "problem" : "healthy",
      draftExists: isMeaningfulDraft(draft),
      pendingSyncCount: outbox.filter(
        (row) =>
          row.status === "PENDING" ||
          row.status === "SYNCING" ||
          row.sync_status === "pending_sync" ||
          row.sync_status === "syncing",
      ).length,
      failedSyncCount: outbox.filter(
        (row) => row.status === "FAILED" || row.sync_status === "failed",
      ).length,
      healthReport,
    };
  } catch {
    return { ...initialSnapshot, dbState: "problem", healthReport: null };
  }
}

function RecoveryActionCard({
  title,
  description,
  icon: Icon,
  children,
  status,
}: {
  title: string;
  description: string;
  icon: typeof RotateCcw;
  children: React.ReactNode;
  status?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          {status && <Badge variant="outline">{status}</Badge>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function RecoveryModePage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<RecoverySnapshot>(initialSnapshot);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void readRecoverySnapshot().then(setSnapshot);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [refresh]);

  const recoverSync = async () => {
    setBusy(true);
    try {
      await retryFailedSyncOperations();
      await runSyncCycle();
      toast({
        title: "Recovery sync started",
        description:
          "Pending/failed changes will retry safely using the same idempotency keys.",
      });
      refresh();
    } catch (error) {
      toast({
        title: "Recovery sync failed",
        description:
          error instanceof Error ? error.message : "Could not retry sync now.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeatureGate
      featureName="recovery_mode"
      fallback={
        <div className="w-full max-w-none p-6">
          <UpgradePrompt
            featureName="recovery_mode"
            description="Recovery mode is available on Standard and above. Old data remains viewable."
          />
        </div>
      }
    >
      <div className="w-full max-w-none space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Recovery mode</h1>
          <p className="mt-2 text-muted-foreground">
            Safe tools for unsaved bills, local database health, pending sync
            recovery, and encrypted portable backups. Nothing here hard-deletes financial data.
          </p>
        </div>

        {snapshot.dbState === "problem" ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Local database problem detected</AlertTitle>
            <AlertDescription>
              Do not clear browser data. Export/repair tooling should be used
              before continuing billing.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Data viewing is always allowed</AlertTitle>
            <AlertDescription>
              Recovery tools guide safe restoration. Billing drafts and sync
              operations stay local-first and retryable.
            </AlertDescription>
          </Alert>
        )}

        <OfflineConfidenceMeter />

        <div className="grid gap-4 md:grid-cols-2">
          <RecoveryActionCard
            title="Restore last unsaved bill"
            description="Billing draft auto-save is checked locally."
            icon={FileClock}
            status={snapshot.draftExists ? "Draft found" : "No draft"}
          >
            <p className="mb-3 text-sm text-muted-foreground">
              {snapshot.draftExists
                ? "A saved bill draft exists. Open Billing to restore it before making a new bill."
                : "No unsaved bill draft is currently stored on this device."}
            </p>
            <Link href="/billing">
              <Button disabled={!snapshot.draftExists}>
                Open billing draft
              </Button>
            </Link>
          </RecoveryActionCard>

          <RecoveryActionCard
            title="Recover pending sync operations"
            description="Retry failed cloud sync without duplicating bills or payments."
            icon={RefreshCcw}
            status={`${snapshot.pendingSyncCount + snapshot.failedSyncCount} operations`}
          >
            <p className="mb-3 text-sm text-muted-foreground">
              Uses the existing outbox and idempotency keys. Failed operations
              are retried; unsynced local records are preserved.
            </p>
            <Button
              onClick={recoverSync}
              disabled={
                busy ||
                snapshot.pendingSyncCount + snapshot.failedSyncCount === 0
              }
            >
              {busy ? "Retrying…" : "Retry pending sync"}
            </Button>
          </RecoveryActionCard>

          <RecoveryActionCard
            title="Encrypted portable backups"
            description="Create and download server-backed, encrypted shop snapshots."
            icon={Database}
            status="Server-backed"
          >
            <p className="mb-3 text-sm text-muted-foreground">
              View real backup history, create a transactionally consistent
              encrypted artifact, and download it with owner approval. Restore
              drills remain an operator-run production procedure.
            </p>
            <Link href="/settings/sync"><Button variant="outline">Open backup history</Button></Link>
          </RecoveryActionCard>

          <RecoveryActionCard
            title="Local DB health check"
            description="Dexie open/read checks for corruption detection."
            icon={CheckCircle2}
            status={snapshot.healthReport?.status ?? snapshot.dbState}
          >
            <p className="mb-3 text-sm text-muted-foreground">
              Checks browser IndexedDB support, core table reads, billing draft
              availability and pending sync count. It does not delete or
              mutate financial data.
            </p>
            {snapshot.healthReport?.checks && (
              <div className="mb-3 max-h-48 space-y-2 overflow-auto rounded-xl border bg-muted/30 p-2">
                {snapshot.healthReport.checks.map((check) => (
                  <details
                    key={check.name}
                    className="rounded-lg bg-background px-3 py-2 text-xs"
                  >
                    <summary className="cursor-pointer font-semibold">
                      {check.status === "healthy"
                        ? "✅"
                        : check.status === "warning"
                          ? "⚠️"
                          : "🚨"}{" "}
                      {check.name}
                    </summary>
                    <p className="mt-1 text-muted-foreground">
                      {check.message}
                    </p>
                    {check.detail && (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">
                        {check.detail}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            )}
            <Button variant="outline" onClick={refresh}>
              Run check again
            </Button>
          </RecoveryActionCard>
        </div>
      </div>
    </FeatureGate>
  );
}
