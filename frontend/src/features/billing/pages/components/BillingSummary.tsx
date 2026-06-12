import { useState, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FeatureGate } from "@/features/subscription";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import {
  CheckCircle,
  ChevronRight,
  FileText,
  Loader2,
  PauseCircle,
  Printer,
  Smartphone,
  Tag,
  User,
} from "lucide-react";
import { clampAmount } from "../billing-calculations";
import { applyOffer } from "@/features/offers/api";
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
  onCouponApplied?: (offerId: string | null, discount: number) => void;
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
  onCouponApplied,
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
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleApplyCoupon() {
    if (!couponCode.trim() || subtotal <= 0) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const res = await applyOffer(subtotal, couponCode.trim());
      if (res.applicable && res.discount > 0) {
        setDiscount(clampAmount(res.discount, 0, subtotal));
        onCouponApplied?.(res.offerId ?? null, res.discount);
        setCouponMsg({ ok: true, text: `${res.title ?? "Coupon"} applied — saved ₹${res.discount.toLocaleString("en-IN")}` });
      } else {
        setCouponMsg({ ok: false, text: res.reason ?? "Coupon not applicable to this bill" });
      }
    } catch {
      setCouponMsg({ ok: false, text: "Couldn't check coupon — needs connection" });
    } finally {
      setCouponBusy(false);
    }
  }

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

  const needsOptionsVisible =
    billType !== BillInputBillType.normal_sale || selectedCustomerId !== "walk_in";

  return (
    <div
      className="relative flex w-full shrink-0 flex-col overflow-hidden rounded-[15px] border border-[#e6ecf4] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.055)] lg:h-full lg:w-auto"
      style={{ width: summaryWidth, maxWidth: "100%" }}
      data-testid="bill-summary-panel"
    >
      {/* Resize handle */}
      <div
        data-testid="bill-summary-resize-handle"
        title="Drag to resize"
        onMouseDown={onStartSummaryResize}
        className="absolute left-0 top-0 z-20 hidden h-full w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-[#0057ff]/20 active:bg-[#0057ff]/30 lg:block"
      />

      {/* ── Scrollable body ── */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">

          {/* Customer selector — 52px */}
          <div className="flex h-[52px] items-center gap-0 rounded-[10px] border border-[#e3eaf3] bg-white px-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef4ff] text-[#0057ff]">
              <User size={15} />
            </span>
            <div className="ml-[11px] min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold text-[#13274d]">
                {selectedCustomerId === "walk_in" && !customerName
                  ? "Walk-in Customer"
                  : selectedCustomerName}
              </p>
              {billType !== BillInputBillType.normal_sale && (
                <p className="text-[10px] capitalize text-[#6b7895] leading-none">
                  {billType.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowCustomerOptions((v) => !v)}
              className="ml-auto shrink-0 text-[12px] font-extrabold text-[#0057ff] hover:underline"
            >
              Change
            </button>
          </div>

          {/* Held bills restore */}
          {heldBills.length > 0 && (
            <BillingDraftRestore heldBills={heldBills} onResumeHeldBill={onResumeHeldBill} />
          )}

          {/* Bill type + customer inputs — collapsible */}
          {(showCustomerOptions || needsOptionsVisible) && (
            <div className="space-y-2 rounded-[10px] border border-[#e3eaf3] bg-[#f7f9fd] p-3">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-xs font-semibold text-[#536383]">Bill type</span>
                <Select value={billType} onValueChange={(v) => setBillType(v as BillTypeSelection)}>
                  <SelectTrigger data-testid="select-bill-type" className="h-8 flex-1 text-xs font-semibold">
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

              {selectedCustomerId === "walk_in" && (
                <>
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
                      onChange={(e) => setCustomerMobile(e.target.value.replace(/\D/g, "").slice(0, 15))}
                    />
                  </div>
                  {matchingMobileCustomer && (
                    <p data-testid="text-mobile-customer-match" className="text-xs text-blue-600">
                      Matches {matchingMobileCustomer.name}
                    </p>
                  )}
                  {(creditAmount > 0 || billType === BillInputBillType.udhar_entry) &&
                    !hasCreditCustomerIdentity && (
                      <p className="text-xs text-amber-600">Name + mobile required for udhar billing.</p>
                    )}
                </>
              )}
            </div>
          )}

          {/* Cart items card */}
          <div className="overflow-hidden rounded-[11px] border border-[#e5ebf4] bg-white">
            <BillingCart
              cart={cart}
              onUpdateQty={onUpdateQty}
              onUpdateRate={onUpdateRate}
              onUpdateUnit={onUpdateUnit}
              onRemoveItem={onRemoveItem}
            />
            {cart.length > 0 && (
              <div className="flex h-[43px] items-center border-t border-[#edf1f6] px-3.5">
                <button className="text-[12px] font-extrabold text-[#0057ff] hover:underline">
                  + Add more items
                </button>
                <span className="ml-auto text-[12px] font-bold text-[#536383]">
                  {cart.length} Item{cart.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Totals box */}
          <div className="rounded-[11px] border border-[#e5ebf4] bg-white px-3 pb-3.5 pt-3">
            {/* Subtotal */}
            <div className="flex h-[29px] items-center justify-between text-[12px]">
              <span className="font-semibold text-[#536383]">Subtotal</span>
              <span data-testid="text-subtotal" className="font-black text-[#13274d]">{fmtRs(subtotal)}</span>
            </div>

            {/* Discount */}
            <div className="flex h-[29px] items-center justify-between text-[12px]">
              <span className="font-semibold text-[#536383]">Discount</span>
              <div className="flex items-center gap-2">
                {safeDiscount > 0 && !editingDiscount && (
                  <span className="font-black text-[#16a34a]">−{fmtRs(safeDiscount)}</span>
                )}
                {editingDiscount && (
                  <input
                    data-testid="input-discount"
                    type="number"
                    min={0}
                    max={subtotal}
                    autoFocus
                    value={safeDiscount === 0 ? "" : safeDiscount}
                    onChange={(e) => setDiscount(clampAmount(Number(e.target.value) || 0, 0, subtotal))}
                    onBlur={() => setEditingDiscount(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditingDiscount(false)}
                    className="w-16 rounded-[7px] border border-[#dbe8ff] bg-white px-2 py-1 text-right text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0057ff]"
                    placeholder="₹ 0"
                  />
                )}
                <button
                  onClick={() => setEditingDiscount((v) => !v)}
                  className="inline-flex h-6 items-center rounded-[7px] border border-[#dbe8ff] bg-[#f5f9ff] px-2 text-[10px] font-extrabold text-[#0057ff] hover:bg-[#eaf2ff]"
                >
                  {safeDiscount > 0 && !editingDiscount ? "Edit" : "Apply"}
                </button>
              </div>
            </div>

            {/* Coupon / offer */}
            <div className="flex items-center gap-2 pt-0.5">
              <input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && void handleApplyCoupon()}
                placeholder="Coupon code"
                className="h-7 flex-1 rounded-[7px] border border-[#dbe8ff] bg-white px-2 text-[11px] font-semibold uppercase placeholder:font-medium placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-[#0057ff]"
              />
              <button
                onClick={() => void handleApplyCoupon()}
                disabled={couponBusy || !couponCode.trim() || subtotal <= 0}
                className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#dbe8ff] bg-[#f5f9ff] px-2 text-[10px] font-extrabold text-[#0057ff] hover:bg-[#eaf2ff] disabled:opacity-50"
              >
                {couponBusy ? <Loader2 size={11} className="animate-spin" /> : <Tag size={11} />} Apply
              </button>
            </div>
            {couponMsg && <p className={`pt-0.5 text-[10px] font-semibold ${couponMsg.ok ? "text-[#16a34a]" : "text-rose-500"}`}>{couponMsg.text}</p>}

            {/* Tax */}
            {totalGst > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#536383]">Tax (GST 5%)</span>
                <span className="font-black text-[#13274d]">{fmtRs(Math.round(totalGst * 100) / 100)}</span>
              </div>
            )}

            {/* Grand total */}
            <div className="mt-2 flex items-center justify-between border-t border-[#edf1f6] pt-3">
              <span className="font-display text-[18px] font-black tracking-tight text-[#0f1e3d]">Grand Total</span>
              <span className="font-display text-[21px] font-black tracking-tight text-[#0f1e3d]" data-testid="text-total">
                {fmtRs(grandTotal)}
              </span>
            </div>
          </div>

          {/* Coupon box — dashed blue */}
          <button className="flex h-[42px] w-full items-center gap-2.5 rounded-[9px] border border-dashed border-[#b9cdf6] bg-white px-3.5 transition-colors hover:bg-[#f5f9ff]">
            <Tag size={15} className="text-[#0057ff]" />
            <span className="text-[12px] font-extrabold text-[#0057ff]">Apply Coupon Code</span>
            <ChevronRight size={15} className="ml-auto text-[#0057ff]" />
          </button>

          {/* Payment panel */}
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

          {/* Last bill saved */}
          {lastBillNo && (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle size={14} />
              <span>Last bill: {lastBillNo}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── Sticky action bar ── */}
      <div className="shrink-0 border-t border-[#edf1f6] bg-white px-4 pb-3 pt-3">
        {!newBillingAllowed && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {newBillingReason}
          </div>
        )}

        {/* Save Bill button — 54px blue gradient */}
        <Button
          data-testid="button-confirm-bill"
          style={{ background: "linear-gradient(180deg, #005dff 0%, #0047e8 100%)" }}
          className="relative h-[54px] w-full rounded-[10px] text-[16px] font-black text-white shadow-[0_12px_24px_rgba(0,77,255,0.28)] hover:opacity-95"
          onClick={onConfirmBill}
          disabled={confirmBillPending || cart.length === 0 || !newBillingAllowed || !createBillAllowed}
        >
          {confirmBillPending ? (
            <>
              <Loader2 size={18} className="mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Save Bill
              <span className="absolute right-2.5 top-1/2 inline-flex h-6 min-w-[34px] -translate-y-1/2 items-center justify-center rounded-[7px] bg-[rgba(0,35,140,0.35)] px-1.5 text-[11px] font-black text-white">
                F12
              </span>
            </>
          )}
        </Button>

        {/* Secondary actions */}
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <SecBtn onClick={onSaveEstimate} disabled={confirmBillPending || cart.length === 0} icon={<FileText size={13} />} label="Estimate" />
          <SecBtn onClick={onHoldBill} disabled={cart.length === 0} icon={<PauseCircle size={13} />} label="Hold" shortcut="F9" />
          <SecBtn onClick={onPrintBill} disabled={cart.length === 0 && !hasLastPrintableBill} icon={<Printer size={13} />} label="Print" />
          <FeatureGate
            featureName="pdf_bill_share"
            fallback={<SecBtn disabled icon={<Smartphone size={13} />} label="Share" />}
          >
            <SecBtn onClick={onSharePdf} disabled={cart.length === 0 && !hasLastPrintableBill} icon={<Smartphone size={13} />} label="Share" />
          </FeatureGate>
        </div>

        {cart.length > 0 && (
          <button
            data-testid="button-clear-cart"
            onClick={onClearCart}
            className="mt-1 w-full rounded-lg py-1.5 text-xs font-medium text-[#536383] hover:bg-red-50 hover:text-red-600"
          >
            Clear cart
          </button>
        )}

        {/* Keyboard shortcuts — 5 buttons */}
        <div className="mt-2 grid grid-cols-5 gap-1.5 border-t border-[#edf1f6] pt-2.5">
          {[
            { key: "F2", label: "Search" },
            { key: "F4", label: "Discount" },
            { key: "F6", label: "Customer" },
            { key: "F9", label: "Hold" },
            { key: "Ctrl+S", label: "Save" },
          ].map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center justify-center gap-1.5">
              <kbd className="inline-flex h-[22px] min-w-[28px] items-center justify-center rounded-[6px] bg-[#edf4ff] px-1.5 font-mono text-[10px] font-black text-[#0057ff]">
                {key}
              </kbd>
              <span className="text-[10px] font-bold text-[#5d6f8d]">{label}</span>
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
      className="flex flex-col items-center gap-1 rounded-[9px] border border-[#e2eaf5] bg-white py-2 text-xs font-bold text-[#13274d] transition-colors hover:bg-[#f7f9fd] disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
      {shortcut && <span className="text-[9px] text-[#536383]">{shortcut}</span>}
    </button>
  );
}
