import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useChangePassword } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, Lock, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

const ACTIONS = [
  { key: "cancelBill", label: "Cancel Bill" },
  { key: "reversePayment", label: "Reverse Payment" },
  { key: "deleteProduct", label: "Delete Product" },
  { key: "deleteCustomer", label: "Delete Customer" },
  { key: "stockCorrection", label: "Stock Correction" },
  { key: "largeDiscount", label: "Large Discount" },
  { key: "sellBelowMin", label: "Sell Below Min Price" },
  { key: "exportData", label: "Export Data" },
  { key: "staffPermissions", label: "Change Staff Permissions" },
  { key: "restoreDeleted", label: "Restore Deleted Record" },
  { key: "gstSettings", label: "Change GST Settings" },
] as const;

type ActionRule = { on: boolean; approver: "owner" | "ownerManager" };
interface SecurityConfig {
  sessionTimeout: string;
  autoLock: boolean;
  biometric: boolean;
  twoFactor: boolean;
  requireLoginOnStart: boolean;
  rememberDevice: boolean;
  actions: Record<string, ActionRule>;
}
const DEFAULT_ACTION: ActionRule = { on: true, approver: "owner" };
const DEFAULT_SECURITY: SecurityConfig = {
  sessionTimeout: "15 minutes", autoLock: true, biometric: false, twoFactor: false,
  requireLoginOnStart: true, rememberDevice: true,
  actions: Object.fromEntries(ACTIONS.map((a) => [a.key, DEFAULT_ACTION])),
};

const LOGS = [
  { text: "Owner PIN verified for bill cancellation", tone: "gray" as const, time: "11:42 AM" },
  { text: "Staff permission changed by owner", tone: "gray" as const, time: "10:18 AM" },
  { text: "Payment reversal blocked — wrong PIN", tone: "red" as const, time: "Yesterday" },
  { text: "Failed PIN attempt on Billing Tablet", tone: "red" as const, time: "Yesterday" },
];

export default function SecuritySettingsPage() {
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [sec, setSec] = useState<SecurityConfig>(DEFAULT_SECURITY);
  const [pwOpen, setPwOpen] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.security ?? {}) as Partial<SecurityConfig>;
    setSec({ ...DEFAULT_SECURITY, ...saved, actions: { ...DEFAULT_SECURITY.actions, ...(saved.actions ?? {}) } });
  }, [hydrated, prefs.security]);

  const update = (partial: Partial<SecurityConfig>) => { const next = { ...sec, ...partial }; setSec(next); patch({ security: next }); };
  const setAction = (key: string, rule: ActionRule) => update({ actions: { ...sec.actions, [key]: rule } });

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Owner PIN */}
        <Card>
          <CardHead icon={<KeyRound size={15} />} title="Owner PIN" sub="Protects money-sensitive actions" action={<Badge tone="green"><ShieldCheck size={11} /> Set</Badge>} />
          <div className="space-y-3 px-5 pb-5">
            <div className="flex items-center gap-3 rounded-[10px] border border-[#eef2f8] px-4 py-3">
              <span className="font-mono text-[18px] tracking-[0.3em] text-[#102347]">•••••</span>
              <div className="flex-1">
                <p className="text-[12px] font-bold text-[#102347]">PIN active</p>
                <p className="text-[11px] text-[#64748b]">Last updated recently</p>
              </div>
              <Badge tone="green">Strong</Badge>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setPwOpen(true)} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-10 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"><KeyRound size={15} /> Change PIN</Button>
            </div>
            <p className="text-[11px] text-[#9aa6bb]">Forgot your PIN? Recover it from your registered owner email/phone on the login screen.</p>
          </div>
        </Card>

        {/* Session & Login Security */}
        <Card>
          <CardHead icon={<Lock size={15} />} title="Session & Login Security" sub="Keep the counter locked down" />
          <div className="px-5 pb-4">
            <RowToggle label="Session timeout" desc="Auto sign-out when idle" pill={
              <Select value={sec.sessionTimeout} onValueChange={(v) => update({ sessionTimeout: v })}>
                <SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["5 minutes", "15 minutes", "30 minutes", "1 hour"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>} />
            <RowToggle label="Auto-lock after inactivity" pill={<Switch checked={sec.autoLock} onCheckedChange={(v) => update({ autoLock: v })} />} />
            <RowToggle label="Biometric login" desc="Fingerprint / face on staff devices" pill={<Switch checked={sec.biometric} onCheckedChange={(v) => update({ biometric: v })} />} />
            <RowToggle label="Two-factor authentication" pill={<Switch checked={sec.twoFactor} onCheckedChange={(v) => update({ twoFactor: v })} />} />
            <RowToggle label="Require login on app start" pill={<Switch checked={sec.requireLoginOnStart} onCheckedChange={(v) => update({ requireLoginOnStart: v })} />} />
            <RowToggle label="Remember this device" pill={<Switch checked={sec.rememberDevice} onCheckedChange={(v) => update({ rememberDevice: v })} />} last />
          </div>
        </Card>
      </div>

      {/* Sensitive Action Protection */}
      <Card>
        <CardHead icon={<ShieldCheck size={15} />} title="Sensitive Action Protection" sub="Which actions require approval & who can approve" />
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
                {ACTIONS.map((a, i) => {
                  const rule = sec.actions[a.key] ?? DEFAULT_ACTION;
                  return (
                    <tr key={a.key} className={i < ACTIONS.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="px-3 py-2.5 font-bold text-[#102347]">{a.label}</td>
                      <td className="px-3 py-2.5 text-center"><div className="flex justify-center"><Switch checked={rule.on} onCheckedChange={(v) => setAction(a.key, { ...rule, on: v })} /></div></td>
                      <td className="px-3 py-2.5">
                        <Select value={rule.approver} onValueChange={(v) => setAction(a.key, { ...rule, approver: v as ActionRule["approver"] })}>
                          <SelectTrigger className="h-8 w-[170px] text-[12px]" disabled={!rule.on}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner only</SelectItem>
                            <SelectItem value="ownerManager">Owner or Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right">{rule.on ? <Badge tone="green">Logged</Badge> : <Badge tone="gray">Off</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#9aa6bb]">Protected actions prompt for the owner PIN at the counter and are written to the audit log.</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Trusted Devices */}
        <Card>
          <CardHead icon={<MonitorSmartphone size={15} />} title="Trusted Devices" sub="Devices that skip re-verification" />
          <div className="px-5 pb-4">
            {[
              { name: "POS Terminal 01", meta: "This device · last login now", current: true },
              { name: "Billing Tablet", meta: "Last login 2h ago", current: false },
              { name: "Owner Mobile", meta: "Last login yesterday", current: false },
            ].map((d, i, arr) => (
              <div key={d.name} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f4f7fb] text-[#536583]"><MonitorSmartphone size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-[#102347]">{d.name}{d.current && <span className="ml-1.5"><Badge tone="blue">Current</Badge></span>}</p>
                  <p className="text-[11px] text-[#64748b]">{d.meta}</p>
                </div>
                <Badge tone="green">Trusted</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Security Logs */}
        <Card>
          <CardHead icon={<AlertTriangle size={15} />} title="Security Logs" sub="Recent security events" />
          <div className="px-5 pb-4">
            {LOGS.map((l, i) => (
              <div key={i} className={`flex items-center gap-3 py-2.5 ${i < LOGS.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.tone === "red" ? "bg-rose-500" : "bg-emerald-500"}`} />
                <p className={`flex-1 text-[12px] font-medium ${l.tone === "red" ? "text-rose-700" : "text-[#344668]"}`}>{l.text}</p>
                <span className="shrink-0 text-[11px] text-[#9aa6bb]">{l.time}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ChangePinDialog open={pwOpen} onOpenChange={setPwOpen} />
    </SettingsShell>
  );
}

const pwSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(6, "Min 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });
type PwData = z.infer<typeof pwSchema>;

function ChangePinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const form = useForm<PwData>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => { form.reset(); toast({ title: "Owner PIN / password updated" }); onOpenChange(false); },
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
            <Button type="submit" disabled={changePassword.isPending} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {changePassword.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
