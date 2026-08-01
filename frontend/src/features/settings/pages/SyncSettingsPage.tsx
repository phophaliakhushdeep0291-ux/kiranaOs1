import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { Archive, CheckCircle2, Clock, Cloud, CloudOff, Database, Loader2, RefreshCcw, Upload } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Badge, Kpi } from "@/features/settings/ui";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { ApiClientError } from "@/lib/api/http";
import {
  createShopBackup,
  downloadShopBackup,
  listShopBackups,
  previewShopBackupRestore,
  restoreShopBackup,
  saveBackupBlob,
  type BackupArtifact,
  type BackupRestorePreview,
} from "@/features/backups";
import { resetDeviceAfterCloudRestore } from "@/features/backups/restore-local-reset";
function timeAgo(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function backupTime(value: string | null) {
  if (!value) return "Not completed";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function backupTone(status: BackupArtifact["status"]): "green" | "amber" | "red" | "gray" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "queued" || status === "processing") return "amber";
  return "gray";
}

export default function SyncSettingsPage() {
  const { toast } = useToast();
  const { isOnline, isBrowserOnline, backendStatus, isSyncing, pendingCount, failedCount, conflictCount, syncNow } = useOfflineStatus();
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [backups, setBackups] = useState<BackupArtifact[]>([]);
  const [backupHistoryLoading, setBackupHistoryLoading] = useState(true);
  const [backupAccessDenied, setBackupAccessDenied] = useState(false);
  const [backupApproval, setBackupApproval] = useState<{ type: "create" | "download" | "restore-preview" | "restore"; artifact?: BackupArtifact } | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupRestorePreview | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [backupActionLoading, setBackupActionLoading] = useState(false);
  const [backupActionError, setBackupActionError] = useState<string | null>(null);
  const wasSyncing = useRef(false);

  useEffect(() => { if (wasSyncing.current && !isSyncing) setLastSynced(new Date()); wasSyncing.current = isSyncing; }, [isSyncing]);

  const loadBackups = useCallback(async (background = false) => {
    if (!isOnline) {
      setBackupHistoryLoading(false);
      return;
    }
    try {
      const result = await listShopBackups({ background });
      setBackups(result.backups);
      setBackupAccessDenied(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 403) setBackupAccessDenied(true);
    } finally {
      setBackupHistoryLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    void loadBackups();
    if (!isOnline || backupAccessDenied) return;
    const interval = window.setInterval(() => void loadBackups(true), 30_000);
    return () => window.clearInterval(interval);
  }, [backupAccessDenied, isOnline, loadBackups]);

  async function confirmBackupAction({ ownerPin }: { ownerPin: string }) {
    if (!backupApproval) return;
    setBackupActionLoading(true);
    setBackupActionError(null);
    try {
      if (backupApproval.type === "create") {
        const result = await createShopBackup(ownerPin);
        setBackups((current) => [result.backup, ...current.filter((row) => row.id !== result.backup.id)]);
        toast({ title: result.backup.status === "completed" ? "Backup ready" : "Backup queued" });
      } else if (backupApproval.type === "download" && backupApproval.artifact) {
        const blob = await downloadShopBackup(backupApproval.artifact.id, ownerPin);
        saveBackupBlob(blob, backupApproval.artifact);
        toast({ title: "Backup downloaded" });
      } else if (backupApproval.type === "restore-preview" && backupApproval.artifact) {
        const result = await previewShopBackupRestore(backupApproval.artifact.id, ownerPin);
        setRestorePreview(result.preview);
        toast({ title: "Backup verified" });
      } else if (backupApproval.type === "restore" && backupApproval.artifact) {
        await restoreShopBackup(backupApproval.artifact.id, restoreConfirmation, ownerPin);
        await resetDeviceAfterCloudRestore();
        window.location.assign("/login?restored=1");
        return;
      }
      setBackupApproval(null);
      await loadBackups();
    } catch (error) {
      setBackupActionError(error instanceof Error ? error.message : "Backup action failed");
    } finally {
      setBackupActionLoading(false);
    }
  }
  const hasPending = pendingCount > 0;
  const hasFailed = failedCount > 0;
  const hasConflict = conflictCount > 0;
  const allSynced = isOnline && !hasPending && !hasFailed && !hasConflict;
  const backupStatusLabel = isOnline
    ? (isSyncing ? "Syncing" : hasFailed || hasConflict ? "Review sync" : hasPending ? "Pending backup" : "Synced")
    : isBrowserOnline
      ? (backendStatus.checkedAt ? "Cloud paused" : "Checking")
      : "Offline";
  const backupStatusTone = allSynced ? "green" : hasFailed || hasConflict ? "red" : isBrowserOnline ? "amber" : "gray";

  function handleSync() {
    void syncNow({ manual: true });
    toast({ title: isOnline ? "Syncing now..." : isBrowserOnline ? "Cloud paused" : "You're offline" });
  }

  return (
    <SettingsShell>
      {/* Sync Health Overview */}
      <Card>
        <CardHead icon={isOnline ? <Cloud size={15} /> : <CloudOff size={15} />} title="Sync Health Overview" sub="Live status across your devices"
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-[8px] text-[12px] font-bold" onClick={handleSync} disabled={isSyncing}><RefreshCcw size={13} className={isSyncing ? "animate-spin" : ""} /> {isSyncing ? "Syncing…" : "Sync Now"}</Button>
              <Link href="/sync-status" className="inline-flex h-8 items-center rounded-[8px] border border-[#e2e8f0] px-3 text-[12px] font-bold text-[#344668] hover:bg-[#f1f4f8]">View logs</Link>
            </div>
          } />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Sync Status" value={backupStatusLabel} tone={backupStatusTone} icon={allSynced ? <CheckCircle2 size={15} /> : <Clock size={15} />} />
          <Kpi label="Last Synced" value={timeAgo(lastSynced)} sub={lastSynced ? "today" : "this session"} tone="blue" />
          <Kpi label="Pending Uploads" value={pendingCount} tone={pendingCount ? "amber" : "green"} icon={<Upload size={15} />} />
          <Kpi label="Failed" value={failedCount} tone={failedCount ? "red" : "green"} />
          <Kpi label="Conflicts" value={conflictCount} tone={conflictCount ? "red" : "green"} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sync Activity */}
        <Card>
          <CardHead icon={<RefreshCcw size={15} />} title="Sync Activity" sub="Recent sync events" />
          <div className="px-5 pb-4">
            {[
              { text: lastSynced ? "Changes synced successfully" : "Waiting for first sync in this session", ok: true, time: timeAgo(lastSynced) },
              { text: `${pendingCount} change${pendingCount === 1 ? "" : "s"} queued to upload`, ok: pendingCount === 0, time: "now" },
              { text: conflictCount ? `${conflictCount} conflict(s) need review` : "No conflicts to review", ok: conflictCount === 0, time: "now" },
              { text: failedCount ? `${failedCount} item(s) failed — will retry` : "No failures", ok: failedCount === 0, time: "now" },
            ].map((a, i, arr) => (
              <div key={i} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.ok ? "bg-emerald-500" : "bg-amber-500"}`} />
                <p className="flex-1 text-[12px] font-medium text-[#344668]">{a.text}</p>
                <span className="shrink-0 text-[11px] text-[#9aa6bb]">{a.time}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Pending Sync Queue */}
        <Card>
          <CardHead icon={<Upload size={15} />} title="Pending Sync Queue" sub="Changes waiting to reach the cloud" action={(pendingCount + failedCount) > 0 ? <button onClick={handleSync} className="text-[12px] font-bold text-[var(--brand)] hover:underline">Retry all</button> : undefined} />
          <div className="px-5 pb-5">
            {(pendingCount + failedCount + conflictCount) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={22} /></span>
                <p className="text-[13px] font-bold text-[var(--brand-ink)]">Everything is synced</p>
                <p className="text-[11px] text-[#64748b]">No changes are waiting to upload.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingCount > 0 && <QueueRow label={`${pendingCount} change(s) pending upload`} tone="amber" status="Pending" />}
                {failedCount > 0 && <QueueRow label={`${failedCount} change(s) failed`} tone="red" status="Failed" onRetry={handleSync} />}
                {conflictCount > 0 && <QueueRow label={`${conflictCount} conflict(s) need review`} tone="red" status="Conflict" />}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="backup-grid">
        {/* Encrypted portable backups */}
        <Card>
          <CardHead
            icon={<Archive size={15} />}
            title="Portable shop backup"
            sub="Encrypted recovery artifact"
            action={!backupAccessDenied ? (
              <Button
                size="sm"
                className="backup-create"
                disabled={!isOnline || backupActionLoading}
                onClick={() => { setBackupActionError(null); setBackupApproval({ type: "create" }); }}
              >
                {backupActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                Create snapshot
              </Button>
            ) : undefined}
          />
          <div className="backup-intro">
            {backupAccessDenied ? (
              <div className="backup-denied">
                Owner or admin access is required to view portable backups.
              </div>
            ) : (
              <p className="backup-description">AES-256-GCM · SHA-256 · Sensitive credentials excluded.</p>
            )}
          </div>
        </Card>

        {/* Backup History */}
        <Card>
          <CardHead icon={<Cloud size={15} />} title="Backup history" sub="Server-confirmed encrypted artifacts" action={!backupAccessDenied ? <button onClick={() => void loadBackups()} className="settings-text-action">Refresh</button> : undefined} />
          <div className="backup-history">
            {backupHistoryLoading ? (
              <div className="backup-loading"><Loader2 size={15} className="animate-spin" /> Loading backup history</div>
            ) : backupAccessDenied ? (
              <div className="backup-hidden">Backup history is hidden for cashier accounts.</div>
            ) : backups.length === 0 ? (
              <div className="backup-empty">
                <strong>No portable snapshot yet</strong>
                <p>Create one before major changes.</p>
              </div>
            ) : backups.slice(0, 8).map((artifact) => (
              <div key={artifact.id} className="backup-row">
                <div className="backup-row-body">
                  <div className="backup-row-head">
                    <strong>{backupTime(artifact.completed_at ?? artifact.created_at)}</strong>
                    <Badge tone={backupTone(artifact.status)}>{artifact.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="backup-row-meta">
                    {artifact.status === "failed"
                      ? artifact.error_message || "Backup failed"
                      : `${artifact.record_count?.toLocaleString("en-IN") ?? "—"} records`}
                  </p>
                </div>
                {artifact.status === "completed" && <div className="backup-row-actions">
                  <Button size="sm" variant="outline" onClick={() => { setBackupActionError(null); setBackupApproval({ type: "restore-preview", artifact }); }}>
                    Validate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setBackupActionError(null); setBackupApproval({ type: "download", artifact }); }}>
                    Download
                  </Button>
                </div>}
              </div>
            ))}
            {restorePreview && (
              <div className="restore-preview">
                <strong>Restore verified</strong>
                <p>
                  {restorePreview.record_count.toLocaleString("en-IN")} records verified; credentials preserved. A recovery snapshot is created first and every device must sign in again.
                </p>
                <div>
                  <b>Type <code>RESTORE {restorePreview.artifact_id.slice(-6)}</code> to continue.</b>
                  <Input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder={`RESTORE ${restorePreview.artifact_id.slice(-6)}`} />
                  <Button
                    type="button"
                    variant="destructive"
                    className="restore-submit"
                    disabled={pendingCount > 0 || failedCount > 0 || conflictCount > 0 || restoreConfirmation.trim() !== `RESTORE ${restorePreview.artifact_id.slice(-6)}`}
                    onClick={() => {
                      const artifact = backups.find((row) => row.id === restorePreview.artifact_id);
                      if (artifact) { setBackupActionError(null); setBackupApproval({ type: "restore", artifact }); }
                    }}
                  >Restore verified snapshot</Button>
                  {(pendingCount > 0 || failedCount > 0 || conflictCount > 0) && <p className="restore-blocked">Resolve every pending, failed, or conflicting local change before restoring.</p>}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <OwnerPinModal
        open={Boolean(backupApproval)}
        title={backupApproval?.type === "restore" ? "Final restore approval" : backupApproval?.type === "download" ? "Download encrypted backup" : backupApproval?.type === "restore-preview" ? "Validate restore safety" : "Create encrypted shop backup"}
        description={backupApproval?.type === "download"
          ? "Download the encrypted, audited shop backup."
          : backupApproval?.type === "restore"
            ? "Restore verified business data and rebuild every device cache."
          : backupApproval?.type === "restore-preview"
            ? "Verify compatibility without changing data."
            : "Create an encrypted snapshot without credentials."}
        confirmLabel={backupApproval?.type === "restore" ? "Restore shop" : backupApproval?.type === "download" ? "Download backup" : backupApproval?.type === "restore-preview" ? "Validate backup" : "Create backup"}
        loading={backupActionLoading}
        error={backupActionError}
        onCancel={() => { if (!backupActionLoading) { setBackupApproval(null); setBackupActionError(null); } }}
        onConfirm={confirmBackupAction}
      />
    </SettingsShell>
  );
}

function QueueRow({ label, tone, status, onRetry }: { label: string; tone: "amber" | "red"; status: string; onRetry?: () => void }) {
  return (
    <div className="sync-queue-row">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "red" ? "bg-rose-500" : "bg-amber-500"}`} />
      <p>{label}</p>
      <Badge tone={tone}>{status}</Badge>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}
