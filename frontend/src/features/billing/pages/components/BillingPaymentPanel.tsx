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

function fmt(value: number) {
  return `Rs ${value.toLocaleString("en-IN")}`;
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
  splitUpiAmount: currentSplitUpiAmount,
  splitUdharAmount,
  effectivePaidAmount,
  creditAmount,
  advanceAmount,
}: BillingPaymentPanelProps) {
  const showPaymentMode = billType !== BillInputBillType.udhar_entry && billType !== BillInputBillType.estimate;

  return (
    <>
      {showPaymentMode ? (
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PaymentButton mode={BillPaymentMode.cash} label="Cash" selected={paymentMode === BillPaymentMode.cash} onClick={() => setPaymentMode(BillPaymentMode.cash)} />
            <PaymentButton mode={BillPaymentMode.upi} label="UPI" selected={paymentMode === BillPaymentMode.upi} onClick={() => setPaymentMode(BillPaymentMode.upi)} />
            <PaymentButton mode={BillPaymentMode.credit} label="Udhar" selected={paymentMode === BillPaymentMode.credit} onClick={() => setPaymentMode(BillPaymentMode.credit)} />
            <PaymentButton mode={SPLIT_PAYMENT} label="Split" selected={paymentMode === SPLIT_PAYMENT} onClick={() => setPaymentMode(SPLIT_PAYMENT)} />
          </div>
        </div>
      ) : null}

      {showPaymentMode && paymentMode !== SPLIT_PAYMENT && paymentMode !== BillPaymentMode.credit ? (
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount Received</label>
          <Input
            data-testid="input-paid-amount"
            type="number"
            inputMode="decimal"
            className="h-10 text-sm font-semibold"
            placeholder={fmt(grandTotal)}
            value={paidAmount}
            onChange={(event) => {
              const next = event.target.value ? Number(event.target.value) : "";
              setPaidAmount(typeof next === "number" ? clampAmount(next, 0, allowAdvancePayment ? Math.max(next, grandTotal) : grandTotal) : "");
            }}
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allowAdvancePayment} onChange={(event) => setAllowAdvancePayment(event.target.checked)} />
            Extra is advance
          </label>
          {advanceAmount > 0 ? <p className="mt-1 text-xs text-blue-600">Advance: {fmt(advanceAmount)}</p> : null}
          {typeof paidAmount === "number" && paidAmount >= 0 && grandTotal > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {effectivePaidAmount < grandTotal ? `Udhar: ${fmt(grandTotal - effectivePaidAmount)}` : "Paid amount okay"}
            </p>
          ) : null}
        </div>
      ) : null}

      {paymentMode === BillPaymentMode.credit && showPaymentMode ? (
        <div className="shop-alert shop-alert-warning">
          Full amount {fmt(grandTotal)} will go to udhar.
        </div>
      ) : null}

      {showPaymentMode && paymentMode === SPLIT_PAYMENT ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="split-payment-box">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Cash</label>
              <Input
                data-testid="input-split-cash"
                type="number"
                inputMode="decimal"
                className="h-10 text-sm font-semibold"
                placeholder="0"
                value={splitCashAmount}
                max={grandTotal}
                onChange={(event) => {
                  const next = event.target.value ? Number(event.target.value) : "";
                  const cash = typeof next === "number" ? clampAmount(next, 0, grandTotal) : "";
                  setSplitCashAmount(cash);
                  if (typeof cash === "number" && typeof currentSplitUpiAmount === "number") {
                    setSplitUpiAmount(clampAmount(currentSplitUpiAmount, 0, Math.max(0, grandTotal - cash)));
                  }
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">UPI</label>
              <Input
                data-testid="input-split-upi"
                type="number"
                inputMode="decimal"
                className="h-10 text-sm font-semibold"
                placeholder="0"
                value={currentSplitUpiAmount}
                max={Math.max(0, grandTotal - splitCash)}
                onChange={(event) => {
                  const next = event.target.value ? Number(event.target.value) : "";
                  setSplitUpiAmount(typeof next === "number" ? clampAmount(next, 0, Math.max(0, grandTotal - splitCash)) : "");
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
            <span className="text-muted-foreground">Udhar remaining</span>
            <span data-testid="text-split-udhar" className={splitUdharAmount > 0 ? "font-semibold text-amber-600" : "font-semibold text-emerald-600"}>
              {fmt(splitUdharAmount)}
            </span>
          </div>
        </div>
      ) : null}

      {billType === BillInputBillType.udhar_entry ? (
        <div className="shop-alert shop-alert-warning">
          Full amount {fmt(grandTotal)} will go to udhar.
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border bg-background/70 p-3 text-sm shadow-xs">
        <div className="flex items-center justify-between"><span className="text-muted-foreground">Paid</span><span className="font-semibold">{fmt(effectivePaidAmount)}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">Udhar</span><span className={creditAmount > 0 ? "font-semibold text-amber-600" : "font-semibold text-emerald-600"}>{fmt(creditAmount)}</span></div>
        {advanceAmount > 0 ? <div className="flex items-center justify-between"><span className="text-muted-foreground">Advance</span><span className="font-semibold text-blue-600">{fmt(advanceAmount)}</span></div> : null}
      </div>
    </>
  );
}

function PaymentButton({ mode, label, selected, onClick }: { mode: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      data-testid={`button-payment-${mode}`}
      onClick={onClick}
      className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-bold transition-colors ${
        selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
