import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FeatureGate } from "@/features/subscription";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import {
  CheckCircle,
  CreditCard,
  FileText,
  Loader2,
  PauseCircle,
  Printer,
  Smartphone,
  User,
} from "lucide-react";
import { clampAmount } from "../billing-calculations";
import type { BillTypeSelection, CartItem, HeldBill, PaymentSelection } from "../billing-types";
import { SPLIT_PAYMENT } from "../billing-types";
import { BillingCart } from "./BillingCart";
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
  /* cart item callbacks (for integrated cart view) */
  onUpdateQty: (productId: string, qty: number) => void;
  onUpdateRate: (productId: string, rate: number) => void;
  onUpdateUnit: (productId: string, unit: string) => void;
  onRemoveItem: (productId: string) => void;
}

function fmtRs(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
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
  onUpdateQty,
  onUpdateRate,
  onUpdateUnit,
  onRemoveItem,
}: BillingSummaryProps) {
  return (
    <div
      className="relative flex w-full shrink-0 flex-col border-t bg-card lg:h-full lg:w-auto lg:border-l lg:border-t-0"
      style={{ width: summaryWidth, maxWidth: "100%" }}
      data-testid="bill-summary-panel"
    >
      {/* Resize handle */}
      <div
        data-testid="bill-summary-resize-handle"
        title="Drag to resize"
        onMouseDown={onStartSummaryResize}
        className="absolute left-0 top-0 z-20 hidden h-full w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/30 lg:block"
      />

      {/* ── HEADER: total + bill type ── */}
      <div className="shrink-0 border-b bg-[hsl(var(--sidebar-bg))] p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest opacity-70">Bill Total</p>
            <p
              className="mt-0.5 text-3xl font-black tracking-tight tabular-nums"
              data-testid="text-total"
            >
              {fmtRs(grandTotal)}
            </p>
            <p className="mt-0.5 text-xs opacity-60">
              {cart.length} item{cart.length !== 1 ? "s" : ""} · {isOnline ? "Cloud ready" : "Local safe"}
            </p>
          </div>
          <div className="shrink-0">
            <Select
              value={billType}
              onValueChange={(v) => setBillType(v as BillTypeSelection)}
            >
              <SelectTrigger
                data-testid="select-bill-type"
                className="h-8 border-white/20 bg-white/10 text-xs font-semibold text-white hover:bg-white/20"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BillInputBillType.normal_sale}>Normal Sale</SelectItem>
                <SelectItem value={BillInputBillType.udhar_entry}>Udhar</SelectItem>
                <SelectItem value={BillInputBillType.gst_invoice}>GST Invoice</SelectItem>
                <SelectItem value={BillInputBillType.estimate}>Estimate</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── SCROLLABLE BODY: customer + held bills + cart + totals + payment ── */}
      <ScrollArea className="flex-1">
        <div className="space-y-0 divide-y">
          {/* Held bills restore */}
          {heldBills.length > 0 && (
            <div className="p-3">
              <BillingDraftRestore heldBills={heldBills} onResumeHeldBill={onResumeHeldBill} />
            </div>
          )}

          {/* Customer section */}
          <div className="p-3">
            <div className="mb-2 flex items-center gap-2">
              <User size={13} className="text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Customer
              </span>
              <kbd className="ml-auto rounded border bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                F6
              </kbd>
            </div>
            <Select
              value={selectedCustomerId}
              onValueChange={(value) => {
                setSelectedCustomerId(value);
                if (value === "walk_in") {
                  setCustomerName("");
                  setCustomerMobile("");
                  return;
                }
                const customer = customers.find((c) => c.id === value);
                if (customer) {
                  setCustomerName(customer.name);
                  setCustomerMobile(customer.mobile ?? "");
                }
              }}
            >
              <SelectTrigger data-testid="select-customer" className="h-9 text-sm">
                <SelectValue placeholder="Walk-in customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk_in">Walk-in customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.mobile ? ` · ${c.mobile}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedCustomerId === "walk_in" && (
              <div className="mt-2 space-y-2">
                <Input
                  ref={customerNameInputRef}
                  data-testid="input-customer-name"
                  className="h-9 text-sm"
                  placeholder="Customer name (for udhar)"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                <Input
                  data-testid="input-customer-mobile"
                  className="h-9 text-sm"
                  inputMode="numeric"
                  placeholder="Mobile number"
                  value={customerMobile}
                  onChange={(e) =>
                    setCustomerMobile(e.target.value.replace(/\D/g, "").slice(0, 15))
                  }
                />
                {matchingMobileCustomer && (
                  <p
                    data-testid="text-mobile-customer-match"
                    className="text-xs text-blue-600"
                  >
                    Matches {matchingMobileCustomer.name}
                  </p>
                )}
                {(creditAmount > 0 || billType === BillInputBillType.udhar_entry) &&
                  !hasCreditCustomerIdentity && (
                    <p className="text-xs text-amber-600">
                      Name + mobile required for udhar billing.
                    </p>
                  )}
              </div>
            )}
          </div>

          {/* Cart items */}
          <div className="px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Items
              </span>
              <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {cart.length}
              </span>
            </div>
            <BillingCart
              cart={cart}
              onUpdateQty={onUpdateQty}
              onUpdateRate={onUpdateRate}
              onUpdateUnit={onUpdateUnit}
              onRemoveItem={onRemoveItem}
            />
          </div>

          {/* Totals + discount */}
          <div className="space-y-2 p-3">
            <TotalRow label={`Subtotal (${cart.length})`} value={subtotal} testId="text-subtotal" />
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Discount</span>
                <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-semibold">F4</kbd>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">₹</span>
                <input
                  data-testid="input-discount"
                  type="number"
                  min={0}
                  max={subtotal}
                  value={safeDiscount === 0 ? "" : safeDiscount}
                  onChange={(e) =>
                    setDiscount(clampAmount(Number(e.target.value) || 0, 0, subtotal))
                  }
                  className="w-20 rounded border bg-background px-2 py-1 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-base font-black">Total</span>
              <span className="text-base font-black text-primary">{fmtRs(grandTotal)}</span>
            </div>
          </div>

          {/* Payment panel */}
          <div className="p-3">
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
          </div>

          {/* Last bill saved badge */}
          {lastBillNo && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle size={14} />
              <span>Last bill: {lastBillNo}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── STICKY ACTION BAR ── */}
      <div className="shrink-0 space-y-2 border-t bg-card p-3 shadow-[0_-8px_20px_rgba(0,0,0,0.06)]">
        {!newBillingAllowed && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {newBillingReason} Old bills remain viewable.
          </div>
        )}

        {/* Primary save button */}
        <Button
          data-testid="button-confirm-bill"
          className="h-14 w-full gap-2 text-base font-black shadow-md"
          onClick={onConfirmBill}
          disabled={
            confirmBillPending || cart.length === 0 || !newBillingAllowed || !createBillAllowed
          }
        >
          {confirmBillPending ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <CreditCard size={18} />
              Save Bill · {fmtRs(grandTotal)}
            </>
          )}
        </Button>
        <p className="text-center text-[10px] text-muted-foreground">
          Ctrl+S or F12 to save
        </p>

        {/* Secondary actions */}
        <div className="grid grid-cols-4 gap-1.5">
          <SecondaryBtn
            onClick={onSaveEstimate}
            disabled={confirmBillPending || cart.length === 0}
            icon={<FileText size={13} />}
            label="Estimate"
          />
          <SecondaryBtn
            onClick={onHoldBill}
            disabled={cart.length === 0}
            icon={<PauseCircle size={13} />}
            label="Hold"
            shortcut="F9"
          />
          <SecondaryBtn
            onClick={onPrintBill}
            disabled={cart.length === 0 && !hasLastPrintableBill}
            icon={<Printer size={13} />}
            label="Print"
          />
          <FeatureGate
            featureName="pdf_bill_share"
            fallback={
              <SecondaryBtn disabled icon={<Smartphone size={13} />} label="Share" />
            }
          >
            <SecondaryBtn
              onClick={onSharePdf}
              disabled={cart.length === 0 && !hasLastPrintableBill}
              icon={<Smartphone size={13} />}
              label="Share"
            />
          </FeatureGate>
        </div>

        {cart.length > 0 && (
          <button
            data-testid="button-clear-cart"
            onClick={onClearCart}
            className="w-full rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Clear cart
          </button>
        )}
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId?: string;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId}>{fmtRs(value)}</span>
    </div>
  );
}

function SecondaryBtn({
  onClick,
  disabled,
  icon,
  label,
  shortcut,
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-lg border bg-background py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <span className="text-[9px] text-muted-foreground">{shortcut}</span>
      )}
    </button>
  );
}

