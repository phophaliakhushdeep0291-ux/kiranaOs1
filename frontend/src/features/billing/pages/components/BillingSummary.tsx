import { useEffect, useState, type CSSProperties, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import {
  CheckCircle,
  Award,
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
import type { BillTypeSelection, CartItem, PaymentSelection } from "../billing-types";
import { BillingCart } from "./BillingCart";
import { BillingPaymentPanel } from "./BillingPaymentPanel";

interface BillingSummaryProps {
  summaryWidth: number;
  onStartSummaryResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isOnline: boolean;
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
  /** Total ₹ given away via per-line discounts (already inside subtotal). */
  lineDiscountTotal: number;
  safeDiscount: number;
  setDiscount: Dispatch<SetStateAction<number>>;
  discountReason: string;
  setDiscountReason: (reason: string) => void;
  onCouponApplied?: (offerId: string | null, discount: number, code: string) => void;
  loyaltyOnline: boolean;
  loyaltyCustomerSelected: boolean;
  loyaltyLoading: boolean;
  loyaltyActive: boolean;
  loyaltyTier?: string;
  loyaltyBalance: number;
  loyaltyMinimumPoints: number;
  loyaltyMaxPoints: number;
  loyaltyPoints: number;
  setLoyaltyPoints: (points: number) => void;
  loyaltyDiscount: number;
  gstAmount: number;
  gstMode: "inclusive" | "exclusive" | "none";
  // Split resolved by the shared GST engine, which decides CGST+SGST vs IGST from the
  // seller/buyer state codes. Optional so existing callers and tests keep working.
  gstCgst?: number;
  gstSgst?: number;
  gstIgst?: number;
  gstSupplyType?: "intrastate" | "interstate";
  grandTotal: number;
  /** Signed nearest-rupee round-off applied to reach grandTotal; 0 when off. */
  roundOff?: number;
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
  retailPaymentConfigured: boolean;
  retailPaymentRequired: boolean;
  retailPaymentVerified: boolean;
  retailPaymentLoading: boolean;
  onVerifyRetailPayment: () => void;
  giftCardCode: string;
  setGiftCardCode: (value: string) => void;
  giftCardBalance: number | null;
  giftCardAmount: number;
  setGiftCardAmount: (value: number) => void;
  giftCardLoading: boolean;
  giftCardError: string | null;
  onLookupGiftCard: () => void;
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
  onUpdateLineDiscount: (lineKey: string, amount: number) => void;
  onUpdateLineNote: (lineKey: string, note: string) => void;
  onReadScale: (lineKey: string, billingUnit: string) => void;
  scaleReadingLineKey: string | null;
  onRemoveItem: (productId: string) => void;
  negativeStockWarnings?: Array<{
    productId: string;
    productName: string;
    available: number;
    requested: number;
    after: number;
    unit: string;
  }>;
}

function fmtRs(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

// An out-of-state buyer is charged IGST, not CGST+SGST, so the counter has to say which.
// The split comes from the shared GST engine (lib/gst.ts) — the same one the printed tax
// invoice uses — so the screen and the invoice can never disagree.
//
// The fallback halves gstAmount only when the caller passes no split. It rounds one half
// and derives the other: printing gst/2 twice produced values like ₹1.335, which is not a
// real currency amount and cannot go on a GST return.
export function describeTaxSplit(
  gstAmount: number,
  split: { cgst?: number; sgst?: number; igst?: number; supplyType?: "intrastate" | "interstate" } = {},
): string {
  const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;
  if (split.supplyType === "interstate") {
    return `IGST ${money(split.igst ?? gstAmount)}`;
  }
  const cgst = split.cgst ?? Math.round((gstAmount / 2) * 100) / 100;
  const sgst = split.sgst ?? Math.round((gstAmount - cgst) * 100) / 100;
  return `CGST ${money(cgst)} + SGST ${money(sgst)}`;
}

export function BillingSummary({
  summaryWidth,
  onStartSummaryResize,
  isOnline,
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
  lineDiscountTotal,
  safeDiscount,
  setDiscount,
  discountReason,
  setDiscountReason,
  onCouponApplied,
  loyaltyOnline,
  loyaltyCustomerSelected,
  loyaltyLoading,
  loyaltyActive,
  loyaltyTier,
  loyaltyBalance,
  loyaltyMinimumPoints,
  loyaltyMaxPoints,
  loyaltyPoints,
  setLoyaltyPoints,
  loyaltyDiscount,
  gstAmount,
  gstMode,
  gstCgst,
  gstSgst,
  gstIgst,
  gstSupplyType,
  grandTotal,
  roundOff = 0,
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
  retailPaymentConfigured,
  retailPaymentRequired,
  retailPaymentVerified,
  retailPaymentLoading,
  onVerifyRetailPayment,
  giftCardCode,
  setGiftCardCode,
  giftCardBalance,
  giftCardAmount,
  setGiftCardAmount,
  giftCardLoading,
  giftCardError,
  onLookupGiftCard,
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
  onUpdateLineDiscount,
  onUpdateLineNote,
  onReadScale,
  scaleReadingLineKey,
  onRemoveItem,
  negativeStockWarnings = [],
}: BillingSummaryProps) {
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [couponExpanded, setCouponExpanded] = useState(false);
  const [loyaltyExpanded, setLoyaltyExpanded] = useState(false);
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
        onCouponApplied?.(res.offerId ?? null, res.discount, res.code ?? couponCode.trim().toUpperCase());
        setCouponMsg({ ok: true, text: `${res.title ?? "Coupon"} applied — saved ₹${res.discount.toLocaleString("en-IN")}` });
      } else {
        onCouponApplied?.(null, 0, "");
        setCouponMsg({ ok: false, text: res.reason ?? "Coupon not applicable to this bill" });
      }
    } catch {
      onCouponApplied?.(null, 0, "");
      setCouponMsg({ ok: false, text: "Couldn't check coupon — needs connection" });
    } finally {
      setCouponBusy(false);
    }
  }

  const selectedCustomerName = (() => {
    if (selectedCustomerId !== "walk_in") {
      return customers.find((c) => c.id === selectedCustomerId)?.name ?? "Customer";
    }
    return customerName.trim() || "Walk-in Customer";
  })();

  const needsOptionsVisible =
    billType !== BillInputBillType.normal_sale || selectedCustomerId !== "walk_in";
  const isEstimateBill = billType === BillInputBillType.estimate;
  const paymentAction = String(paymentMode) === "credit"
    ? "Save as Udhar"
    : String(paymentMode) === "upi"
      ? "Collect by UPI"
      : String(paymentMode) === "bank" || String(paymentMode) === "bank_transfer"
        ? "Collect by Bank"
        : String(paymentMode) === "split"
          ? "Complete Split Payment"
          : "Collect Cash";

  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "discount") setEditingDiscount(true);
      if (action === "coupon") setCouponExpanded(true);
      if (action === "customer") {
        setShowCustomerOptions(true);
        window.setTimeout(() => customerNameInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("kirana:billing-summary-action", onAction);
    return () => window.removeEventListener("kirana:billing-summary-action", onAction);
  }, [customerNameInputRef]);

  return (
    <div
      className="relative flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[15px] border border-[#e6ecf4] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.055)] lg:w-[var(--bill-summary-width)]"
      style={{ "--bill-summary-width": `${summaryWidth}px` } as CSSProperties}
      data-testid="bill-summary-panel"
    >
      {/* Resize handle */}
      <div
        data-testid="bill-summary-resize-handle"
        title="Drag to resize"
        onMouseDown={onStartSummaryResize}
        className="absolute left-0 top-0 z-20 hidden h-full w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-[var(--brand)]/20 active:bg-[var(--brand)]/30 lg:block"
      />

      {/* ── Scrollable body ── */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">

          {/* Customer selector — 52px */}
          <div className="flex h-[52px] items-center gap-0 rounded-[10px] border border-[#e3eaf3] bg-white px-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef4ff] text-[var(--brand)]">
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
              className="ml-auto inline-flex min-h-[40px] shrink-0 items-center px-2 text-[12px] font-extrabold text-[var(--brand)] hover:underline"
            >
              Change
            </button>
          </div>

          {/* Bill type + customer inputs — collapsible */}
          <div className="grid grid-cols-2 gap-2 rounded-[11px] border border-[#e5ebf4] bg-[#f8fbff] p-1.5" aria-label="Choose bill type">
            <button
              type="button"
              data-testid="button-bill-type-pakka"
              aria-pressed={!isEstimateBill}
              onClick={() => setBillType(BillInputBillType.normal_sale)}
              className={`flex min-h-[58px] items-center gap-2 rounded-[9px] border px-3 text-left transition-all ${
                !isEstimateBill
                  ? "border-[#b9f0cb] bg-white text-[#0f9f49] shadow-[0_8px_18px_rgba(25,184,90,0.12)]"
                  : "border-transparent bg-transparent text-[#536383] hover:bg-white"
              }`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e9fff0] text-[#16a34a]">
                <CheckCircle size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-black">Pakka Bill</span>
                <span className="block text-[10px] font-semibold opacity-75">Final sale</span>
              </span>
            </button>
            <button
              type="button"
              data-testid="button-bill-type-estimate"
              aria-pressed={isEstimateBill}
              onClick={() => setBillType(BillInputBillType.estimate)}
              className={`flex min-h-[58px] items-center gap-2 rounded-[9px] border px-3 text-left transition-all ${
                isEstimateBill
                  ? "border-[#d8c7ff] bg-white text-[#6d3df0] shadow-[0_8px_18px_rgba(124,63,242,0.12)]"
                  : "border-transparent bg-transparent text-[#536383] hover:bg-white"
              }`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f1edff] text-[#7c3ff2]">
                <FileText size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-black">Estimate Bill</span>
                <span className="block text-[10px] font-semibold opacity-75">Not a final bill</span>
              </span>
            </button>
          </div>

          {(showCustomerOptions || needsOptionsVisible) && (
            <div className="space-y-2 rounded-[10px] border border-[#e3eaf3] bg-[#f7f9fd] p-3">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-xs font-semibold text-[#536383]">Bill type</span>
                <Select value={billType} onValueChange={(v) => setBillType(v as BillTypeSelection)}>
                  <SelectTrigger data-testid="select-bill-type" className="h-8 flex-1 text-xs font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BillInputBillType.normal_sale}>Pakka Bill</SelectItem>
                    <SelectItem value={BillInputBillType.udhar_entry}>Udhar</SelectItem>
                    <SelectItem value={BillInputBillType.gst_invoice}>GST Invoice</SelectItem>
                    <SelectItem value={BillInputBillType.estimate}>Estimate Bill</SelectItem>
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
              onUpdateLineDiscount={onUpdateLineDiscount}
              onUpdateLineNote={onUpdateLineNote}
              onReadScale={onReadScale}
              scaleReadingLineKey={scaleReadingLineKey}
              onRemoveItem={onRemoveItem}
            />
            {cart.length > 0 && (
              <div className="flex h-[43px] items-center border-t border-[#edf1f6] px-3.5">
                <button className="text-[12px] font-extrabold text-[var(--brand)] hover:underline">
                  + Add more items
                </button>
                <span className="ml-auto text-[12px] font-bold text-[#536383]">
                  {cart.length} Item{cart.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {negativeStockWarnings.length > 0 && (
              <div className="border-t border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-snug text-amber-800">
                <p className="font-black text-amber-900">Stock will go negative</p>
                <p className="mt-0.5 font-semibold">
                  {negativeStockWarnings[0].productName} will become{" "}
                  <span className="font-black">{negativeStockWarnings[0].after} {negativeStockWarnings[0].unit}</span>.
                  {" "}Bill can continue; update stock later.
                </p>
                {negativeStockWarnings.length > 1 && (
                  <p className="mt-1 font-bold">+{negativeStockWarnings.length - 1} more item{negativeStockWarnings.length === 2 ? "" : "s"} need stock update.</p>
                )}
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

            {lineDiscountTotal > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#536383]">Line discounts <span className="text-[10px] text-[#94a3b8]">(already in subtotal)</span></span>
                <span data-testid="text-line-discounts" className="font-black text-[#1a8a4e]">−{fmtRs(lineDiscountTotal)}</span>
              </div>
            )}

            {loyaltyDiscount > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#536383]">Loyalty rewards <span className="text-[10px] text-[#94a3b8]">({loyaltyPoints.toLocaleString("en-IN")} pts)</span></span>
                <span className="font-black text-violet-700">−{fmtRs(loyaltyDiscount)}</span>
              </div>
            )}

            {/* GST — exclusive adds to the payable; inclusive is informational */}
            {gstAmount > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#536383]">
                  GST <span className="text-[10.5px] text-[#94a3b8]">({describeTaxSplit(gstAmount, { cgst: gstCgst, sgst: gstSgst, igst: gstIgst, supplyType: gstSupplyType })})</span>
                </span>
                <span data-testid="text-gst" className={gstMode === "exclusive" ? "font-black text-[#13274d]" : "font-bold text-[#64748b]"}>
                  {gstMode === "exclusive" ? `+${fmtRs(gstAmount)}` : `incl. ${fmtRs(gstAmount)}`}
                </span>
              </div>
            )}

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
                    className="w-16 rounded-[7px] border border-[#dbe8ff] bg-white px-2 py-1 text-right text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
                    placeholder="₹ 0"
                  />
                )}
                <button
                  onClick={() => setEditingDiscount((v) => !v)}
                  className="inline-flex h-9 items-center rounded-[7px] border border-[#dbe8ff] bg-[#f5f9ff] px-3 text-[11px] font-extrabold text-[var(--brand)] hover:bg-[#eaf2ff]"
                >
                  {safeDiscount > 0 && !editingDiscount ? "Edit" : "Apply"}
                </button>
              </div>
            </div>

            {/* Why the discount — feeds the discounts report. Only shown once a discount exists. */}
            {safeDiscount > 0 && (
              <div className="flex h-[29px] items-center justify-between gap-2 text-[12px]">
                <span className="shrink-0 font-semibold text-[#8290a8]">Reason</span>
                <input
                  data-testid="input-discount-reason"
                  type="text"
                  maxLength={200}
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder="e.g. regular customer"
                  className="w-full max-w-[200px] rounded-[7px] border border-transparent bg-[#f7f9fd] px-2 py-1 text-right text-[11px] font-semibold text-[#31527e] placeholder:text-[#9aa7bd] focus:border-[#dbe8ff] focus:bg-white focus:outline-none"
                />
              </div>
            )}

            {/* Round off — the nearest-rupee adjustment folded into the grand total. */}
            {roundOff !== 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#536383]">Round off</span>
                <span data-testid="text-round-off" className="font-black text-[#13274d]">
                  {roundOff > 0 ? "+" : "−"}{fmtRs(Math.abs(roundOff))}
                </span>
              </div>
            )}

            {/* Grand total */}
            <div className="mt-2 flex items-center justify-between border-t border-[#edf1f6] pt-3">
              <span className="font-display text-[18px] font-black tracking-tight text-[var(--brand-ink)]">Grand Total</span>
              <span className="font-display text-[21px] font-black tracking-tight text-[var(--brand-ink)]" data-testid="text-total">
                {fmtRs(grandTotal)}
              </span>
            </div>
          </div>

          {/* Coupon box — dashed blue */}
          <button onClick={() => setCouponExpanded((value) => !value)} aria-expanded={couponExpanded} className="flex h-[42px] w-full items-center gap-2.5 rounded-[9px] border border-dashed border-[#b9cdf6] bg-white px-3.5 transition-colors hover:bg-[#f5f9ff]">
            <Tag size={15} className="text-[var(--brand)]" />
            <span className="text-[12px] font-extrabold text-[var(--brand)]">Apply Coupon Code</span>
            <ChevronRight size={15} className={`ml-auto text-[var(--brand)] transition-transform ${couponExpanded ? "rotate-90" : ""}`} />
          </button>
          {couponExpanded && (
            <div className="rounded-[9px] border border-[#dbe8ff] bg-[#f8fbff] p-2.5">
              <div className="flex items-center gap-2">
                <input autoFocus value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); onCouponApplied?.(null, 0, ""); setCouponMsg(null); }} onKeyDown={(e) => e.key === "Enter" && void handleApplyCoupon()} placeholder="Enter coupon code" className="h-9 flex-1 rounded-[7px] border border-[#dbe8ff] bg-white px-3 text-[11px] font-semibold uppercase placeholder:font-medium placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
                <button onClick={() => void handleApplyCoupon()} disabled={couponBusy || !couponCode.trim() || subtotal <= 0} className="inline-flex h-9 items-center gap-1 rounded-[7px] bg-[var(--brand)] px-3 text-[11px] font-semibold text-white hover:bg-[#0054e8] disabled:opacity-50">{couponBusy ? <Loader2 size={11} className="animate-spin" /> : <Tag size={11} />} Apply</button>
              </div>
              {couponMsg && <p className={`pt-1.5 text-[10px] font-semibold ${couponMsg.ok ? "text-[#16a34a]" : "text-rose-500"}`}>{couponMsg.text}</p>}
            </div>
          )}

          <button onClick={() => setLoyaltyExpanded((value) => !value)} aria-expanded={loyaltyExpanded} className="flex min-h-[42px] w-full items-center gap-2.5 rounded-[9px] border border-violet-200 bg-violet-50/60 px-3.5 py-2 transition-colors hover:bg-violet-50">
            <Award size={15} className="text-violet-700" />
            <span className="text-left text-[12px] font-extrabold text-violet-800">Use loyalty points</span>
            {loyaltyCustomerSelected && loyaltyActive && !loyaltyLoading ? <span className="ml-auto text-[10px] font-black text-violet-700">{loyaltyBalance.toLocaleString("en-IN")} available</span> : null}
            <ChevronRight size={15} className={`${loyaltyCustomerSelected && loyaltyActive && !loyaltyLoading ? "" : "ml-auto"} text-violet-700 transition-transform ${loyaltyExpanded ? "rotate-90" : ""}`} />
          </button>
          {loyaltyExpanded && (
            <div className="rounded-[9px] border border-violet-200 bg-violet-50/50 p-3">
              {!loyaltyOnline ? <p className="text-[11px] font-semibold text-amber-700">Connect to redeem points. The balance and bill are committed together for safety.</p>
                : !loyaltyCustomerSelected ? <p className="text-[11px] font-semibold text-violet-800">Choose a saved customer above to load their rewards.</p>
                  : loyaltyLoading ? <p className="flex items-center gap-2 text-[11px] font-semibold text-violet-700"><Loader2 size={12} className="animate-spin" /> Loading rewards…</p>
                    : !loyaltyActive ? <p className="text-[11px] font-semibold text-slate-600">The loyalty program is not active for this store.</p>
                      : loyaltyBalance < loyaltyMinimumPoints ? <p className="text-[11px] font-semibold text-slate-600">{loyaltyTier ? `${loyaltyTier} member · ` : ""}{loyaltyBalance.toLocaleString("en-IN")} points available. Minimum redemption is {loyaltyMinimumPoints.toLocaleString("en-IN")}.</p>
                        : <>
                            <div className="flex items-center gap-2">
                              <Input type="number" min={loyaltyMinimumPoints} max={loyaltyMaxPoints} value={loyaltyPoints || ""} onChange={(event) => setLoyaltyPoints(Math.min(loyaltyMaxPoints, Math.max(0, Math.floor(Number(event.target.value) || 0))))} placeholder={`Min ${loyaltyMinimumPoints}`} className="h-9 bg-white text-xs" />
                              <Button type="button" variant="outline" className="h-9 shrink-0 border-violet-200 text-[11px] font-black text-violet-700" disabled={loyaltyMaxPoints < loyaltyMinimumPoints} onClick={() => setLoyaltyPoints(loyaltyMaxPoints)}>Use max</Button>
                              {loyaltyPoints > 0 ? <Button type="button" variant="ghost" className="h-9 px-2 text-[11px] font-bold text-slate-500" onClick={() => setLoyaltyPoints(0)}>Clear</Button> : null}
                            </div>
                            <p className="mt-2 text-[10px] font-semibold text-violet-700">{loyaltyTier ? `${loyaltyTier} · ` : ""}{loyaltyBalance.toLocaleString("en-IN")} available · save {fmtRs(loyaltyDiscount)}. Owner approval is requested when the bill is saved.</p>
                            {loyaltyMaxPoints < loyaltyMinimumPoints ? <p className="mt-1 text-[10px] font-semibold text-amber-700">This bill’s remaining value is below the minimum redemption amount.</p> : null}
                          </>}
            </div>
          )}

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
            retailPaymentConfigured={retailPaymentConfigured}
            retailPaymentRequired={retailPaymentRequired}
            retailPaymentVerified={retailPaymentVerified}
            retailPaymentLoading={retailPaymentLoading}
            onVerifyRetailPayment={onVerifyRetailPayment}
            isOnline={isOnline}
            giftCardCode={giftCardCode}
            setGiftCardCode={setGiftCardCode}
            giftCardBalance={giftCardBalance}
            giftCardAmount={giftCardAmount}
            setGiftCardAmount={setGiftCardAmount}
            giftCardLoading={giftCardLoading}
            giftCardError={giftCardError}
            onLookupGiftCard={onLookupGiftCard}
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
          style={{ background: "linear-gradient(180deg, var(--brand) 0%, var(--brand-strong) 100%)" }}
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
              {isEstimateBill ? `Save Estimate Bill · ${fmtRs(grandTotal)}` : `${paymentAction} · ${fmtRs(grandTotal)}`}
              <span className="absolute right-2.5 top-1/2 hidden h-6 min-w-[34px] -translate-y-1/2 items-center justify-center rounded-[7px] bg-[rgba(0,35,140,0.35)] px-1.5 text-[11px] font-black text-white sm:inline-flex">
                F12
              </span>
            </>
          )}
        </Button>

        {/* Secondary actions */}
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <SecBtn testId="button-save-as-estimate" onClick={onSaveEstimate} disabled={confirmBillPending || cart.length === 0} icon={<FileText size={13} />} label="Save Estimate" />
          <SecBtn onClick={onHoldBill} disabled={cart.length === 0} icon={<PauseCircle size={13} />} label="Hold" shortcut="F9" />
          <SecBtn onClick={onPrintBill} disabled={cart.length === 0 && !hasLastPrintableBill} icon={<Printer size={13} />} label="Print" />
          {/* Free for all plans: opens WhatsApp with a text receipt (wa.me deep link, no paid API). */}
          <SecBtn onClick={onSharePdf} disabled={cart.length === 0 && !hasLastPrintableBill} icon={<Smartphone size={13} />} label="WhatsApp" />
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
        <div className="mt-2 hidden grid-cols-5 gap-1.5 border-t border-[#edf1f6] pt-2.5 sm:grid">
          {[
            { key: "F2", label: "Search" },
            { key: "F4", label: "Discount" },
            { key: "F6", label: "Customer" },
            { key: "F9", label: "Hold" },
            { key: "Ctrl+S", label: "Save" },
          ].map(({ key, label }) => (
            <div key={key} className="flex flex-col items-center justify-center gap-1.5">
              <kbd className="inline-flex h-[22px] min-w-[28px] items-center justify-center rounded-[6px] bg-[var(--brand-soft)] px-1.5 font-mono text-[10px] font-black text-[var(--brand)]">
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
  testId,
  onClick,
  disabled,
  icon,
  label,
  shortcut,
}: {
  testId?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-[9px] border border-[#e2eaf5] bg-white py-2 text-xs font-bold text-[#13274d] transition-colors hover:bg-[#f7f9fd] disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      <span>{label}</span>
      {shortcut && <span className="hidden text-[9px] text-[#536383] sm:inline">{shortcut}</span>}
    </button>
  );
}
