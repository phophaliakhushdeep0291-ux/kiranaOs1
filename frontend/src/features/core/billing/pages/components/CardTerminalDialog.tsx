import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, TimerReset, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { cancelCardTerminalCharge, getCardTerminalChargeStatus, reconcileCardTerminalCharge, type CardTerminalCharge, type CardTerminalStatus } from "@/features/core/billing/card-terminal";
import { useAppLanguage } from "@/features/core/settings/i18n";

interface CardTerminalDialogProps {
  charge: CardTerminalCharge | null;
  simulated: boolean;
  onApproved: (charge: CardTerminalCharge) => void;
  onClose: (status: CardTerminalStatus) => void;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CardTerminalDialog({ charge, simulated, onApproved, onClose }: CardTerminalDialogProps) {
  const { t } = useAppLanguage();
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<CardTerminalCharge["status"]>(charge?.status ?? "pending");
  const [failure, setFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reconcileOutcome, setReconcileOutcome] = useState<"charged" | "not_charged" | null>(null);
  const [providerPaymentId, setProviderPaymentId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const remaining = Math.max(0, (charge ? new Date(charge.expiresAt).getTime() : 0) - now);

  useEffect(() => {
    setStatus(charge?.status ?? "pending");
    setFailure(null);
    setError(null);
    setReconcileOutcome(null);
    setProviderPaymentId("");
    setReconcileError(null);
  }, [charge?.intentId, charge?.status]);

  useEffect(() => {
    if (!charge) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [charge]);

  useEffect(() => {
    if (!charge || !["creating", "pending"].includes(status)) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getCardTerminalChargeStatus(charge.intentId);
        if (!active) return;
        setStatus(next.status);
        setError(null);
        if (next.status === "confirmed") {
          onApproved({ ...charge, ...next });
          return;
        }
        if (["failed", "expired", "cancelled"].includes(next.status)) {
          setFailure(next.failureReason ?? null);
          return;
        }
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : t("billing.pay.cardTerminal.statusFailed"));
      }
      if (active) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 800);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [charge, onApproved, status]);

  async function cancel() {
    if (!charge || cancelling) return;
    setCancelling(true);
    try {
      await cancelCardTerminalCharge(charge.intentId);
      onClose("cancelled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("billing.pay.cardTerminal.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  }

  function closeOrCancel() {
    if (status === "uncertain" || ["failed", "expired", "cancelled"].includes(status)) onClose(status);
    else void cancel();
  }

  async function reconcile(ownerPin: string, reason: string) {
    if (!charge || !reconcileOutcome || reconciling) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      const next = await reconcileCardTerminalCharge(charge.intentId, {
        outcome: reconcileOutcome,
        ...(reconcileOutcome === "charged" ? { providerPaymentId: providerPaymentId.trim() } : {}),
        ownerPin,
        reason,
      });
      setStatus(next.status);
      setReconcileOutcome(null);
      if (next.status === "confirmed") onApproved({ ...charge, ...next });
      else onClose(next.status);
    } catch (cause) {
      setReconcileError(cause instanceof Error ? cause.message : t("billing.pay.cardTerminal.reconcileFailed"));
    } finally {
      setReconciling(false);
    }
  }

  const terminal = ["failed", "expired", "cancelled"].includes(status);
  const uncertain = status === "uncertain";
  return (<>
    <Dialog open={Boolean(charge)} onOpenChange={(open) => { if (!open) closeOrCancel(); }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={(event) => { if (cancelling) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-12"><CreditCard className="text-blue-600" /> {t("billing.pay.cardTerminal.title")}</DialogTitle>
          <DialogDescription>{t("billing.pay.cardTerminal.description")}</DialogDescription>
        </DialogHeader>

        {charge ? <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
            <div><p className="text-[10px] font-black uppercase tracking-wide text-blue-600">{t("billing.pay.cardTerminal.collect")}</p><p className="text-2xl font-black text-blue-950">₹{(charge.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div>
            <div className="text-right"><p className="text-xs font-black text-slate-800">{charge.location.name}</p><p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"><TimerReset size={13} /> {formatCountdown(remaining)}</p></div>
          </div>

          {simulated ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-black text-amber-900">{t("billing.pay.cardTerminal.simulated")}</div> : null}

          {!terminal && status !== "confirmed" ? <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><Loader2 className="mt-0.5 animate-spin" size={16} /><div><p className="font-black">{t("billing.pay.cardTerminal.waiting")}</p><p>{t("billing.pay.cardTerminal.waitingHelp")}</p></div></div> : null}
          {status === "confirmed" ? <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-800"><CheckCircle2 size={18} /> {t("billing.pay.cardTerminal.approved")}</div> : null}
          {terminal ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><TriangleAlert className="mt-0.5" size={17} /><div><p className="font-black">{t("billing.pay.cardTerminal.declined")}</p><p>{failure ?? t("billing.pay.cardTerminal.declinedHelp")}</p></div></div> : null}
          {uncertain ? <div role="alert" className="space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-950">
            <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 shrink-0" size={17} /><div><p className="font-black">{t("billing.pay.cardTerminal.uncertain")}</p><p className="mt-1 leading-5">{t("billing.pay.cardTerminal.uncertainHelp")}</p></div></div>
            <div className="space-y-1.5">
              <Label htmlFor="terminal-provider-reference">{t("billing.pay.cardTerminal.providerReference")}</Label>
              <Input id="terminal-provider-reference" value={providerPaymentId} onChange={(event) => setProviderPaymentId(event.target.value.slice(0, 100))} placeholder={t("billing.pay.cardTerminal.providerReferencePlaceholder")} />
            </div>
          </div> : null}
          {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}</div> : null}
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><ShieldCheck size={14} className="text-emerald-600" /> {t("billing.pay.cardTerminal.safety")}</div>
        </div> : null}

        <DialogFooter>
          {uncertain
            ? <div className="grid w-full gap-2 sm:grid-cols-3">
                <Button variant="ghost" onClick={() => onClose("uncertain")}>{t("billing.pay.cardTerminal.close")}</Button>
                <Button variant="outline" onClick={() => setReconcileOutcome("not_charged")}>{t("billing.pay.cardTerminal.notCharged")}</Button>
                <Button disabled={providerPaymentId.trim().length < 3} onClick={() => setReconcileOutcome("charged")}>{t("billing.pay.cardTerminal.charged")}</Button>
              </div>
            : terminal
            ? <Button onClick={() => onClose(status)}>{t("billing.pay.cardTerminal.close")}</Button>
            : <Button variant="outline" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? t("billing.pay.cardTerminal.cancelling") : t("billing.pay.cardTerminal.cancel")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <OwnerPinModal
      open={Boolean(reconcileOutcome)}
      title={t(reconcileOutcome === "charged" ? "billing.pay.cardTerminal.confirmCharged" : "billing.pay.cardTerminal.confirmNotCharged")}
      description={t("billing.pay.cardTerminal.reconcileHelp")}
      confirmLabel={t("billing.pay.cardTerminal.reconcile")}
      reasonRequired
      loading={reconciling}
      error={reconcileError}
      onCancel={() => { if (!reconciling) { setReconcileOutcome(null); setReconcileError(null); } }}
      onConfirm={({ ownerPin, reason }) => reconcile(ownerPin, reason)}
    />
  </>);
}
