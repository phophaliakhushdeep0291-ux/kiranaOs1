import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Printer, QrCode, ShieldCheck, TimerReset, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelRetailPaymentQr, getRetailPaymentQrBitmap, getRetailPaymentQrStatus, type RetailQrCheckout } from "@/features/core/billing/retail-payment";
import { printQrSlipViaHardwareBridge } from "@/features/core/hardware/local-hardware-bridge";
import { getPrinterConfigSync } from "@/features/core/settings/printer-config";
import { useAppLanguage } from "@/features/core/settings/i18n";

interface RetailDynamicQrDialogProps {
  checkout: RetailQrCheckout | null;
  onConfirmed: (checkout: RetailQrCheckout) => void;
  onClose: () => void;
  /**
   * Fires on every polled status transition, not just the terminal ones the
   * dialog acts on itself. A customer-facing display must stop inviting a scan
   * the moment the QR expires or fails, even though this dialog stays open to
   * explain what happened.
   */
  onStatusChange?: (status: RetailQrCheckout["status"]) => void;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RetailDynamicQrDialog({ checkout, onConfirmed, onClose, onStatusChange }: RetailDynamicQrDialogProps) {
  const { t } = useAppLanguage();
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState(checkout?.status ?? "pending");
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  // A counter printer only reaches the customer's side of the desk through the
  // paired local bridge; browser print dialogs are a cashier-facing fallback.
  const canPrintSlip = getPrinterConfigSync().connection === "bridge";
  const expiresAt = checkout ? new Date(checkout.expiresAt).getTime() : 0;
  const remaining = Math.max(0, expiresAt - now);
  const trustedImage = useMemo(() => {
    try {
      const url = new URL(checkout?.imageUrl || "");
      return url.protocol === "https:" && url.hostname === "rzp.io" ? url.toString() : null;
    } catch {
      return null;
    }
  }, [checkout?.imageUrl]);

  useEffect(() => {
    setStatus(checkout?.status ?? "pending");
    setError(null);
  }, [checkout?.intentId, checkout?.status]);

  useEffect(() => {
    if (!checkout) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [checkout]);

  // Held in a ref so a caller's inline arrow does not re-notify on every render;
  // subscribers should hear about real transitions only.
  const statusChangeRef = useRef(onStatusChange);
  statusChangeRef.current = onStatusChange;
  useEffect(() => { statusChangeRef.current?.(status); }, [status]);

  useEffect(() => {
    if (!checkout || !["creating", "pending"].includes(status)) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getRetailPaymentQrStatus(checkout.intentId);
        if (!active) return;
        setStatus(next.status);
        setError(null);
        if (next.status === "confirmed") {
          onConfirmed({ ...checkout, status: "confirmed", confirmedAt: next.confirmedAt, confirmationSource: next.confirmationSource });
          return;
        }
        if (["failed", "expired", "cancelled"].includes(next.status)) return;
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : t("billing.pay.dynamicQr.statusFailed"));
      }
      if (active) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 800);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [checkout, onConfirmed, status]);

  async function printSlip() {
    if (!checkout || printing) return;
    setPrinting(true);
    setError(null);
    try {
      const printer = getPrinterConfigSync();
      const bitmap = await getRetailPaymentQrBitmap(checkout.intentId);
      await printQrSlipViaHardwareBridge(printer.bridgeUrl, {
        moduleCount: bitmap.moduleCount,
        modules: bitmap.modules,
        amountPaise: bitmap.amountPaise,
        paperSize: printer.paperSize,
        reference: bitmap.reference,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("billing.pay.dynamicQr.printFailed"));
    } finally {
      setPrinting(false);
    }
  }

  async function cancel() {
    if (!checkout || cancelling) return;
    setCancelling(true);
    try {
      await cancelRetailPaymentQr(checkout.intentId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("billing.pay.dynamicQr.closeFailed"));
    } finally {
      setCancelling(false);
    }
  }

  const terminal = ["failed", "expired", "cancelled"].includes(status);
  return (
    <Dialog open={Boolean(checkout)} onOpenChange={(open) => { if (!open) void cancel(); }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={(event) => { if (cancelling) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-12"><QrCode className="text-violet-600" /> {t("billing.pay.dynamicQr.title")}</DialogTitle>
          <DialogDescription>{t("billing.pay.dynamicQr.description")}</DialogDescription>
        </DialogHeader>

        {checkout ? <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-violet-100 bg-violet-50 px-3 py-2.5">
            <div><p className="text-[10px] font-black uppercase tracking-wide text-violet-600">{t("billing.pay.dynamicQr.collect")}</p><p className="text-2xl font-black text-violet-950">₹{(checkout.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div>
            <div className="text-right"><p className="text-xs font-black text-slate-800">{checkout.location.name}</p><p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"><TimerReset size={13} /> {formatCountdown(remaining)}</p></div>
          </div>

          {!terminal && trustedImage ? <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><img src={trustedImage} alt={t("billing.pay.dynamicQr.imageAlt", { amount: (checkout.amountPaise / 100).toFixed(2) })} className="h-56 w-56 max-w-full rounded-xl object-contain" referrerPolicy="no-referrer" /></div> : null}

          {!terminal ? <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><Loader2 className="mt-0.5 animate-spin" size={16} /><div><p className="font-black">{t("billing.pay.dynamicQr.waiting")}</p><p>{t("billing.pay.dynamicQr.waitingHelp")}</p></div></div> : null}
          {status === "confirmed" ? <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-black text-emerald-800"><CheckCircle2 size={18} /> {t("billing.pay.dynamicQr.confirmed")}</div> : null}
          {terminal ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><TriangleAlert className="mt-0.5" size={17} /><div><p className="font-black">{t("billing.pay.dynamicQr.unavailable")}</p><p>{t("billing.pay.dynamicQr.unavailableHelp")}</p></div></div> : null}
          {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">{error}</div> : null}
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><ShieldCheck size={14} className="text-emerald-600" /> {t("billing.pay.dynamicQr.safety")}</div>
        </div> : null}

        <DialogFooter>
          {terminal ? <Button onClick={onClose}>{t("billing.pay.dynamicQr.close")}</Button> : <>
            {canPrintSlip ? <Button variant="outline" className="gap-1.5" disabled={printing || cancelling} onClick={() => void printSlip()}>
              <Printer size={15} /> {printing ? t("billing.pay.dynamicQr.printing") : t("billing.pay.dynamicQr.print")}
            </Button> : null}
            <Button variant="outline" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? t("billing.pay.dynamicQr.closing") : t("billing.pay.dynamicQr.cancel")}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
