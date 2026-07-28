import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChangePassword } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ChevronRight, Eye, EyeOff, Fingerprint, KeyRound, Loader2, Lock, MonitorSmartphone, RefreshCcw, ShieldCheck } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { checkOwnerPin } from "@/features/settings/api";
import { enrolBiometric, forgetBiometric, isBiometricAvailable } from "@/features/settings/biometric-unlock";
import { useAuth } from "@/features/auth/useAuth";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { listDevices, logoutDevice, type DeviceDto } from "@/features/devices/api";
import { getOfflineScope } from "@/lib/offline/context";
import { offlineDB } from "@/lib/offline/db";
import type { AuditLogRow } from "@/features/audit-logs/local-actions";
import {
  DEFAULT_ACTION_RULE,
  DEFAULT_SECURITY_POLICY,
  PROTECTED_ACTIONS,
  SESSION_TIMEOUT_OPTIONS,
  setSecurityPolicyCache,
  type ActionRule,
  type SecurityPolicy,
} from "@/features/settings/security-policy";

/**
 * Security actions worth surfacing on this page. Everything else stays on the
 * full Audit Logs screen — this card is the "did anything sketchy happen"
 * glance, not a second log viewer.
 */
const SECURITY_ACTIONS = new Set([
  "owner_pin_action",
  "staff_login",
  "staff_action",
  "device_activation",
  "sync_conflict",
  "bill_cancelled",
  "bill_soft_deleted",
  "payment_reversed",
  "customer_deleted",
  "product_deleted",
  "supplier_deleted",
  "subscription_change",
]);

const DENIED_ACTIONS = new Set(["sync_conflict"]);

function relativeTime(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "Unknown time";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function deviceLabel(device: DeviceDto) {
  return device.deviceName || device.device_name || "Unnamed device";
}

function deviceId(device: DeviceDto) {
  return device.deviceId || device.device_id || device.id;
}

function deviceSeenAt(device: DeviceDto) {
  return device.lastSeenAt || device.lastLoginAt || device.lastActiveAt || device.last_active_at || device.registeredAt || null;
}

function summarise(row: AuditLogRow) {
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  if (summary) return summary;
  const action = String(row.action ?? "activity").replaceAll("_", " ");
  const label = typeof row.entity_label === "string" && row.entity_label ? ` — ${row.entity_label}` : "";
  return action.charAt(0).toUpperCase() + action.slice(1) + label;
}

async function loadSecurityEvents(): Promise<AuditLogRow[]> {
  const rows = await offlineDB.getAll<AuditLogRow>("local_audit_logs").catch(() => []);
  return rows
    .filter((row) => SECURITY_ACTIONS.has(String(row.action)))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 8);
}

export default function SecuritySettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [sec, setSec] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [pwOpen, setPwOpen] = useState(false);
  const [signOutTarget, setSignOutTarget] = useState<DeviceDto | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const seeded = useRef(false);
  const currentDeviceId = getOfflineScope().device_id;
  const { user } = useAuth();

  const pinQ = useQuery({ queryKey: ["owner-pin-status"], queryFn: checkOwnerPin, retry: 1 });
  const devicesQ = useQuery({ queryKey: ["devices", "security"], queryFn: listDevices, retry: 1 });
  const eventsQ = useQuery({ queryKey: ["security-events"], queryFn: loadSecurityEvents, staleTime: 5_000 });

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.security ?? {}) as Partial<SecurityPolicy>;
    const next = { ...DEFAULT_SECURITY_POLICY, ...saved, actions: { ...DEFAULT_SECURITY_POLICY.actions, ...(saved.actions ?? {}) } };
    setSec(next);
    setSecurityPolicyCache(next);
  }, [hydrated, prefs.security]);

  // Only offer biometric unlock where the platform can actually do it, instead
  // of a toggle that silently means nothing on this device.
  useEffect(() => {
    let active = true;
    void isBiometricAvailable().then((ok) => { if (active) setBiometricSupported(ok); });
    return () => { active = false; };
  }, []);

  /**
   * Enrolling has to happen behind the real platform prompt — if the owner
   * cancels Windows Hello / Touch ID the switch must snap back rather than
   * claim a lock that would never appear.
   */
  async function toggleBiometric(enabled: boolean) {
    if (!enabled) {
      forgetBiometric();
      update({ biometric: false });
      toast({ title: "Biometric unlock turned off" });
      return;
    }
    setEnrolling(true);
    try {
      await enrolBiometric(user?.id ?? "artha-owner", user?.name ?? "Artha owner");
      update({ biometric: true });
      toast({ title: "Biometric unlock ready", description: "The lock screen will offer fingerprint / face on this device." });
    } catch (error) {
      update({ biometric: false });
      toast({
        title: "Could not set up biometric unlock",
        description: (error as { message?: string })?.message || "The device prompt was cancelled.",
        variant: "destructive",
      });
    } finally {
      setEnrolling(false);
    }
  }

  const update = (partial: Partial<SecurityPolicy>) => {
    const next = { ...sec, ...partial };
    setSec(next);
    setSecurityPolicyCache(next); // takes effect immediately, no reload needed
    patch({ security: next });
  };
  const setAction = (key: string, rule: ActionRule) => update({ actions: { ...sec.actions, [key]: rule } });

  const devices = useMemo(() => {
    const rows = devicesQ.data?.devices ?? [];
    return [...rows].sort((a, b) => {
      const aCurrent = deviceId(a) === currentDeviceId ? 0 : 1;
      const bCurrent = deviceId(b) === currentDeviceId ? 0 : 1;
      if (aCurrent !== bCurrent) return aCurrent - bCurrent;
      return String(deviceSeenAt(b) ?? "").localeCompare(String(deviceSeenAt(a) ?? ""));
    });
  }, [currentDeviceId, devicesQ.data]);

  const protectedCount = PROTECTED_ACTIONS.filter((a) => a.serverEnforced || (sec.actions[a.key] ?? DEFAULT_ACTION_RULE).on).length;

  async function confirmSignOut(ownerPin: string) {
    if (!signOutTarget) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await logoutDevice(deviceId(signOutTarget), ownerPin, currentDeviceId);
      setSignOutTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "Device signed out", description: `${deviceLabel(signOutTarget)} must sign in again.` });
    } catch (error) {
      setSignOutError((error as { data?: { message?: string }; message?: string })?.data?.message
        ?? (error as { message?: string })?.message
        ?? "Could not sign that device out.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Owner PIN */}
        <Card>
          <CardHead
            icon={<KeyRound size={15} />}
            title="Owner PIN"
            sub="Protects money-sensitive actions"
            action={pinQ.isLoading
              ? <Badge tone="gray">Checking</Badge>
              : pinQ.data?.hasPin
                ? <Badge tone="green"><ShieldCheck size={11} /> Set</Badge>
                : <Badge tone="amber">Not set</Badge>}
          />
          <div className="space-y-3 px-5 pb-5">
            <div className="flex items-center gap-3 rounded-[10px] border border-[#eef2f8] px-4 py-3">
              <span className="font-mono text-[18px] tracking-[0.3em] text-[#102347]">{pinQ.data?.hasPin ? "•••••" : "—"}</span>
              <div className="flex-1">
                <p className="text-[12px] font-bold text-[#102347]">{pinQ.data?.hasPin ? "PIN active" : pinQ.isError ? "Status unavailable offline" : "No owner PIN yet"}</p>
                <p className="text-[11px] text-[#64748b]">
                  {pinQ.data?.hasPin
                    ? `${protectedCount} of ${PROTECTED_ACTIONS.length} actions ask for it`
                    : "Set one so protected actions can be approved"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setPwOpen(true)} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-10 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"><KeyRound size={15} /> Change PIN</Button>
            </div>
            <p className="text-[11px] text-[#9aa6bb]">Forgot your PIN? Recover it from your registered owner email/phone on the login screen.</p>
          </div>
        </Card>

        {/* Session & Login Security */}
        <Card>
          <CardHead icon={<Lock size={15} />} title="Session & Login Security" sub="Enforced on this device by the counter lock" />
          <div className="px-5 pb-4">
            <RowToggle label="Session timeout" desc={sec.autoLock ? "Lock the counter when idle this long" : "Sign out when idle this long"} pill={
              <Select value={sec.sessionTimeout} onValueChange={(v) => update({ sessionTimeout: v })}>
                <SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{SESSION_TIMEOUT_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>} />
            <RowToggle label="Auto-lock after inactivity" desc="Lock to a PIN screen instead of signing out" pill={<Switch checked={sec.autoLock} onCheckedChange={(v) => update({ autoLock: v })} />} />
            <RowToggle
              label="Biometric unlock"
              desc={biometricSupported === null
                ? "Checking this device…"
                : biometricSupported
                  ? "Use the device fingerprint / face prompt on the lock screen"
                  : "No fingerprint or face sensor is available in this browser"}
              pill={biometricSupported
                ? <Switch disabled={enrolling} checked={sec.biometric} onCheckedChange={(v) => void toggleBiometric(v)} />
                : <Badge tone="gray"><Fingerprint size={11} /> Unavailable</Badge>}
            />
            <RowToggle label="Require unlock on app start" desc="Ask for the PIN every time the app is opened fresh" pill={<Switch checked={sec.requireLoginOnStart} onCheckedChange={(v) => update({ requireLoginOnStart: v })} />} />
            <RowToggle label="Remember this device" desc="Off means an expired session signs out fully instead of offering a PIN unlock" pill={<Switch checked={sec.rememberDevice} onCheckedChange={(v) => update({ rememberDevice: v })} />} last />
            <p className="mt-2 text-[11px] text-[#9aa6bb]">Two-factor sign-in needs server-side enrolment and is not offered here yet, so no toggle pretends to switch it on.</p>
          </div>
        </Card>
      </div>

      {/* Sensitive Action Protection */}
      <Card>
        <CardHead icon={<ShieldCheck size={15} />} title="Sensitive Action Protection" sub="Which actions require approval & who can approve" action={<Badge tone={protectedCount ? "green" : "amber"}>{protectedCount} of {PROTECTED_ACTIONS.length} protected</Badge>} />
        <div className="px-5 pb-5">
          <div className="app-table-scroll overflow-x-auto rounded-[10px] border border-[#eef2f8]">
            <table className="min-w-[720px] w-full text-[12px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Action</th>
                  <th className="px-3 py-2 text-center font-bold">Protected</th>
                  <th className="px-3 py-2 text-left font-bold">Who can approve</th>
                  <th className="px-3 py-2 text-right font-bold">Audit</th>
                </tr>
              </thead>
              <tbody>
                {PROTECTED_ACTIONS.map((a, i) => {
                  const rule = sec.actions[a.key] ?? DEFAULT_ACTION_RULE;
                  const locked = a.serverEnforced;
                  const on = locked || rule.on;
                  return (
                    <tr key={a.key} className={i < PROTECTED_ACTIONS.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="px-3 py-2.5 font-bold text-[#102347]">
                        {a.label}
                        {locked ? <span className="ml-1.5 align-middle"><Badge tone="blue">Server enforced</Badge></span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Switch
                            aria-label={`Protect ${a.label}`}
                            checked={on}
                            disabled={locked}
                            title={locked ? "The server rejects this action without an owner PIN, so the prompt cannot be turned off." : undefined}
                            onCheckedChange={(v) => setAction(a.key, { ...rule, on: v })}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Select value={rule.approver} onValueChange={(v) => setAction(a.key, { ...rule, approver: v as ActionRule["approver"] })}>
                          <SelectTrigger className="h-8 w-[170px] text-[12px]" disabled={!on}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner only</SelectItem>
                            <SelectItem value="ownerManager">Owner or Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right">{on ? <Badge tone="green">Logged</Badge> : <Badge tone="gray">Off</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#9aa6bb]">Protected actions prompt for the owner PIN at the counter and are written to the audit log. Rows marked <strong>Server enforced</strong> are also required by the API, so their prompt cannot be switched off; the rest are decided here and take effect on the next bill.</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Trusted Devices */}
        <Card>
          <CardHead
            icon={<MonitorSmartphone size={15} />}
            title="Signed-in Devices"
            sub="Live from your device licence list"
            action={<button type="button" onClick={() => void devicesQ.refetch()} className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline"><RefreshCcw size={12} className={devicesQ.isFetching ? "animate-spin" : ""} /> Refresh</button>}
          />
          <div className="px-5 pb-4">
            {devicesQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Loading devices</p>
            ) : devicesQ.isError ? (
              <p className="rounded-[10px] bg-amber-50 px-3 py-3 text-[12px] font-semibold text-amber-900">Device list unavailable right now — nothing is being shown as trusted.</p>
            ) : devices.length === 0 ? (
              <p className="rounded-[10px] bg-[#f6f8fc] px-3 py-6 text-center text-[12px] text-[#64748b]">No devices registered yet.</p>
            ) : devices.map((device, i) => {
              const id = deviceId(device);
              const isCurrent = id === currentDeviceId;
              const blocked = device.status === "blocked";
              return (
                <div key={id} className={`flex flex-wrap items-center gap-3 py-2.5 ${i < devices.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f4f7fb] text-[#536583]"><MonitorSmartphone size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[#102347]">{deviceLabel(device)}{isCurrent && <span className="ml-1.5"><Badge tone="blue">Current</Badge></span>}</p>
                    <p className="text-[11px] text-[#64748b]">{[device.platform || device.operatingSystem, `last seen ${relativeTime(deviceSeenAt(device))}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Badge tone={blocked ? "red" : device.status === "active" ? "green" : "gray"}>{blocked ? "Blocked" : device.status === "active" ? "Active" : device.status || "Idle"}</Badge>
                  {!isCurrent && (
                    <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold" onClick={() => { setSignOutError(null); setSignOutTarget(device); }}>Sign out</Button>
                  )}
                </div>
              );
            })}
            <Link href="/settings/devices" className="mt-2 flex items-center justify-center gap-1 py-2 text-[12px] font-bold text-[var(--brand)] hover:underline">Manage devices <ChevronRight size={13} /></Link>
          </div>
        </Card>

        {/* Security Logs */}
        <Card>
          <CardHead
            icon={<AlertTriangle size={15} />}
            title="Security Logs"
            sub="Real approvals and sensitive actions on this device"
            action={<button type="button" onClick={() => void eventsQ.refetch()} className="text-[12px] font-bold text-[var(--brand)] hover:underline">Refresh</button>}
          />
          <div className="px-5 pb-4">
            {eventsQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Reading audit trail</p>
            ) : (eventsQ.data ?? []).length === 0 ? (
              <div className="py-8 text-center">
                <ShieldCheck className="mx-auto text-[#b5c0d2]" size={26} />
                <p className="mt-2 text-[13px] font-black text-[#102347]">No security events yet</p>
                <p className="mt-1 text-[11px] text-[#64748b]">Approvals, cancellations and sign-ins will appear here as they happen.</p>
              </div>
            ) : (eventsQ.data ?? []).map((row, i, arr) => {
              const denied = DENIED_ACTIONS.has(String(row.action));
              return (
                <div key={String(row.id)} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${denied ? "bg-rose-500" : "bg-emerald-500"}`} />
                  <p className={`min-w-0 flex-1 truncate text-[12px] font-medium ${denied ? "text-rose-700" : "text-[#344668]"}`} title={summarise(row)}>{summarise(row)}</p>
                  <span className="shrink-0 text-[11px] text-[#9aa6bb]">{relativeTime(row.created_at)}</span>
                </div>
              );
            })}
            <Link href="/audit-logs" className="mt-2 flex items-center justify-center gap-1 py-2 text-[12px] font-bold text-[var(--brand)] hover:underline">Open full audit log <ChevronRight size={13} /></Link>
          </div>
        </Card>
      </div>

      <ChangePinDialog open={pwOpen} onOpenChange={setPwOpen} onChanged={() => void pinQ.refetch()} />

      <OwnerPinModal
        open={signOutTarget !== null}
        title="Sign out this device"
        description={signOutTarget ? `${deviceLabel(signOutTarget)} will need to sign in again. Unsynced work on that device stays on it.` : undefined}
        confirmLabel="Sign out device"
        loading={signingOut}
        error={signOutError}
        onCancel={() => { if (!signingOut) { setSignOutTarget(null); setSignOutError(null); } }}
        onConfirm={({ ownerPin }) => confirmSignOut(ownerPin)}
      />
    </SettingsShell>
  );
}

const pwSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(6, "Min 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });
type PwData = z.infer<typeof pwSchema>;

function ChangePinDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const form = useForm<PwData>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => { form.reset(); toast({ title: "Owner PIN / password updated" }); onChanged(); onOpenChange(false); },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Incorrect current PIN", variant: "destructive" }),
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">Update Owner PIN</DialogTitle>
          <p className="text-[12px] text-[#6d7c98]">Change the owner login PIN / password.</p>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => changePassword.mutate({ data: { currentPassword: v.currentPassword, newPassword: v.newPassword } }))} className="space-y-3.5">
          <Fld label="Current PIN / password" err={form.formState.errors.currentPassword?.message}>
            <div className="relative">
              <Input className="h-10 pr-9" type={show ? "text" : "password"} {...form.register("currentPassword")} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a9a]">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </Fld>
          <Fld label="New PIN / password" err={form.formState.errors.newPassword?.message}><Input className="h-10" type="password" {...form.register("newPassword")} /></Fld>
          <Fld label="Confirm new PIN" err={form.formState.errors.confirmPassword?.message}><Input className="h-10" type="password" {...form.register("confirmPassword")} /></Fld>
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={changePassword.isPending} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {changePassword.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
