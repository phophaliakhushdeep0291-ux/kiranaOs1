import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileClock,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/features/core/recovery/health";
import { retryFailedSyncOperations, runSyncCycle } from "@/features/core/sync";
import { OfflineConfidenceMeter } from "@/features/core/innovation/components/OfflineConfidenceMeter";
import {
  createEncryptedLocalBackup,
  LOCAL_BACKUP_CONFIRMATION,
  previewEncryptedLocalBackup,
  restoreEncryptedLocalBackup,
  saveEncryptedLocalBackup,
  type LocalBackupPreview,
} from "@/features/core/recovery/local-backup";

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
      dbState: !healthReport || healthReport.status === "problem" ? "problem" : "healthy",
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
  const [backupBusy, setBackupBusy] = useState<"export" | "preview" | "restore" | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<LocalBackupPreview | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);

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

  const exportLocalBackup = async () => {
    setBackupBusy("export");
    try {
      const backup = await createEncryptedLocalBackup(exportPassphrase);
      saveEncryptedLocalBackup(backup.blob, backup.createdAt);
      toast({
        title: "Encrypted local backup saved",
        description: `${backup.rowCount.toLocaleString("en-IN")} local rows, including the pending sync queue, were exported. Keep the passphrase separately.`,
      });
    } catch (error) {
      toast({ title: "Local backup failed", description: error instanceof Error ? error.message : "Could not create the local backup.", variant: "destructive" });
    } finally {
      setBackupBusy(null);
    }
  };

  const inspectLocalBackup = async () => {
    if (!restoreFile) return;
    setBackupBusy("preview");
    setRestorePreview(null);
    try {
      setRestorePreview(await previewEncryptedLocalBackup(restoreFile, restorePassphrase));
    } catch (error) {
      toast({ title: "Backup preview failed", description: error instanceof Error ? error.message : "Could not read the local backup.", variant: "destructive" });
    } finally {
      setBackupBusy(null);
    }
  };

  const restoreLocalBackup = async () => {
    if (!restoreFile || !restorePreview) return;
    setBackupBusy("restore");
    try {
      const result = await restoreEncryptedLocalBackup(restoreFile, restorePassphrase, {
        confirmation: restoreConfirmation,
        replaceExisting,
      });
      toast({
        title: "Local backup restored",
        description: `${result.restoredRows.toLocaleString("en-IN")} rows restored atomically. Reloading the app now.`,
      });
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast({ title: "Local restore stopped safely", description: error instanceof Error ? error.message : "Could not restore the local backup.", variant: "destructive" });
      setBackupBusy(null);
    }
  };

  return (
    <div className="w-full max-w-none space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Recovery mode</h1>
          <p className="mt-2 text-muted-foreground">
            Safe tools for unsaved bills, local database health, pending sync
            recovery, and encrypted portable backups. A restore only replaces
            local rows after a decrypted preview and explicit confirmation.
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
            title="Encrypted local emergency backup"
            description="Export or restore this shop's IndexedDB and pending sync queue without internet."
            icon={Database}
            status="Works offline"
          >
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/30 p-3">
                <Label htmlFor="local-backup-passphrase">New backup passphrase</Label>
                <Input
                  id="local-backup-passphrase"
                  className="mt-1"
                  type="password"
                  autoComplete="new-password"
                  value={exportPassphrase}
                  onChange={(event) => setExportPassphrase(event.target.value)}
                  placeholder="At least 10 characters"
                />
                <p className="mt-1 text-xs text-muted-foreground">The passphrase is never stored or sent anywhere. Without it, the file cannot be opened.</p>
                <Button className="mt-3" onClick={() => void exportLocalBackup()} disabled={backupBusy !== null}>
                  <Download className="h-4 w-4" /> {backupBusy === "export" ? "Encrypting…" : "Export local backup"}
                </Button>
              </div>

              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                <div>
                  <Label htmlFor="local-backup-file">Restore a .kalb file</Label>
                  <Input
                    id="local-backup-file"
                    className="mt-1"
                    type="file"
                    accept=".kalb,application/vnd.artha.local-backup+json"
                    onChange={(event) => {
                      setRestoreFile(event.target.files?.[0] ?? null);
                      setRestorePreview(null);
                      setRestoreConfirmation("");
                      setReplaceExisting(false);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="local-restore-passphrase">Backup passphrase</Label>
                  <Input id="local-restore-passphrase" className="mt-1" type="password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} />
                </div>
                <Button variant="outline" onClick={() => void inspectLocalBackup()} disabled={!restoreFile || backupBusy !== null}>
                  {backupBusy === "preview" ? "Checking…" : "Decrypt and preview"}
                </Button>

                {restorePreview && (
                  <div className="space-y-3 rounded-lg border bg-background p-3 text-xs">
                    <p className="font-bold">Created {new Date(restorePreview.createdAt).toLocaleString("en-IN")}</p>
                    <p>{restorePreview.totalRows.toLocaleString("en-IN")} rows across {Object.keys(restorePreview.tableCounts).length} tables · {restorePreview.pendingSyncCount.toLocaleString("en-IN")} pending/failed sync operations.</p>
                    {restorePreview.requiresReplace && <p className="font-semibold text-amber-800 dark:text-amber-200">This device already has {restorePreview.existingLocalRows.toLocaleString("en-IN")} local rows. Replacement is atomic, but current local rows will be replaced by this reviewed file.</p>}
                    {restorePreview.requiresReplace && (
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
                        <input type="checkbox" className="h-5 w-5" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
                        <span>I reviewed the preview and want to replace this shop's current local rows.</span>
                      </label>
                    )}
                    <div>
                      <Label htmlFor="local-restore-confirmation">Type {LOCAL_BACKUP_CONFIRMATION}</Label>
                      <Input id="local-restore-confirmation" className="mt-1 font-mono" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} />
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => void restoreLocalBackup()}
                      disabled={backupBusy !== null || (restorePreview.requiresReplace && !replaceExisting) || restoreConfirmation.trim().toUpperCase() !== LOCAL_BACKUP_CONFIRMATION}
                    >
                      {backupBusy === "restore" ? "Restoring atomically…" : "Restore reviewed local backup"}
                    </Button>
                  </div>
                )}
              </div>

              <Link href="/settings/sync"><Button variant="outline">Cloud backup history (internet required)</Button></Link>
            </div>
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
  );
}
