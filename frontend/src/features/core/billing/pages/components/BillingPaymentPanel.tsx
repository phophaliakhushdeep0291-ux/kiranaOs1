import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { BillInputBillType, BillPaymentMode } from "@/lib/api/client";
import { clampAmount, computeChangeDue, suggestCashTenders } from "../billing-calculations";
import { SPLIT_PAYMENT, type BillTypeSelection, type PaymentSelection } from "../billing-types";
import { ArrowLeftRight, Banknote, Gift, Landmark, Loader2, QrCode, ShieldCheck, UserRound } from "lucide-react";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { buildUpiPaymentUri, getPaymentConfigSync } from "@/features/core/settings/payment-config";
import { getPrinterConfigSync } from "@/features/core/settings/printer-config";
import { useAppLanguage } from "@/features/core/settings/i18n";

interface BillingPaymentPanelProps {
  billType: BillTypeSelection;
  paymentMode: PaymentSelection;
  setPaymentMode: Dispatch<SetStateAction<PaymentSelection>>;
  paidAmount: number | "";
  setPaidAmount: Dispatch<SetStateAction<number | "">>;
  splitCashAmount: number | "";
  setSplitCashAmount: Dispatch<SetStateAction<number | "">>;
  splitUpiAmount: number | "";
  setSplitUpiAmount: Dispatch<SetStateAction<number | "">>;
  allowAdvancePayment: boolean;
  setAllowAdvancePayment: Dispatch<SetStateAction<boolean>>;
  grandTotal: number;
  splitCash: number;
  splitUpi: number;
  splitUdharAmount: number;
  effectivePaidAmount: number;
  creditAmount: number;
  advanceAmount: number;
  retailPaymentConfigured: boolean;
  retailPaymentRequired: boolean;
  retailPaymentVerified: boolean;
  retailPaymentLoading: boolean;
  onVerifyRetailPayment: () => void;
  isOnline: boolean;
  giftCardCode: string;
  setGiftCardCode: (value: string) => void;
  giftCardBalance: number | null;
  giftCardAmount: number;
  setGiftCardAmount: (value: number) => void;
  giftCardLoading: boolean;
  giftCardError: string | null;
  onLookupGiftCard: () => void;
}

function fmtRs(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

export function BillingPaymentPanel({
  billType,
  paymentMode,
  setPaymentMode,
  paidAmount,
  setPaidAmount,
  splitCashAmount,
  setSplitCashAmount,
  splitUpiAmount,
  setSplitUpiAmount,
  allowAdvancePayment,
  setAllowAdvancePayment,
  grandTotal,
  splitCash,
  splitUpi,
  splitUdharAmount,
  effectivePaidAmount,
  creditAmount,
  advanceAmount,
  retailPaymentConfigured,
  retailPaymentRequired,
  retailPaymentVerified,
  retailPaymentLoading,
  onVerifyRetailPayment,
  isOnline,
  giftCardCode,
  setGiftCardCode,
  giftCardBalance,
  giftCardAmount,
  setGiftCardAmount,
  giftCardLoading,
  giftCardError,
  onLookupGiftCard,
}: BillingPaymentPanelProps) {
  const { t } = useAppLanguage();
  const [showReceivedAmount, setShowReceivedAmount] = useState(false);
  // Cash-tendered → change-due calculator. Panel-local and informational only:
  // it never changes what the bill records (the shop keeps grandTotal), it just
  // tells the cashier how much cash to hand back.
  const [cashTendered, setCashTendered] = useState<number | "">("");
  // A saved or cleared bill drops grandTotal to 0. Reset the tendered helper so
  // last customer's "change due" can't linger on the next sale's fresh total.
  useEffect(() => {
    if (grandTotal === 0) setCashTendered("");
  }, [grandTotal]);
  const changeDue = typeof cashTendered === "number" ? computeChangeDue(cashTendered, grandTotal) : 0;
  const tenderSuggestions = useMemo(() => suggestCashTenders(grandTotal), [grandTotal]);
  const upiAmount = paymentMode === SPLIT_PAYMENT ? splitUpi : grandTotal;
  const paymentConfig = getPaymentConfigSync();
  const upiUri = useMemo(() => buildUpiPaymentUri({ ...paymentConfig, amount: upiAmount }), [paymentConfig.upiId, paymentConfig.payeeName, upiAmount]);
  const showUpiQr = getPrinterConfigSync().printQr && (paymentMode === BillPaymentMode.upi || (paymentMode === SPLIT_PAYMENT && splitUpi > 0));
  // Estimates are full bills too — they get the same cash/UPI/split/udhar options as a Pakka bill
  // (they only differ by their EST- number + label), so this panel no longer special-cases them.
  const showPaymentMode = billType !== BillInputBillType.udhar_entry;

  return (
    <div className="space-y-3">
      {/* Payment method header */}
      <p className="text-[12px] font-extrabold text-[#13274d]">{t("billing.pay.method")}</p>

      {showPaymentMode ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.cash}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e9fff0] text-[#16a34a]"><Banknote size={17} /></span>}
            label={t("billing.pay.cash")}
            selected={paymentMode === BillPaymentMode.cash}
            activeClass="border-[#b9f0cb] bg-[#effff5] text-[#16a34a]"
            onClick={() => setPaymentMode(BillPaymentMode.cash)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.upi}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f3e8ff] text-[#7c3aed]"><QrCode size={17} /></span>}
            label={t("billing.pay.upi")}
            selected={paymentMode === BillPaymentMode.upi}
            activeClass="border-[#e6d5ff] bg-[#faf5ff] text-[#7c3aed]"
            onClick={() => setPaymentMode(BillPaymentMode.upi)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.bank}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#eaf3ff] text-[var(--brand)]"><Landmark size={17} /></span>}
            label={t("billing.pay.bank")}
            selected={paymentMode === BillPaymentMode.bank}
            activeClass="border-[var(--brand-border)] bg-[#f3f7ff] text-[var(--brand)]"
            onClick={() => setPaymentMode(BillPaymentMode.bank)}
          />
          <PayModeBtn
            testId={`button-payment-${SPLIT_PAYMENT}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#eef4ff] text-[var(--brand)]"><ArrowLeftRight size={17} /></span>}
            label={t("billing.pay.split")}
            selected={paymentMode === SPLIT_PAYMENT}
            activeClass="border-[var(--brand-border)] bg-[#f4f8ff] text-[var(--brand)]"
            onClick={() => setPaymentMode(SPLIT_PAYMENT)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.credit}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fff3e4] text-[#f97316]"><UserRound size={17} /></span>}
            label={t("billing.pay.udhar")}
            selected={paymentMode === BillPaymentMode.credit}
            activeClass="border-[#fed7aa] bg-[#fff7ed] text-[#f97316]"
            onClick={() => setPaymentMode(BillPaymentMode.credit)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.gift_card}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fff1f8] text-[#db2777]"><Gift size={17} /></span>}
            label={t("billing.pay.giftCard")}
            selected={paymentMode === BillPaymentMode.gift_card}
            activeClass="border-[#fbcfe8] bg-[#fdf2f8] text-[#be185d]"
            onClick={() => setPaymentMode(BillPaymentMode.gift_card)}
          />
        </div>
      ) : null}

      {showPaymentMode && paymentMode === BillPaymentMode.gift_card ? (
        <div className="space-y-3 rounded-xl border border-pink-200 bg-pink-50/60 p-3">
          <div><p className="text-xs font-black text-pink-950">{t("billing.pay.gift.title")}</p><p className="mt-0.5 text-[11px] leading-4 text-pink-700">{t("billing.pay.gift.help")}</p></div>
          <div className="flex gap-2"><Input value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40))} placeholder="KOS-XXXX-XXXX-XXXX" className="h-9 bg-white font-mono text-xs" autoComplete="off" /><button type="button" onClick={onLookupGiftCard} disabled={!isOnline || giftCardCode.replace(/[^A-Z0-9]/g, "").length < 10 || giftCardLoading} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-pink-600 px-3 text-xs font-black text-white disabled:opacity-50">{giftCardLoading ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}{t("billing.pay.gift.check")}</button></div>
          {!isOnline ? <p className="text-[11px] font-bold text-amber-700">{t("billing.pay.gift.offline")}</p> : giftCardError ? <p className="text-[11px] font-bold text-rose-700">{giftCardError}</p> : giftCardBalance !== null ? <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-white p-2.5"><p className="text-[10px] font-bold uppercase text-slate-500">{t("billing.pay.gift.available")}</p><p className="mt-0.5 text-base font-black text-pink-700">{fmtRs(giftCardBalance)}</p></div><div><label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{t("billing.pay.gift.useFromCard")}</label><Input type="number" min="0.01" max={Math.min(giftCardBalance, grandTotal)} step="0.01" value={giftCardAmount || ""} onChange={(event) => setGiftCardAmount(clampAmount(Number(event.target.value) || 0, 0, Math.min(giftCardBalance, grandTotal)))} className="h-9 bg-white font-bold" /></div><p className="text-[11px] font-semibold text-slate-600 sm:col-span-2">{giftCardAmount < grandTotal ? t("billing.pay.gift.remainderCash", { amount: fmtRs(grandTotal - giftCardAmount) }) : t("billing.pay.gift.coversBill")}</p></div> : null}
        </div>
      ) : null}

      {showPaymentMode && showUpiQr ? (
        <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3">
          {upiUri ? <div className="flex flex-col items-center gap-3 sm:flex-row"><QrCodeView value={upiUri} size={128} className="shrink-0 rounded-lg border border-purple-100 bg-white p-1" title={t("billing.pay.upi.qrTitle", { amount: upiAmount.toFixed(2) })} /><div><p className="text-sm font-black text-purple-950">{t("billing.pay.upi.scanToPay", { amount: fmtRs(upiAmount) })}</p><p className="mt-1 break-all text-xs font-semibold text-purple-700">{paymentConfig.upiId}</p><p className="mt-2 text-[11px] leading-4 text-purple-700">{t("billing.pay.upi.qrHelp")}</p></div></div> : <div className="flex items-start gap-2 text-xs text-amber-800"><QrCode size={17} className="mt-0.5 shrink-0" /><p><strong>{t("billing.pay.upi.notConfigured")}</strong> {t("billing.pay.upi.notConfiguredHelp")}</p></div>}
        </div>
      ) : null}

      {showPaymentMode && (paymentMode === BillPaymentMode.upi || (paymentMode === SPLIT_PAYMENT && splitUpi > 0)) ? (
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${retailPaymentVerified ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-xs font-black ${retailPaymentVerified ? "text-emerald-800" : "text-slate-800"}`}><ShieldCheck size={15} />{retailPaymentVerified ? t("billing.pay.verify.verified") : retailPaymentConfigured ? t("billing.pay.verify.available") : t("billing.pay.verify.operator")}</p>
            <p className="mt-0.5 text-[11px] text-slate-600">{retailPaymentVerified ? t("billing.pay.verify.verifiedHelp") : retailPaymentRequired ? t("billing.pay.verify.requiredHelp") : retailPaymentConfigured ? t("billing.pay.verify.optionalHelp") : t("billing.pay.verify.noProviderHelp")}</p>
          </div>
          {retailPaymentConfigured && !retailPaymentVerified ? <button type="button" onClick={onVerifyRetailPayment} disabled={retailPaymentLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#0753df] disabled:opacity-60">{retailPaymentLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{t("billing.pay.verify.action")}</button> : null}
        </div>
      ) : null}

      {/* Amount received (cash/UPI mode) */}
      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit && paymentMode !== BillPaymentMode.gift_card && !(showReceivedAmount || typeof paidAmount === "number" || allowAdvancePayment) ? (
        <button type="button" onClick={() => setShowReceivedAmount(true)} className="w-full rounded-[8px] border border-dashed border-[#d7e2f1] py-2 text-[11px] font-semibold text-[#536383] transition-colors hover:border-[#b9cdf6] hover:bg-[#f8fbff] hover:text-[var(--brand)]">
          {t("billing.pay.enterPartial")}
        </button>
      ) : null}

      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit && paymentMode !== BillPaymentMode.gift_card && (showReceivedAmount || typeof paidAmount === "number" || allowAdvancePayment) ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("billing.pay.amountReceived")}
          </label>
          <Input
            data-testid="input-paid-amount"
            type="number"
            inputMode="decimal"
            className="h-10 font-semibold"
            placeholder={fmtRs(grandTotal)}
            value={paidAmount}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : "";
              setPaidAmount(
                typeof next === "number"
                  ? clampAmount(next, 0, allowAdvancePayment ? Math.max(next, grandTotal) : grandTotal)
                  : "",
              );
            }}
          />
          <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allowAdvancePayment}
              onChange={(e) => setAllowAdvancePayment(e.target.checked)}
            />
            {t("billing.pay.extraIsAdvance")}
          </label>
          {advanceAmount > 0 && (
            <p className="mt-1 text-xs text-blue-600">{t("billing.pay.advanceLine", { amount: fmtRs(advanceAmount) })}</p>
          )}
          {typeof paidAmount === "number" && paidAmount >= 0 && grandTotal > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {effectivePaidAmount < grandTotal
                ? t("billing.pay.udharLine", { amount: fmtRs(grandTotal - effectivePaidAmount) })
                : t("billing.pay.paidOk")}
            </p>
          )}
        </div>
      ) : null}

      {/* Cash tendered → change due. Informational: does not change the bill. */}
      {showPaymentMode && paymentMode === BillPaymentMode.cash && grandTotal > 0 ? (
        <div className="rounded-xl border bg-muted/20 p-3" data-testid="cash-change-box">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("billing.pay.cashFromCustomer")}</label>
          <Input
            data-testid="input-cash-tendered"
            type="number"
            inputMode="decimal"
            className="h-10 font-semibold"
            placeholder={fmtRs(grandTotal)}
            value={cashTendered}
            onChange={(e) => setCashTendered(e.target.value ? Number(e.target.value) : "")}
          />
          {tenderSuggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tenderSuggestions.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  data-testid={`tender-chip-${amount}`}
                  onClick={() => setCashTendered(amount)}
                  className="rounded-full border border-[#dbe3ef] bg-white px-2.5 py-1 text-[12px] font-bold text-[#31527e] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  {fmtRs(amount)}
                </button>
              ))}
            </div>
          ) : null}
          {typeof cashTendered === "number" && cashTendered > 0 ? (
            <p className={`mt-2 text-sm font-black ${changeDue > 0 ? "text-emerald-600" : "text-muted-foreground"}`} data-testid="text-change-due">
              {cashTendered < grandTotal
                ? t("billing.pay.shortBy", { amount: fmtRs(grandTotal - cashTendered) })
                : changeDue > 0
                  ? t("billing.pay.changeToReturn", { amount: fmtRs(changeDue) })
                  : t("billing.pay.exactCash")}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Udhar full alert */}
      {paymentMode === BillPaymentMode.credit && showPaymentMode ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          {t("billing.pay.fullToUdhar", { amount: fmtRs(grandTotal) })}
        </div>
      ) : null}

      {/* Split payment inputs */}
      {showPaymentMode && paymentMode === SPLIT_PAYMENT ? (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3" data-testid="split-payment-box">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("billing.pay.cash")}</label>
              <Input
                data-testid="input-split-cash"
                type="number"
                inputMode="decimal"
                className="h-9 font-semibold"
                placeholder="0"
                value={splitCashAmount}
                max={grandTotal}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : "";
                  const cash = typeof next === "number" ? clampAmount(next, 0, grandTotal) : "";
                  setSplitCashAmount(cash);
                  if (typeof cash === "number" && typeof splitUpiAmount === "number") {
                    setSplitUpiAmount(clampAmount(splitUpiAmount, 0, Math.max(0, grandTotal - cash)));
                  }
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("billing.pay.upi")}</label>
              <Input
                data-testid="input-split-upi"
                type="number"
                inputMode="decimal"
                className="h-9 font-semibold"
                placeholder="0"
                value={splitUpiAmount}
                max={Math.max(0, grandTotal - splitCash)}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : "";
                  setSplitUpiAmount(
                    typeof next === "number"
                      ? clampAmount(next, 0, Math.max(0, grandTotal - splitCash))
                      : "",
                  );
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("billing.pay.udharRemaining")}</span>
            <span
              data-testid="text-split-udhar"
              className={
                splitUdharAmount > 0 ? "font-bold text-amber-600" : "font-bold text-emerald-600"
              }
            >
              {fmtRs(splitUdharAmount)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Udhar bill type */}
      {billType === BillInputBillType.udhar_entry ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          {t("billing.pay.fullWillGoToUdhar", { amount: fmtRs(grandTotal) })}
        </div>
      ) : null}

      {/* Paid / Udhar summary — only when there is credit or advance */}
      {(creditAmount > 0 || advanceAmount > 0) && (
        <div className="space-y-1.5 rounded-xl border bg-background/70 px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("billing.pay.paid")}</span>
            <span className="font-semibold">{fmtRs(effectivePaidAmount)}</span>
          </div>
          {creditAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("billing.pay.udhar")}</span>
              <span className="font-semibold text-amber-600">{fmtRs(creditAmount)}</span>
            </div>
          )}
          {advanceAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("billing.pay.advance")}</span>
              <span className="font-semibold text-blue-600">{fmtRs(advanceAmount)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PayModeBtn({
  testId,
  icon,
  label,
  selected,
  activeClass,
  onClick,
}: {
  testId?: string;
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={`flex h-[62px] flex-col items-center justify-center gap-1.5 rounded-[10px] border text-[12px] font-extrabold transition-all ${
        selected ? activeClass : "border-[#dfe8f5] bg-white text-[#536383] hover:bg-[#f7f9fd]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

