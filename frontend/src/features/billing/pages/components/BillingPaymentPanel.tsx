import { useState, type Dispatch, type SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { BillInputBillType, BillPaymentMode } from "@/lib/api/client";
import { clampAmount } from "../billing-calculations";
import { SPLIT_PAYMENT, type BillTypeSelection, type PaymentSelection } from "../billing-types";
import { ArrowLeftRight, Banknote, FileText, QrCode, UserRound } from "lucide-react";

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
}: BillingPaymentPanelProps) {
  const [showReceivedAmount, setShowReceivedAmount] = useState(false);
  if (billType === BillInputBillType.estimate) {
    return (
      <div className="space-y-3" data-testid="estimate-payment-panel">
        <p className="text-[12px] font-extrabold text-[#13274d]">Payment Method</p>
        <div className="flex h-[62px] items-center gap-3 rounded-[10px] border border-[#d8c7ff] bg-[#fbf8ff] px-3 text-[#6d3df0]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f1edff]">
            <FileText size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-black">Estimate Bill</span>
            <span className="block truncate text-[10px] font-semibold text-[#6b7895]">No payment saved</span>
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-[#6d3df0] shadow-sm">
            Quote
          </span>
        </div>
      </div>
    );
  }
  const showPaymentMode = billType !== BillInputBillType.udhar_entry;

  return (
    <div className="space-y-3">
      {/* Payment method header */}
      <p className="text-[12px] font-extrabold text-[#13274d]">Payment Method</p>

      {showPaymentMode ? (
        <div className="grid grid-cols-4 gap-2">
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.cash}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e9fff0] text-[#16a34a]"><Banknote size={17} /></span>}
            label="Cash"
            selected={paymentMode === BillPaymentMode.cash}
            activeClass="border-[#b9f0cb] bg-[#effff5] text-[#16a34a]"
            onClick={() => setPaymentMode(BillPaymentMode.cash)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.upi}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f3e8ff] text-[#7c3aed]"><QrCode size={17} /></span>}
            label="UPI"
            selected={paymentMode === BillPaymentMode.upi}
            activeClass="border-[#e6d5ff] bg-[#faf5ff] text-[#7c3aed]"
            onClick={() => setPaymentMode(BillPaymentMode.upi)}
          />
          <PayModeBtn
            testId={`button-payment-${SPLIT_PAYMENT}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb]"><ArrowLeftRight size={17} /></span>}
            label="Split"
            selected={paymentMode === SPLIT_PAYMENT}
            activeClass="border-[#cfe0ff] bg-[#f4f8ff] text-[#2563eb]"
            onClick={() => setPaymentMode(SPLIT_PAYMENT)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.credit}`}
            icon={<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fff3e4] text-[#f97316]"><UserRound size={17} /></span>}
            label="Udhar"
            selected={paymentMode === BillPaymentMode.credit}
            activeClass="border-[#fed7aa] bg-[#fff7ed] text-[#f97316]"
            onClick={() => setPaymentMode(BillPaymentMode.credit)}
          />
        </div>
      ) : null}

      {/* Amount received (cash/UPI mode) */}
      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit && !(showReceivedAmount || typeof paidAmount === "number" || allowAdvancePayment) ? (
        <button type="button" onClick={() => setShowReceivedAmount(true)} className="w-full rounded-[8px] border border-dashed border-[#d7e2f1] py-2 text-[11px] font-semibold text-[#536383] transition-colors hover:border-[#b9cdf6] hover:bg-[#f8fbff] hover:text-[#075fff]">
          Enter partial or advance payment
        </button>
      ) : null}

      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit && (showReceivedAmount || typeof paidAmount === "number" || allowAdvancePayment) ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Amount Received
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
            Extra is advance
          </label>
          {advanceAmount > 0 && (
            <p className="mt-1 text-xs text-blue-600">Advance: {fmtRs(advanceAmount)}</p>
          )}
          {typeof paidAmount === "number" && paidAmount >= 0 && grandTotal > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {effectivePaidAmount < grandTotal
                ? `Udhar: ${fmtRs(grandTotal - effectivePaidAmount)}`
                : "Paid amount OK"}
            </p>
          )}
        </div>
      ) : null}

      {/* Udhar full alert */}
      {paymentMode === BillPaymentMode.credit && showPaymentMode ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          Full amount {fmtRs(grandTotal)} goes to Udhar.
        </div>
      ) : null}

      {/* Split payment inputs */}
      {showPaymentMode && paymentMode === SPLIT_PAYMENT ? (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3" data-testid="split-payment-box">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Cash</label>
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
              <label className="mb-1 block text-xs font-medium text-muted-foreground">UPI</label>
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
            <span className="text-muted-foreground">Udhar remaining</span>
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
          Full amount {fmtRs(grandTotal)} will go to Udhar.
        </div>
      ) : null}

      {/* Paid / Udhar summary — only when there is credit or advance */}
      {(creditAmount > 0 || advanceAmount > 0) && (
        <div className="space-y-1.5 rounded-xl border bg-background/70 px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Paid</span>
            <span className="font-semibold">{fmtRs(effectivePaidAmount)}</span>
          </div>
          {creditAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Udhar</span>
              <span className="font-semibold text-amber-600">{fmtRs(creditAmount)}</span>
            </div>
          )}
          {advanceAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Advance</span>
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

