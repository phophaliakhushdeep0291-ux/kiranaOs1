import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared";
import { FeatureGate } from "@/features/subscription";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import { CheckCircle, CreditCard, FileText, Loader2, PauseCircle, Printer } from "lucide-react";
import { clampAmount } from "../billing-calculations";
import type { BillTypeSelection, CartItem, HeldBill, PaymentSelection } from "../billing-types";
import { BillingDraftRestore } from "./BillingDraftRestore";
import { BillingPaymentPanel } from "./BillingPaymentPanel";

interface BillingSummaryProps {
  summaryWidth: number;
  onStartSummaryResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isOnline: boolean;
  heldBills: HeldBill[];
  onResumeHeldBill: (id: string) => void;
  billType: BillTypeSelection;
  setBillType: Dispatch<SetStateAction<BillTypeSelection>>;
  customers: Customer[];
  selectedCustomerId: string;
  setSelectedCustomerId: Dispatch<SetStateAction<string>>;
  customerName: string;
  setCustomerName: Dispatch<SetStateAction<string>>;
  customerMobile: string;
  setCustomerMobile: Dispatch<SetStateAction<string>>;
  customerNameInputRef: RefObject<HTMLInputElement>;
  matchingMobileCustomer?: Customer;
  creditAmount: number;
  hasCreditCustomerIdentity: boolean;
  cart: CartItem[];
  subtotal: number;
  safeDiscount: number;
  setDiscount: Dispatch<SetStateAction<number>>;
  grandTotal: number;
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
  splitCash: number;
  splitUpi: number;
  splitUdharAmount: number;
  effectivePaidAmount: number;
  advanceAmount: number;
  lastBillNo: string | null;
  newBillingAllowed: boolean;
  newBillingReason?: string;
  createBillAllowed: boolean;
  confirmBillPending: boolean;
  hasLastPrintableBill: boolean;
  onConfirmBill: () => void;
  onSaveEstimate: () => void;
  onHoldBill: () => void;
  onPrintBill: () => void;
  onSharePdf: () => void;
  onClearCart: () => void;
}

function fmt(value: number) {
  return `Rs ${value.toLocaleString("en-IN")}`;
}

export function BillingSummary({
  summaryWidth,
  onStartSummaryResize,
  isOnline,
  heldBills,
  onResumeHeldBill,
  billType,
  setBillType,
  customers,
  selectedCustomerId,
  setSelectedCustomerId,
  customerName,
  setCustomerName,
  customerMobile,
  setCustomerMobile,
  customerNameInputRef,
  matchingMobileCustomer,
  creditAmount,
  hasCreditCustomerIdentity,
  cart,
  subtotal,
  safeDiscount,
  setDiscount,
  grandTotal,
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
  splitCash,
  splitUpi,
  splitUdharAmount,
  effectivePaidAmount,
  advanceAmount,
  lastBillNo,
  newBillingAllowed,
  newBillingReason,
  createBillAllowed,
  confirmBillPending,
  hasLastPrintableBill,
  onConfirmBill,
  onSaveEstimate,
  onHoldBill,
  onPrintBill,
  onSharePdf,
  onClearCart,
}: BillingSummaryProps) {
  return (
    <div
      className="billing-summary-panel relative flex w-full shrink-0 flex-col lg:w-auto"
      style={{ width: summaryWidth, maxWidth: "100%" }}
      data-testid="bill-summary-panel"
    >
      <div
        data-testid="bill-summary-resize-handle"
        title="Drag to resize bill summary"
        onMouseDown={onStartSummaryResize}
        className="absolute left-0 top-0 z-20 hidden h-full w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 lg:block"
      />

      <div className="flex-1 space-y-4 overflow-auto p-3 sm:p-4">
        <div className="overflow-hidden rounded-lg border bg-primary text-primary-foreground shadow-sm">
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide opacity-80">Bill total</p>
              <StatusBadge tone={isOnline ? "success" : "warning"} className="border-white/20 bg-white/15 text-white">
                {isOnline ? "Cloud ready" : "Local safe"}
              </StatusBadge>
            </div>
            <p className="mt-2 break-words text-3xl font-black tracking-tight" data-testid="text-total">
              {fmt(grandTotal)}
            </p>
            <p className="mt-1 text-xs opacity-80">{cart.length} line item{cart.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        <BillingDraftRestore heldBills={heldBills} onResumeHeldBill={onResumeHeldBill} />

        <section className="premium-panel-muted space-y-3 p-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Bill Type</label>
            <Select value={billType} onValueChange={(value) => setBillType(value as BillTypeSelection)}>
              <SelectTrigger data-testid="select-bill-type" className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={BillInputBillType.normal_sale}>Normal Sale</SelectItem>
                <SelectItem value={BillInputBillType.udhar_entry}>Udhar</SelectItem>
                <SelectItem value={BillInputBillType.gst_invoice}>GST Invoice</SelectItem>
                <SelectItem value={BillInputBillType.estimate}>Estimate</SelectItem>
              </SelectContent>
            </Select>
            {billType === BillInputBillType.estimate ? (
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setBillType(BillInputBillType.normal_sale)}>
                Convert estimate to bill
              </Button>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</label>
            <Select value={selectedCustomerId} onValueChange={(value) => {
              setSelectedCustomerId(value);
              if (value === "walk_in") {
                setCustomerName("");
                setCustomerMobile("");
                return;
              }
              const customer = customers.find((entry) => entry.id === value);
              if (customer) {
                setCustomerName(customer.name);
                setCustomerMobile(customer.mobile ?? "");
              }
            }}>
              <SelectTrigger data-testid="select-customer" className="h-10"><SelectValue placeholder="Walk-in" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="walk_in">Walk-in</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}{customer.mobile ? ` · ${customer.mobile}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomerId === "walk_in" ? (
              <>
                <Input
                  ref={customerNameInputRef}
                  data-testid="input-customer-name"
                  className="mt-2 h-10 text-sm"
                  placeholder="Customer name for udhar"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                />
                <Input
                  data-testid="input-customer-mobile"
                  className="mt-2 h-10 text-sm"
                  inputMode="numeric"
                  placeholder="Mobile number"
                  value={customerMobile}
                  onChange={(event) => setCustomerMobile(event.target.value.replace(/\D/g, "").slice(0, 15))}
                />
                {matchingMobileCustomer ? (
                  <p data-testid="text-mobile-customer-match" className="mt-1 text-xs text-blue-600">
                    Matches {matchingMobileCustomer.name}.
                  </p>
                ) : null}
                {(creditAmount > 0 || billType === BillInputBillType.udhar_entry) && !hasCreditCustomerIdentity ? (
                  <p className="mt-1 text-xs text-amber-600">Customer name and mobile are required for udhar.</p>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <section className="premium-panel-muted space-y-2 p-3">
          <SummaryLine label={`Subtotal (${cart.length})`} value={subtotal} testId="text-subtotal" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Discount</span>
            <div className="flex items-center gap-1">
              <span>Rs</span>
              <input
                data-testid="input-discount"
                type="number"
                min={0}
                max={subtotal}
                value={safeDiscount === 0 ? "" : safeDiscount}
                onChange={(event) => setDiscount(clampAmount(Number(event.target.value) || 0, 0, subtotal))}
                className="w-24 rounded border bg-background px-2 py-1 text-right text-sm"
                placeholder="0"
              />
            </div>
          </div>
          <div className="flex justify-between border-t pt-2 text-lg font-black">
            <span>Total</span>
            <span className="text-primary">{fmt(grandTotal)}</span>
          </div>
        </section>

        <section className="premium-panel-muted space-y-3 p-3">
          <BillingPaymentPanel
            billType={billType}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            paidAmount={paidAmount}
            setPaidAmount={setPaidAmount}
            splitCashAmount={splitCashAmount}
            setSplitCashAmount={setSplitCashAmount}
            splitUpiAmount={splitUpiAmount}
            setSplitUpiAmount={setSplitUpiAmount}
            allowAdvancePayment={allowAdvancePayment}
            setAllowAdvancePayment={setAllowAdvancePayment}
            grandTotal={grandTotal}
            splitCash={splitCash}
            splitUpi={splitUpi}
            splitUdharAmount={splitUdharAmount}
            effectivePaidAmount={effectivePaidAmount}
            creditAmount={creditAmount}
            advanceAmount={advanceAmount}
          />
        </section>

        {lastBillNo ? (
          <div className="shop-alert shop-alert-success flex items-center gap-2">
            <CheckCircle size={14} /><span>Last bill: {lastBillNo}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t bg-card/95 p-3 shadow-[0_-12px_24px_rgba(15,23,42,0.04)] sm:p-4">
        {!newBillingAllowed ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {newBillingReason} Old bills and customers remain viewable.
          </div>
        ) : null}
        <Button
          data-testid="button-confirm-bill"
          className="h-14 w-full text-base font-black shadow-md"
          onClick={onConfirmBill}
          disabled={confirmBillPending || cart.length === 0 || !newBillingAllowed || !createBillAllowed}
        >
          {confirmBillPending ? (
            <><Loader2 size={18} className="mr-2 animate-spin" />Saving...</>
          ) : (
            <><CreditCard size={18} className="mr-2" />Confirm · {fmt(grandTotal)}</>
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onSaveEstimate} disabled={confirmBillPending || cart.length === 0}>
            <FileText size={15} className="mr-1" />Estimate
          </Button>
          <Button variant="outline" onClick={onHoldBill} disabled={cart.length === 0}>
            <PauseCircle size={15} className="mr-1" />Hold
          </Button>
          <Button variant="outline" onClick={onPrintBill} disabled={cart.length === 0 && !hasLastPrintableBill}>
            <Printer size={15} className="mr-1" />Print
          </Button>
          <FeatureGate featureName="pdf_bill_share" fallback={<Button variant="outline" disabled>Share/PDF locked</Button>}>
            <Button variant="outline" onClick={onSharePdf} disabled={cart.length === 0 && !hasLastPrintableBill}>Share/PDF</Button>
          </FeatureGate>
        </div>
        {cart.length > 0 ? (
          <button
            data-testid="button-clear-cart"
            onClick={onClearCart}
            className="w-full rounded-lg py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Clear cart
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SummaryLine({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId}>{fmt(value)}</span>
    </div>
  );
}
