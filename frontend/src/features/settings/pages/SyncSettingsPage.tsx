import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { Archive, CheckCircle2, Clock, Cloud, CloudOff, Database, Download, Loader2, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Badge, Kpi, RowToggle } from "@/features/settings/ui";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { ApiClientError } from "@/lib/api/http";
import {
  createShopBackup,
  downloadShopBackup,
  listShopBackups,
  saveBackupBlob,
  type BackupArtifact,
} from "@/features/backups";
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

function backupSize(value: string | null) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size pending";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [backupRetentionDays, setBackupRetentionDays] = useState(30);
  const [backupHistoryLoading, setBackupHistoryLoading] = useState(true);
  const [backupAccessDenied, setBackupAccessDenied] = useState(false);
  const [backupApproval, setBackupApproval] = useState<{ type: "create" | "download"; artifact?: BackupArtifact } | null>(null);
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
      setBackupRetentionDays(result.retention_days);
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
        toast({
          title: result.backup.status === "completed" ? "Encrypted backup ready" : "Encrypted backup queued",
          description: "The portable snapshot is tenant-scoped, checksummed, and protected with AES-256-GCM.",
        });
      } else if (backupApproval.artifact) {
        const blob = await downloadShopBackup(backupApproval.artifact.id, ownerPin);
        saveBackupBlob(blob, backupApproval.artifact);
        toast({ title: "Encrypted backup downloaded", description: "Keep the .kosb file and encryption key in separate secure locations." });
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
    toast({
      title: isOnline ? "Syncing now..." : isBrowserOnline ? "Cloud backup paused" : "You're offline",
      description: isOnline
        ? "Pushing and pulling the latest changes."
        : isBrowserOnline
          ? "The app is online, but the backend is not reachable yet."
          : "Changes will sync when you're back online.",
    });
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
              { text: lastSynced ? "Changes synced successfully" : "Waiting for first sync", ok: true, time: timeAgo(lastSynced) },
              { text: `${pendingCount} change${pendingCount === 1 ? "" : "s"} queued to upload`, ok: pendingCount === 0, time: "now" },
              { text: "Inventory & customers pulled", ok: true, time: "earlier" },
              { text: failedCount ? `${failedCount} item(s) failed — will retry` : "No failures", ok: failedCount === 0, time: "—" },
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
          <CardHead icon={<Upload size={15} />} title="Pending Sync Queue" sub="Changes waiting to reach the cloud" action={(pendingCount + failedCount) > 0 ? <button onClick={handleSync} className="text-[12px] font-bold text-[#005dff] hover:underline">Retry all</button> : undefined} />
          <div className="px-5 pb-5">
            {(pendingCount + failedCount + conflictCount) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={22} /></span>
                <p className="text-[13px] font-bold text-[#102347]">Everything is synced</p>
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

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        {/* Encrypted portable backups */}
        <Card>
          <CardHead
            icon={<Archive size={15} />}
            title="Portable shop backup"
            sub="Encrypted recovery artifact"
            action={!backupAccessDenied ? (
              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-[8px] text-[12px] font-bold"
                disabled={!isOnline || backupActionLoading}
                onClick={() => { setBackupActionError(null); setBackupApproval({ type: "create" }); }}
              >
                {backupActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                Create snapshot
              </Button>
            ) : undefined}
          />
          <div className="px-5 pb-4">
            {backupAccessDenied ? (
              <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] font-medium text-amber-900">
                Owner or admin access is required to view portable backups.
              </div>
            ) : (
              <>
                <RowToggle label="Encryption" desc="Authenticated encryption before upload" pill={<Badge tone="green"><ShieldCheck size={11} /> AES-256-GCM</Badge>} />
                <RowToggle label="Integrity" desc="Verified before recovery" pill={<Badge tone="blue">SHA-256</Badge>} />
                <RowToggle label="Retention" desc="Expired objects are deleted; audit metadata remains" pill={<Badge>{backupRetentionDays} days</Badge>} />
                <RowToggle label="Sensitive credentials" desc="Passwords, PINs, sessions, API keys and webhook secrets" pill={<Badge tone="green">Excluded</Badge>} last />
                <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-[#eef5ff] px-3 py-2 text-[11px] font-medium leading-relaxed text-[#34507f]">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  Continuous device sync and portable snapshots are separate protections. A snapshot is created only after owner-PIN approval.
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Backup History */}
        <Card>
          <CardHead icon={<Cloud size={15} />} title="Backup history" sub="Server-confirmed encrypted artifacts" action={!backupAccessDenied ? <button onClick={() => void loadBackups()} className="text-[12px] font-bold text-[#005dff] hover:underline">Refresh</button> : undefined} />
          <div className="space-y-2 px-5 pb-4">
            {backupHistoryLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={15} className="animate-spin" /> Loading backup history</div>
            ) : backupAccessDenied ? (
              <div className="py-8 text-center text-[12px] text-[#64748b]">Backup history is hidden for cashier accounts.</div>
            ) : backups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-7 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#eef5ff] text-[#005dff]"><Archive size={20} /></span>
                <p className="text-[13px] font-bold text-[#102347]">No portable snapshot yet</p>
                <p className="max-w-sm text-[11px] text-[#64748b]">Create one before a major import, migration, device replacement, or support recovery.</p>
              </div>
            ) : backups.slice(0, 8).map((artifact) => (
              <div key={artifact.id} className="flex flex-col gap-3 rounded-[11px] border border-[#e7edf7] px-3.5 py-3 sm:flex-row sm:items-center">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#eef5ff] text-[#005dff]"><Archive size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] font-bold text-[#102347]">{backupTime(artifact.completed_at ?? artifact.created_at)}</p>
                    <Badge tone={backupTone(artifact.status)}>{artifact.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-[#64748b]">
                    {artifact.status === "failed"
                      ? artifact.error_message || "Backup failed"
                      : `${backupSize(artifact.size_bytes)} · ${artifact.record_count?.toLocaleString("en-IN") ?? "—"} records · expires ${backupTime(artifact.expires_at)}`}
                  </p>
                </div>
                {artifact.status === "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 rounded-[8px] text-[12px]"
                    onClick={() => { setBackupActionError(null); setBackupApproval({ type: "download", artifact }); }}
                  >
                    <Download size={13} /> Download
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <OwnerPinModal
        open={Boolean(backupApproval)}
        title={backupApproval?.type === "download" ? "Download encrypted backup" : "Create encrypted shop backup"}
        description={backupApproval?.type === "download"
          ? "This exports sensitive shop data in an encrypted .kosb envelope. The download is audited."
          : "This creates a transactionally consistent, tenant-scoped snapshot. Credential hashes and session secrets are excluded."}
        confirmLabel={backupApproval?.type === "download" ? "Download backup" : "Create backup"}
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
    <div className="flex items-center gap-3 rounded-[10px] border border-[#eef2f8] px-3.5 py-2.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "red" ? "bg-rose-500" : "bg-amber-500"}`} />
      <p className="flex-1 text-[12px] font-semibold text-[#344668]">{label}</p>
      <Badge tone={tone}>{status}</Badge>
      {onRetry && <button onClick={onRetry} className="text-[12px] font-bold text-[#005dff] hover:underline">Retry</button>}
    </div>
  );
}
