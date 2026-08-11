import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, TimerReset, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelCardTerminalCharge, getCardTerminalChargeStatus, type CardTerminalCharge } from "@/features/core/billing/card-terminal";
import { useAppLanguage } from "@/features/core/settings/i18n";

interface CardTerminalDialogProps {
  charge: CardTerminalCharge | null;
  simulated: boolean;
  onApproved: (charge: CardTerminalCharge) => void;
  onClose: () => void;
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
  const remaining = Math.max(0, (charge ? new Date(charge.expiresAt).getTime() : 0) - now);

  useEffect(() => {
    setStatus(charge?.status ?? "pending");
    setFailure(null);
    setError(null);
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
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("billing.pay.cardTerminal.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  }

  const terminal = ["failed", "expired", "cancelled"].includes(status);
  return (
    <Dialog open={Boolean(charge)} onOpenChange={(open) => { if (!open) void cancel(); }}>
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
          {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}</div> : null}
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><ShieldCheck size={14} className="text-emerald-600" /> {t("billing.pay.cardTerminal.safety")}</div>
        </div> : null}

        <DialogFooter>
          {terminal
            ? <Button onClick={onClose}>{t("billing.pay.cardTerminal.close")}</Button>
            : <Button variant="outline" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? t("billing.pay.cardTerminal.cancelling") : t("billing.pay.cardTerminal.cancel")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
