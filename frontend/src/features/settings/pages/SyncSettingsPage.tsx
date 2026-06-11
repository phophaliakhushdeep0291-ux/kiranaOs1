import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { CheckCircle2, Clock, Cloud, CloudOff, Database, Download, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, Kpi, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

interface BackupConfig {
  auto: boolean;
  frequency: string;
  time: string;
  location: string;
  keepFor: string;
  encrypt: boolean;
}
const DEFAULT_BACKUP: BackupConfig = {
  auto: true, frequency: "Daily", time: "02:00", location: "Secure Cloud Storage", keepFor: "30 days", encrypt: true,
};
const BACKUP_HISTORY = [
  { date: "Today 02:00 AM", size: "24 MB", type: "Auto", status: "success" as const },
  { date: "Yesterday 02:00 AM", size: "23 MB", type: "Auto", status: "success" as const },
  { date: "2 days ago", size: "22 MB", type: "Manual", status: "success" as const },
];

function timeAgo(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function SyncSettingsPage() {
  const { toast } = useToast();
  const { isOnline, isSyncing, pendingCount, failedCount, conflictCount, syncNow } = useOfflineStatus();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [backup, setBackup] = useState<BackupConfig>(DEFAULT_BACKUP);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const wasSyncing = useRef(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    setBackup({ ...DEFAULT_BACKUP, ...((prefs.backup ?? {}) as Partial<BackupConfig>) });
  }, [hydrated, prefs.backup]);

  useEffect(() => { if (wasSyncing.current && !isSyncing) setLastSynced(new Date()); wasSyncing.current = isSyncing; }, [isSyncing]);

  const update = (partial: Partial<BackupConfig>) => { const next = { ...backup, ...partial }; setBackup(next); patch({ backup: next }); };
  const allSynced = isOnline && pendingCount === 0 && failedCount === 0 && conflictCount === 0;

  function handleSync() { void syncNow({ manual: true }); toast({ title: isOnline ? "Syncing now…" : "You're offline", description: isOnline ? "Pushing and pulling the latest changes." : "Changes will sync when you're back online." }); }

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
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 lg:grid-cols-5">
          <Kpi label="Sync Status" value={isOnline ? (isSyncing ? "Syncing" : "Synced") : "Offline"} tone={allSynced ? "green" : isOnline ? "amber" : "gray"} icon={allSynced ? <CheckCircle2 size={15} /> : <Clock size={15} />} />
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Backup Settings */}
        <Card>
          <CardHead icon={<Database size={15} />} title="Backup Settings" sub="Automatic cloud backups" action={<button onClick={() => toast({ title: "Backup started", description: "A manual backup is being created now." })} className="text-[12px] font-bold text-[#005dff] hover:underline">Backup now</button>} />
          <div className="px-5 pb-4">
            <RowToggle label="Auto backup" desc="Back up automatically on a schedule" pill={<Switch checked={backup.auto} onCheckedChange={(v) => update({ auto: v })} />} />
            <RowToggle label="Frequency" pill={<Select value={backup.frequency} onValueChange={(v) => update({ frequency: v })}><SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["Hourly", "Daily", "Weekly"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>} />
            <RowToggle label="Backup time" pill={<Input className="h-8 w-[110px] text-[12px]" type="time" value={backup.time} onChange={(e) => update({ time: e.target.value })} />} />
            <RowToggle label="Keep backups for" pill={<Select value={backup.keepFor} onValueChange={(v) => update({ keepFor: v })}><SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["7 days", "30 days", "90 days", "1 year"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>} />
            <RowToggle label="Encrypt backups" desc="AES-256 at rest" pill={<Switch checked={backup.encrypt} onCheckedChange={(v) => update({ encrypt: v })} />} last />
            <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-[#eef5ff] px-3 py-2 text-[11px] font-medium text-[#34507f]"><ShieldCheck size={14} /> Backups go to {backup.location}.</div>
          </div>
        </Card>

        {/* Backup History */}
        <Card>
          <CardHead icon={<Cloud size={15} />} title="Backup History" sub="Recent backups" />
          <div className="px-5 pb-4">
            {BACKUP_HISTORY.map((b, i) => (
              <div key={i} className={`flex items-center gap-3 py-2.5 ${i < BACKUP_HISTORY.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-emerald-50 text-emerald-600"><CheckCircle2 size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">{b.date}</p>
                  <p className="text-[11px] text-[#64748b]">{b.size} · {b.type}</p>
                </div>
                <button onClick={() => toast({ title: "Restore backup", description: "Restoring needs the owner PIN and will replace local data." })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><Download size={12} /> Restore</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
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
