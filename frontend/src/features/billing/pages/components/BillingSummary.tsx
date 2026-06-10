import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FeatureGate } from "@/features/subscription";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import {
  CheckCircle,
  ChevronRight,
  CreditCard,
  FileText,
  Loader2,
  PauseCircle,
  Printer,
  Smartphone,
  Tag,
  User,
} from "lucide-react";
import { clampAmount } from "../billing-calculations";
import type { BillTypeSelection, CartItem, HeldBill, PaymentSelection } from "../billing-types";
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
  /* GST calculation (informational — grandTotal unchanged) */
  const totalGst = cart.reduce((sum, item) => {
    const rate = item.product.gstRate ?? 0;
    if (rate <= 0) return sum;
    return sum + Math.round(item.quantity * item.rate * rate) / 100;
  }, 0);

  const selectedCustomerName = (() => {
    if (selectedCustomerId !== "walk_in") {
      return customers.find((c) => c.id === selectedCustomerId)?.name ?? "Customer";
    }
    return customerName.trim() || "Walk-in Customer";
  })();

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

      {/* ── Scrollable body ── */}
      <ScrollArea className="flex-1">
        <div className="divide-y">
          {/* Customer row */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <User size={15} />
            </span>
            <div className="min-w-0 flex-1">
              {selectedCustomerId === "walk_in" && !customerName ? (
                <p className="text-sm font-semibold text-foreground">Walk-in Customer</p>
              ) : (
                <p className="truncate text-sm font-semibold text-foreground">{selectedCustomerName}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {selectedCustomerId === "walk_in" ? "No customer linked" : "Saved customer"}
              </p>
            </div>
            <button
              onClick={() => {}}
              className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
            >
              Change <ChevronRight size={12} />
            </button>
          </div>

          {/* Held bills restore */}
          {heldBills.length > 0 && (
            <div className="px-4 py-2">
              <BillingDraftRestore heldBills={heldBills} onResumeHeldBill={onResumeHeldBill} />
            </div>
          )}

          {/* Bill type selector */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Bill type</span>
            <Select
              value={billType}
              onValueChange={(v) => setBillType(v as BillTypeSelection)}
            >
              <SelectTrigger
                data-testid="select-bill-type"
                className="h-8 flex-1 text-xs font-semibold"
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

          {/* Customer name/mobile inputs (walk-in only) */}
          {selectedCustomerId === "walk_in" && (
            <div className="space-y-2 px-4 py-3">
              <Select
                value={selectedCustomerId}
                onValueChange={(value) => {
                  setSelectedCustomerId(value);
                  if (value === "walk_in") {
                    setCustomerName("");
                    setCustomerMobile("");
                    return;
                  }
                  const c = customers.find((x) => x.id === value);
                  if (c) {
                    setCustomerName(c.name);
                    setCustomerMobile(c.mobile ?? "");
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
              <div className="grid grid-cols-2 gap-2">
                <Input
                  ref={customerNameInputRef}
                  data-testid="input-customer-name"
                  className="h-9 text-sm"
                  placeholder="Name (udhar)"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                <Input
                  data-testid="input-customer-mobile"
                  className="h-9 text-sm"
                  inputMode="numeric"
                  placeholder="Mobile"
                  value={customerMobile}
                  onChange={(e) =>
                    setCustomerMobile(e.target.value.replace(/\D/g, "").slice(0, 15))
                  }
                />
              </div>
              {matchingMobileCustomer && (
                <p data-testid="text-mobile-customer-match" className="text-xs text-blue-600">
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

          {/* Cart items */}
          <div className="px-4 py-3">
            <BillingCart
              cart={cart}
              onUpdateQty={onUpdateQty}
              onUpdateRate={onUpdateRate}
              onUpdateUnit={onUpdateUnit}
              onRemoveItem={onRemoveItem}
            />
            {cart.length > 0 && (
              <button className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                + Add more items
                <span className="ml-auto text-muted-foreground">{cart.length} Item{cart.length !== 1 ? "s" : ""}</span>
              </button>
            )}
          </div>

          {/* Order summary */}
          <div className="space-y-2 px-4 py-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal ({cart.length})</span>
              <span data-testid="text-subtotal">{fmtRs(subtotal)}</span>
            </div>

            {/* Discount row */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Discount</span>
                <kbd className="rounded border bg-muted px-1 py-0.5 text-[9px] font-semibold">F4</kbd>
              </div>
              <div className="flex items-center gap-1.5">
                {safeDiscount > 0 ? (
                  <span className="text-sm font-semibold text-emerald-600">
                    − {fmtRs(safeDiscount)}
                  </span>
                ) : null}
                <input
                  data-testid="input-discount"
                  type="number"
                  min={0}
                  max={subtotal}
                  value={safeDiscount === 0 ? "" : safeDiscount}
                  onChange={(e) =>
                    setDiscount(clampAmount(Number(e.target.value) || 0, 0, subtotal))
                  }
                  className={`w-16 rounded border bg-background px-2 py-1 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary ${
                    safeDiscount > 0 ? "hidden" : ""
                  }`}
                  placeholder="₹ 0"
                />
                {safeDiscount > 0 && (
                  <button
                    onClick={() => setDiscount(0)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* GST row (informational, only if > 0) */}
            {totalGst > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax (GST)</span>
                <span>{fmtRs(Math.round(totalGst * 100) / 100)}</span>
              </div>
            )}

            {/* Grand total */}
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-base font-black">Grand Total</span>
              <span
                className="text-xl font-black text-foreground"
                data-testid="text-total"
              >
                {fmtRs(grandTotal)}
              </span>
            </div>
          </div>

          {/* Coupon code (visual only) */}
          <div className="px-4 py-2">
            <button className="flex w-full items-center gap-2 rounded-xl border px-4 py-2.5 transition-colors hover:bg-muted/60">
              <Tag size={15} className="text-muted-foreground" />
              <span className="flex-1 text-left text-sm text-muted-foreground">Apply Coupon Code</span>
              <ChevronRight size={15} className="text-muted-foreground" />
            </button>
          </div>

          {/* Payment panel */}
          <div className="px-4 py-3">
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

          {/* Last bill saved */}
          {lastBillNo && (
            <div className="flex items-center gap-2 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle size={14} />
              <span>Last bill: {lastBillNo}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── Sticky action bar ── */}
      <div className="shrink-0 border-t bg-card px-4 pb-2 pt-3 shadow-[0_-6px_16px_rgba(0,0,0,0.06)]">
        {!newBillingAllowed && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {newBillingReason}
          </div>
        )}

        {/* Save Bill button */}
        <Button
          data-testid="button-confirm-bill"
          className="h-14 w-full gap-2 rounded-xl text-base font-black shadow-md"
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
              Save Bill
              <kbd className="ml-auto rounded border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-0.5 text-xs font-semibold">
                F12
              </kbd>
            </>
          )}
        </Button>

        {/* Secondary actions */}
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <SecBtn
            onClick={onSaveEstimate}
            disabled={confirmBillPending || cart.length === 0}
            icon={<FileText size={13} />}
            label="Estimate"
          />
          <SecBtn
            onClick={onHoldBill}
            disabled={cart.length === 0}
            icon={<PauseCircle size={13} />}
            label="Hold"
            shortcut="F9"
          />
          <SecBtn
            onClick={onPrintBill}
            disabled={cart.length === 0 && !hasLastPrintableBill}
            icon={<Printer size={13} />}
            label="Print"
          />
          <FeatureGate
            featureName="pdf_bill_share"
            fallback={<SecBtn disabled icon={<Smartphone size={13} />} label="Share" />}
          >
            <SecBtn
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
            className="mt-1 w-full rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            Clear cart
          </button>
        )}

        {/* Keyboard shortcuts bar */}
        <div className="mt-2 grid grid-cols-5 gap-1 border-t pt-2 text-center">
          {[
            { key: "F2", label: "Search" },
            { key: "F4", label: "Discount" },
            { key: "F6", label: "Customer" },
            { key: "F9", label: "Hold" },
            { key: "Ctrl+S", label: "Save" },
          ].map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[8px] font-bold text-muted-foreground">
                {key}
              </kbd>
              <span className="text-[9px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SecBtn({
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
      className="flex flex-col items-center gap-1 rounded-xl border bg-background py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <span className="text-[9px] text-muted-foreground">{shortcut}</span>
      )}
    </button>
  );
}
