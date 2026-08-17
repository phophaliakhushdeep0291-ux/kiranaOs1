import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
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
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/core/settings/ui";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { checkOwnerPin } from "@/features/core/settings/api";
import { enrolBiometric, forgetBiometric, isBiometricAvailable } from "@/features/core/settings/biometric-unlock";
import { useAuth } from "@/features/core/auth/useAuth";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { listDevices, logoutDevice, type DeviceDto } from "@/features/core/devices/api";
import { getOfflineScope } from "@/lib/offline/context";
import { offlineDB } from "@/lib/offline/db";
import type { AuditLogRow } from "@/features/core/audit-logs/local-actions";
import {
  DEFAULT_ACTION_RULE,
  DEFAULT_SECURITY_POLICY,
  PROTECTED_ACTIONS,
  SESSION_TIMEOUT_OPTIONS,
  setSecurityPolicyCache,
  type ActionRule,
  type SecurityPolicy,
} from "@/features/core/settings/security-policy";

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
  const { t } = useAppLanguage();
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
      toast({ title: t("settings.security.biometricOff") });
      return;
    }
    setEnrolling(true);
    try {
      await enrolBiometric(user?.id ?? "artha-owner", user?.name ?? "Artha owner");
      update({ biometric: true });
      toast({ title: t("settings.security.biometricReady"), description: t("settings.security.biometricReadyHelp") });
    } catch (error) {
      update({ biometric: false });
      toast({
        title: t("settings.security.biometricFailed"),
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
      toast({ title: t("settings.security.deviceSignedOut"), description: `${deviceLabel(signOutTarget)} must sign in again.` });
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
            title={t("inventory.transfers.ownerPin")}
            sub={t("settings.security.protectsMoney")}
            action={pinQ.isLoading
              ? <Badge tone="gray">{t("settings.security.checking")}</Badge>
              : pinQ.data?.hasPin
                ? <Badge tone="green"><ShieldCheck size={11} /> {t("settings.security.set")}</Badge>
                : <Badge tone="amber">{t("settings.security.notSet")}</Badge>}
          />
          <div className="space-y-3 px-5 pb-5">
            <div className="flex items-center gap-3 rounded-[10px] border border-[#eef2f8] px-4 py-3">
              <span className="font-mono text-[18px] tracking-[0.3em] text-[var(--brand-ink)]">{pinQ.data?.hasPin ? "•••••" : "—"}</span>
              <div className="flex-1">
                <p className="text-[12px] font-bold text-[var(--brand-ink)]">{pinQ.data?.hasPin ? t("settings.security.pinActive") : pinQ.isError ? t("settings.security.statusOffline") : t("settings.security.noPinYet")}</p>
                <p className="text-[11px] text-[#64748b]">
                  {pinQ.data?.hasPin
                    ? `${protectedCount} of ${PROTECTED_ACTIONS.length} actions ask for it`
                    : "Set one so protected actions can be approved"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setPwOpen(true)} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-10 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"><KeyRound size={15} /> {t("settings.security.changePin")}</Button>
            </div>
            <p className="text-[11px] text-[#9aa6bb]">{t("settings.security.forgotPin")}</p>
          </div>
        </Card>

        {/* Session & Login Security */}
        <Card>
          <CardHead icon={<Lock size={15} />} title={t("settings.security.sessionTitle")} sub={t("settings.security.sessionSub")} />
          <div className="px-5 pb-4">
            <RowToggle label={t("settings.security.sessionTimeout")} desc={sec.autoLock ? t("settings.security.lockIdle") : t("settings.security.signOutIdle")} pill={
              <Select value={sec.sessionTimeout} onValueChange={(v) => update({ sessionTimeout: v })}>
                <SelectTrigger className="min-h-11 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{SESSION_TIMEOUT_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>} />
            <RowToggle label={t("settings.security.autoLock")} desc={t("settings.security.autoLockHelp")} pill={<Switch checked={sec.autoLock} onCheckedChange={(v) => update({ autoLock: v })} />} />
            <RowToggle
              label={t("settings.security.biometric")}
              desc={biometricSupported === null
                ? t("settings.security.checkingDevice")
                : biometricSupported
                  ? t("settings.security.biometricHelp")
                  : t("settings.security.biometricUnavailable")}
              pill={biometricSupported
                ? <Switch disabled={enrolling} checked={sec.biometric} onCheckedChange={(v) => void toggleBiometric(v)} />
                : <Badge tone="gray"><Fingerprint size={11} /> {t("settings.security.unavailable")}</Badge>}
            />
            <RowToggle label={t("settings.security.unlockOnStart")} desc={t("settings.security.unlockOnStartHelp")} pill={<Switch checked={sec.requireLoginOnStart} onCheckedChange={(v) => update({ requireLoginOnStart: v })} />} />
            <RowToggle label={t("settings.security.rememberDevice")} desc={t("settings.security.rememberDeviceHelp")} pill={<Switch checked={sec.rememberDevice} onCheckedChange={(v) => update({ rememberDevice: v })} />} last />
            <p className="mt-2 text-[11px] text-[#9aa6bb]">{t("settings.security.twoFactorHelp")}</p>
          </div>
        </Card>
      </div>

      {/* Sensitive Action Protection */}
      <Card>
        <CardHead icon={<ShieldCheck size={15} />} title={t("billing.page.sensitiveActionProtection")} sub={t("settings.security.approvalScope")} action={<Badge tone={protectedCount ? "green" : "amber"}>{t("settings.security.protectedCount", { count: protectedCount, total: PROTECTED_ACTIONS.length })}</Badge>} />
        <div className="px-5 pb-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {PROTECTED_ACTIONS.map((action) => {
              const locked = action.serverEnforced;
              const savedRule = sec.actions[action.key] ?? DEFAULT_ACTION_RULE;
              const rule = locked ? { ...savedRule, on: true, approver: "owner" as const } : savedRule;
              const on = locked || rule.on;
              return (
                <section key={action.key} className="min-w-0 space-y-3 rounded-xl border border-[#e7edf7] bg-[#fbfcff] p-3.5">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words text-[13px] font-black leading-5 text-[var(--brand-ink)]">{action.label}</h4>
                      {locked ? <div className="mt-1"><Badge tone="blue">{t("settings.security.serverEnforced")}</Badge></div> : null}
                    </div>
                    <Switch
                      aria-label={`Protect ${action.label}`}
                      checked={on}
                      disabled={locked}
                      title={locked ? t("settings.security.serverRequiresPin") : undefined}
                      onCheckedChange={(value) => setAction(action.key, { ...rule, on: value })}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{t("settings.security.whoApproves")}</p>
                    <Select value={rule.approver} onValueChange={(value) => setAction(action.key, { ...rule, approver: value as ActionRule["approver"] })}>
                      <SelectTrigger className="min-h-11 w-full text-[12px]" disabled={locked || !on} aria-label={`Approver for ${action.label}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">{t("settings.security.ownerOnly")}</SelectItem>
                        <SelectItem value="ownerManager">{t("settings.security.ownerOrManager")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-[#e7edf7] pt-3">
                    <span className="text-[11px] font-semibold text-[#64748b]">{t("settings.security.auditTrail")}</span>
                    <Badge tone={on ? "green" : "gray"}>{on ? t("settings.security.logged") : t("settings.security.off")}</Badge>
                  </div>
                </section>
              );
            })}
          </div>
          <div className="app-table-scroll hidden overflow-x-auto rounded-[10px] border border-[#eef2f8] lg:block">
            <table className="min-w-[720px] w-full text-[12px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.security.action")}</th>
                  <th className="px-3 py-2 text-center font-bold">{t("settings.security.protected")}</th>
                  <th className="px-3 py-2 text-left font-bold">{t("settings.security.whoApproves")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("settings.security.audit")}</th>
                </tr>
              </thead>
              <tbody>
                {PROTECTED_ACTIONS.map((a, i) => {
                  const locked = a.serverEnforced;
                  const savedRule = sec.actions[a.key] ?? DEFAULT_ACTION_RULE;
                  const rule = locked ? { ...savedRule, on: true, approver: "owner" as const } : savedRule;
                  const on = locked || rule.on;
                  return (
                    <tr key={a.key} className={i < PROTECTED_ACTIONS.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="px-3 py-2.5 font-bold text-[var(--brand-ink)]">
                        {a.label}
                        {locked ? <span className="ml-1.5 align-middle"><Badge tone="blue">{t("settings.security.serverEnforced")}</Badge></span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Switch
                            aria-label={`Protect ${a.label}`}
                            checked={on}
                            disabled={locked}
                            title={locked ? t("settings.security.serverRequiresPin") : undefined}
                            onCheckedChange={(v) => setAction(a.key, { ...rule, on: v })}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Select value={rule.approver} onValueChange={(v) => setAction(a.key, { ...rule, approver: v as ActionRule["approver"] })}>
                          <SelectTrigger className="min-h-11 w-[170px] text-[12px]" disabled={locked || !on}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">{t("settings.security.ownerOnly")}</SelectItem>
                            <SelectItem value="ownerManager">{t("settings.security.ownerOrManager")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right">{on ? <Badge tone="green">{t("settings.security.logged")}</Badge> : <Badge tone="gray">{t("settings.security.off")}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#9aa6bb]">{t("settings.security.protectedHelpBefore")} <strong>{t("settings.security.serverEnforced")}</strong> {t("settings.security.protectedHelpAfter")}</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Trusted Devices */}
        <Card>
          <CardHead
            icon={<MonitorSmartphone size={15} />}
            title={t("settings.security.devicesTitle")}
            sub={t("settings.security.devicesSub")}
            action={<button type="button" onClick={() => void devicesQ.refetch()} className="settings-text-action gap-1"><RefreshCcw size={12} className={devicesQ.isFetching ? "animate-spin" : ""} /> {t("settings.security.refresh")}</button>}
          />
          <div className="px-5 pb-4">
            {devicesQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> {t("settings.security.loadingDevices")}</p>
            ) : devicesQ.isError ? (
              <p className="rounded-[10px] bg-amber-50 px-3 py-3 text-[12px] font-semibold text-amber-900">{t("settings.security.devicesUnavailable")}</p>
            ) : devices.length === 0 ? (
              <p className="rounded-[10px] bg-[#f6f8fc] px-3 py-6 text-center text-[12px] text-[#64748b]">{t("settings.security.noDevices")}</p>
            ) : devices.map((device, i) => {
              const id = deviceId(device);
              const isCurrent = id === currentDeviceId;
              const blocked = device.status === "blocked";
              return (
                <div key={id} className={`flex flex-wrap items-center gap-3 py-2.5 ${i < devices.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f4f7fb] text-[#536583]"><MonitorSmartphone size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{deviceLabel(device)}{isCurrent && <span className="ml-1.5"><Badge tone="blue">{t("settings.security.current")}</Badge></span>}</p>
                    <p className="text-[11px] text-[#64748b]">{[device.platform || device.operatingSystem, `last seen ${relativeTime(deviceSeenAt(device))}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Badge tone={blocked ? "red" : device.status === "active" ? "green" : "gray"}>{blocked ? t("settings.security.deviceBlocked") : device.status === "active" ? t("settings.security.deviceActive") : device.status || t("settings.security.deviceIdle")}</Badge>
                  {!isCurrent && (
                    <Button size="sm" variant="outline" className="rounded-[8px] text-[12px] font-bold" onClick={() => { setSignOutError(null); setSignOutTarget(device); }}>{t("settings.security.signOut")}</Button>
                  )}
                </div>
              );
            })}
            <Link href="/settings/devices" className="mt-2 flex min-h-11 items-center justify-center gap-1 py-2 text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.security.manageDevices")} <ChevronRight size={13} /></Link>
          </div>
        </Card>

        {/* Security Logs */}
        <Card>
          <CardHead
            icon={<AlertTriangle size={15} />}
            title={t("settings.security.logsTitle")}
            sub={t("settings.security.logsSub")}
            action={<button type="button" onClick={() => void eventsQ.refetch()} className="settings-text-action">{t("settings.security.refresh")}</button>}
          />
          <div className="px-5 pb-4">
            {eventsQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> {t("settings.security.readingAudit")}</p>
            ) : (eventsQ.data ?? []).length === 0 ? (
              <div className="py-8 text-center">
                <ShieldCheck className="mx-auto text-[#b5c0d2]" size={26} />
                <p className="mt-2 text-[13px] font-black text-[var(--brand-ink)]">{t("settings.security.noEvents")}</p>
                <p className="mt-1 text-[11px] text-[#64748b]">{t("settings.security.noEventsHelp")}</p>
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
            <Link href="/audit-logs" className="mt-2 flex min-h-11 items-center justify-center gap-1 py-2 text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.security.openFullAudit")} <ChevronRight size={13} /></Link>
          </div>
        </Card>
      </div>

      <ChangePinDialog open={pwOpen} onOpenChange={setPwOpen} onChanged={() => void pinQ.refetch()} />

      <OwnerPinModal
        open={signOutTarget !== null}
        title={t("settings.security.signOutThisDevice")}
        description={signOutTarget ? `${deviceLabel(signOutTarget)} will need to sign in again. Unsynced work on that device stays on it.` : undefined}
        confirmLabel={t("settings.security.signOutDevice")}
        loading={signingOut}
        error={signOutError}
        onCancel={() => { if (!signingOut) { setSignOutTarget(null); setSignOutError(null); } }}
        onConfirm={({ ownerPin }) => confirmSignOut(ownerPin)}
      />
    </SettingsShell>
  );
}

const passwordSchema = (t: Translate) => z.object({
  currentPassword: z.string().min(1, t("settings.security.pwRequired")),
  newPassword: z.string().min(6, t("settings.security.pwMinLength")),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: t("settings.security.pwMismatch"), path: ["confirmPassword"] });
type PwData = z.infer<ReturnType<typeof passwordSchema>>;

function ChangePinDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const form = useForm<PwData>({ resolver: zodResolver(passwordSchema(t)), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => { form.reset(); toast({ title: t("settings.security.pinUpdated") }); onChanged(); onOpenChange(false); },
      onError: (err: unknown) => toast({ title: t("settings.security.error"), description: (err as { data?: { message?: string } })?.data?.message ?? "Incorrect current PIN", variant: "destructive" }),
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">{t("settings.security.updateOwnerPin")}</DialogTitle>
          <p className="text-[12px] text-[#6d7c98]">{t("settings.security.updateOwnerPinHelp")}</p>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => changePassword.mutate({ data: { currentPassword: v.currentPassword, newPassword: v.newPassword } }))} className="space-y-3.5">
          <Fld label={t("settings.security.currentPin")} err={form.formState.errors.currentPassword?.message}>
            <div className="relative">
              <Input className="pr-12" type={show ? "text" : "password"} {...form.register("currentPassword")} />
              <button type="button" aria-label={show ? t("settings.security.hidePin") : t("settings.security.showPin")} onClick={() => setShow((s) => !s)} className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl text-[#6b7a9a] hover:bg-[#f1f5fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </Fld>
          <Fld label={t("settings.security.newPin")} err={form.formState.errors.newPassword?.message}><Input className="h-10" type="password" {...form.register("newPassword")} /></Fld>
          <Fld label={t("settings.security.confirmPin")} err={form.formState.errors.confirmPassword?.message}><Input className="h-10" type="password" {...form.register("confirmPassword")} /></Fld>
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>{t("settings.security.cancel")}</Button>
            <Button type="submit" disabled={changePassword.isPending} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {changePassword.isPending ? <><Loader2 size={16} className="animate-spin" /> {t("settings.security.saving")}</> : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
