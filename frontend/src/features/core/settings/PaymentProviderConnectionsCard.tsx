import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { useAppLanguage } from "./i18n";
import { Badge, Card, CardHead, Fld } from "./ui";

type Connection = { id: string; provider: string; environment: "test" | "live"; keyIdHint: string; webhookSecretConfigured: boolean; selected: boolean; status: "configured" | "verified" | "disabled"; lastVerifiedAt: string | null; webhookPath: string };
type PendingAction = { title: string; description: string; label: string; run: (ownerPin: string) => Promise<void> };

export function PaymentProviderConnectionsCard() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionsQ = useQuery({ queryKey: ["payment-provider", "connections"], queryFn: () => apiRequest<Connection[]>("/payment-provider/connections"), retry: 1 });
  const razorpay = connectionsQ.data?.find((row) => row.provider === "razorpay");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["payment-provider", "connections"] });
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };
  const approve = (action: PendingAction) => { setError(null); setPending(action); };
  const confirm = async (ownerPin: string) => {
    if (!pending) return;
    setBusy(true); setError(null);
    try { await pending.run(ownerPin); setPending(null); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("settings.payments.actionFailed")); }
    finally { setBusy(false); }
  };
  const save = () => approve({
    title: t("settings.payments.saveTitle"), description: t("settings.payments.saveHelp"), label: t("settings.payments.save"),
    run: async (ownerPin) => {
      await apiRequest("/payment-provider/connections/razorpay", { method: "PUT", ownerPin, body: JSON.stringify({ environment, keyId, keySecret, webhookSecret }) });
      setOpen(false); setKeyId(""); setKeySecret(""); setWebhookSecret("");
      toast({ title: t("settings.payments.saved") });
    },
  });
  const action = (kind: "verify" | "select" | "disable") => approve({
    title: t(`settings.payments.${kind}Title`), description: t(`settings.payments.${kind}Help`), label: t(`settings.payments.${kind}`),
    run: async (ownerPin) => {
      await apiRequest(`/payment-provider/connections/razorpay/${kind}`, { method: "POST", ownerPin, body: "{}" });
      toast({ title: t(`settings.payments.${kind}Done`) });
    },
  });

  return <>
    <Card>
      <CardHead icon={<CreditCard size={15} />} title={t("settings.payments.title")} sub={t("settings.payments.sub")} action={<Button size="sm" onClick={() => setOpen(true)}>{razorpay ? t("settings.payments.replace") : t("settings.payments.connect")}</Button>} />
      <div className="px-5 pb-5">
        {connectionsQ.isLoading ? <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{t("settings.payments.loading")}</div> : !razorpay ? <div className="rounded-xl border border-dashed p-5 text-sm text-slate-600">{t("settings.payments.none")}</div> : <div className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2"><strong>Razorpay</strong><Badge tone={razorpay.environment === "live" ? "red" : "violet"}>{razorpay.environment}</Badge><Badge tone={razorpay.selected ? "green" : razorpay.status === "verified" ? "blue" : "amber"}>{razorpay.selected ? t("settings.payments.selected") : razorpay.status}</Badge></div>
          <p className="font-mono text-xs text-slate-600">{razorpay.keyIdHint}</p>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><p className="font-semibold text-slate-800">{t("settings.payments.webhook")}</p><code className="mt-1 block break-all">{razorpay.webhookPath}</code></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => action("verify")}><ShieldCheck size={14} />{t("settings.payments.verify")}</Button><Button size="sm" disabled={razorpay.status !== "verified" || razorpay.selected} onClick={() => action("select")}><CheckCircle2 size={14} />{t("settings.payments.select")}</Button><Button variant="outline" size="sm" disabled={razorpay.status === "disabled"} onClick={() => action("disable")}>{t("settings.payments.disable")}</Button></div>
        </div>}
      </div>
    </Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t("settings.payments.connectTitle")}</DialogTitle><DialogDescription>{t("settings.payments.connectHelp")}</DialogDescription></DialogHeader><div className="space-y-4"><Fld label={t("settings.payments.environment")}><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}><option value="test">Test</option><option value="live">Live</option></select></Fld><Fld label="Razorpay Key ID"><Input autoComplete="off" value={keyId} onChange={(event) => setKeyId(event.target.value)} /></Fld><Fld label="Razorpay Key Secret"><Input type="password" autoComplete="new-password" value={keySecret} onChange={(event) => setKeySecret(event.target.value)} /></Fld><Fld label="Razorpay Webhook Secret"><Input type="password" autoComplete="new-password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} /></Fld></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("settings.integrations.cancel")}</Button><Button disabled={!keyId || !keySecret || !webhookSecret} onClick={save}>{t("settings.payments.continue")}</Button></DialogFooter></DialogContent></Dialog>
    <OwnerPinModal open={Boolean(pending)} title={pending?.title ?? ""} description={pending?.description} confirmLabel={pending?.label} loading={busy} error={error} onCancel={() => !busy && setPending(null)} onConfirm={({ ownerPin }) => confirm(ownerPin)} />
  </>;
}
