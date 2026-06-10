import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { BillInputBillType, BillPaymentMode } from "@/lib/api/client";
import { clampAmount } from "../billing-calculations";
import { SPLIT_PAYMENT, type BillTypeSelection, type PaymentSelection } from "../billing-types";

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
  const showPaymentMode =
    billType !== BillInputBillType.udhar_entry && billType !== BillInputBillType.estimate;

  return (
    <div className="space-y-3">
      {/* Payment method header */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Payment Method
      </p>

      {showPaymentMode ? (
        <div className="grid grid-cols-4 gap-2">
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.cash}`}
            icon={
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-lg font-black text-emerald-600 dark:bg-emerald-950/40">
                ₹
              </span>
            }
            label="Cash"
            selected={paymentMode === BillPaymentMode.cash}
            activeClass="border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
            onClick={() => setPaymentMode(BillPaymentMode.cash)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.upi}`}
            icon={
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-950/40">
                <UpiIcon />
              </span>
            }
            label="UPI"
            selected={paymentMode === BillPaymentMode.upi}
            activeClass="border-purple-400 bg-purple-50 dark:bg-purple-950/20"
            onClick={() => setPaymentMode(BillPaymentMode.upi)}
          />
          <PayModeBtn
            testId={`button-payment-${SPLIT_PAYMENT}`}
            icon={
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/40">
                <SplitIcon />
              </span>
            }
            label="Split"
            selected={paymentMode === SPLIT_PAYMENT}
            activeClass="border-blue-400 bg-blue-50 dark:bg-blue-950/20"
            onClick={() => setPaymentMode(SPLIT_PAYMENT)}
          />
          <PayModeBtn
            testId={`button-payment-${BillPaymentMode.credit}`}
            icon={
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-950/40">
                <UdharIcon />
              </span>
            }
            label="Udhar"
            selected={paymentMode === BillPaymentMode.credit}
            activeClass="border-orange-400 bg-orange-50 dark:bg-orange-950/20"
            onClick={() => setPaymentMode(BillPaymentMode.credit)}
          />
        </div>
      ) : null}

      {/* Amount received (cash/UPI mode) */}
      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit ? (
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

      {/* Paid / Udhar summary */}
      <div className="space-y-1.5 rounded-xl border bg-background/70 px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Paid</span>
          <span className="font-semibold">{fmtRs(effectivePaidAmount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Udhar</span>
          <span
            className={creditAmount > 0 ? "font-semibold text-amber-600" : "font-semibold text-emerald-600"}
          >
            {fmtRs(creditAmount)}
          </span>
        </div>
        {advanceAmount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Advance</span>
            <span className="font-semibold text-blue-600">{fmtRs(advanceAmount)}</span>
          </div>
        )}
      </div>
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
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-xs font-bold transition-all ${
        selected ? activeClass : "border-border bg-card hover:bg-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function UpiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-purple-600" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="3" height="3" rx="0.5" />
      <rect x="18" y="14" width="3" height="3" rx="0.5" />
      <rect x="14" y="18" width="3" height="3" rx="0.5" />
      <rect x="18" y="18" width="3" height="3" rx="0.5" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-blue-600" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5" />
      <path d="M8 3H3v5" />
      <path d="M21 3l-7 7-4-4-7 7" />
    </svg>
  );
}

function UdharIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-orange-600" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </svg>
  );
}
