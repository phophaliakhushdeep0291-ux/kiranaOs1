import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import type { SellableBatch } from "@/features/core/inventory/inventory-lots-api";
import { Button } from "@/components/ui/button";
import { Input, useMoneyDraft, useNumericDraft } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BillInputBillType, type Customer } from "@/lib/api/client";
import {
  CheckCircle,
  Award,
  ChevronDown,
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
import { applyOffer } from "@/features/core/offers/api";
import type { BillTypeSelection, CartItem, PaymentSelection } from "../billing-types";
import { BillingCart } from "./BillingCart";
import { BillingPaymentPanel } from "./BillingPaymentPanel";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useShopBillingWords } from "@/features/core/settings/shop-billing";
import { ACTIVITY_EVENTS, trackEvent, usePersonalization } from "@/lib/activity";

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
  retailPaymentDynamicQr: boolean;
  retailPaymentRequired: boolean;
  retailPaymentVerified: boolean;
  retailPaymentLoading: boolean;
  onVerifyRetailPayment: () => void;
  upiReference: string;
  setUpiReference: (value: string) => void;
  cardTerminalConfigured: boolean;
  cardTerminalApproved: boolean;
  cardTerminalLoading: boolean;
  onChargeCardTerminal: () => void;
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
  holdBillPending: boolean;
  hasLastPrintableBill: boolean;
  onConfirmBill: () => void;
  onNewBill: () => void;
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
  onUpdateLineBatch: (lineKey: string, batch?: SellableBatch) => void;
  /** Controls contributed by the active trade — a pharmacy's prescription
   *  attach, for one. Null for every shop that registered no slot. */
  tradeSlots?: ReactNode;
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
  retailPaymentDynamicQr,
  retailPaymentRequired,
  retailPaymentVerified,
  retailPaymentLoading,
  onVerifyRetailPayment,
  upiReference,
  setUpiReference,
  cardTerminalConfigured,
  cardTerminalApproved,
  cardTerminalLoading,
  onChargeCardTerminal,
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
  holdBillPending,
  hasLastPrintableBill,
  onConfirmBill,
  onNewBill,
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
  onUpdateLineBatch,
  tradeSlots,
  onReadScale,
  scaleReadingLineKey,
  onRemoveItem,
  negativeStockWarnings = [],
}: BillingSummaryProps) {
  const { t } = useAppLanguage();
  const words = useShopBillingWords();
  // §13 "Highlighting frequently selected customers": the people this user picks
  // most float to the top of the list. Ordering only — every customer is still
  // in the list, in the same alphabetical order underneath.
  const personalization = usePersonalization();
  const orderedCustomers = useMemo(() => {
    const ranks = new Map((personalization.data?.frequentCustomers ?? []).map((row, index) => [row.key, index]));
    if (ranks.size === 0) return customers;
    return [...customers].sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [customers, personalization.data]);
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [couponExpanded, setCouponExpanded] = useState(false);
  const [loyaltyExpanded, setLoyaltyExpanded] = useState(false);
  const [showSaleExtras, setShowSaleExtras] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Clear-and-retype drafts. Both boxes previously committed 0 on the keystroke
  // that emptied them, so the old figure had to be selected over.
  const discountProps = useMoneyDraft(safeDiscount, (next) => setDiscount(clampAmount(next, 0, subtotal)), { max: subtotal });
  const loyaltyProps = useNumericDraft(
    loyaltyPoints,
    (next) => setLoyaltyPoints(Math.min(loyaltyMaxPoints, Math.max(0, Math.floor(next ?? 0)))),
    { decimals: 0, max: loyaltyMaxPoints },
  );

  async function handleApplyCoupon() {
    if (!couponCode.trim() || subtotal <= 0) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const res = await applyOffer(subtotal, couponCode.trim());
      if (res.applicable && res.discount > 0) {
        setDiscount(clampAmount(res.discount, 0, subtotal));
        onCouponApplied?.(res.offerId ?? null, res.discount, res.code ?? couponCode.trim().toUpperCase());
        setCouponMsg({ ok: true, text: t("billing.summary.couponApplied", { title: res.title ?? t("billing.summary.couponFallbackTitle"), amount: res.discount.toLocaleString("en-IN") }) });
      } else {
        onCouponApplied?.(null, 0, "");
        setCouponMsg({ ok: false, text: res.reason ?? t("billing.summary.couponNotApplicable") });
      }
    } catch {
      onCouponApplied?.(null, 0, "");
      setCouponMsg({ ok: false, text: t("billing.summary.couponOffline") });
    } finally {
      setCouponBusy(false);
    }
  }

  const selectedCustomerName = (() => {
    if (selectedCustomerId !== "walk_in") {
      return customers.find((c) => c.id === selectedCustomerId)?.name ?? t("billing.summary.customerFallback");
    }
    return customerName.trim() || t("billing.summary.walkInCustomer");
  })();

  const needsOptionsVisible =
    billType !== BillInputBillType.normal_sale || selectedCustomerId !== "walk_in";
  const isEstimateBill = billType === BillInputBillType.estimate;
  const paymentAction = String(paymentMode) === "credit"
    ? t("billing.summary.actionSaveUdhar")
    : String(paymentMode) === "upi"
      ? t("billing.summary.actionCollectUpi")
      : String(paymentMode) === "bank" || String(paymentMode) === "bank_transfer"
        ? t("billing.summary.actionCollectBank")
        : String(paymentMode) === "split"
          ? t("billing.summary.actionCompleteSplit")
          : t("billing.summary.actionCollectCash");

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
      className="relative flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[15px] border border-[#EAE4D8] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.055)] lg:w-[var(--bill-summary-width)]"
      style={{ "--bill-summary-width": `${summaryWidth}px` } as CSSProperties}
      data-testid="bill-summary-panel"
    >
      {/* Resize handle */}
      <div
        data-testid="bill-summary-resize-handle"
        title={t("billing.summary.dragToResize")}
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
              <p className="truncate text-[13px] font-extrabold text-[#3D4354]">
                {selectedCustomerId === "walk_in" && !customerName
                  ? t("billing.summary.walkInCustomer")
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
              className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-[12px] font-extrabold text-[var(--brand)] hover:underline"
            >
              {t("billing.summary.change")}
            </button>
          </div>

          {/* Bill type + customer inputs — collapsible */}
          <div className="grid grid-cols-2 gap-2 rounded-[11px] border border-[#e5ebf4] bg-[#f8fbff] p-1.5" aria-label={t("billing.summary.chooseBillType")}>
            <button
              type="button"
              data-testid="button-bill-type-pakka"
              aria-pressed={!isEstimateBill}
              onClick={() => setBillType(BillInputBillType.normal_sale)}
              className={`flex min-h-[58px] items-center gap-2 rounded-[9px] border px-3 text-left transition-all ${
                !isEstimateBill
                  ? "border-[#b9f0cb] bg-white text-[#0f9f49] shadow-[0_8px_18px_rgba(25,184,90,0.12)]"
                  : "border-transparent bg-transparent text-[#6B6455] hover:bg-white"
              }`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e9fff0] text-[#16a34a]">
                <CheckCircle size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-black">{t("billing.summary.pakkaBill")}</span>
                <span className="block text-[10px] font-semibold opacity-75">{t("billing.summary.pakkaBillHint")}</span>
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
                  : "border-transparent bg-transparent text-[#6B6455] hover:bg-white"
              }`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f1edff] text-[#7c3ff2]">
                <FileText size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-black">{t("billing.summary.estimateBill")}</span>
                <span className="block text-[10px] font-semibold opacity-75">{t("billing.summary.estimateBillHint")}</span>
              </span>
            </button>
          </div>

          {(showCustomerOptions || needsOptionsVisible) && (
            <div className="space-y-2 rounded-[10px] border border-[#e3eaf3] bg-[#FAF7F0] p-3">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-xs font-semibold text-[#6B6455]">{t("billing.summary.billType")}</span>
                <Select value={billType} onValueChange={(v) => setBillType(v as BillTypeSelection)}>
                  <SelectTrigger data-testid="select-bill-type" className="h-8 flex-1 text-xs font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BillInputBillType.normal_sale}>{t("billing.summary.pakkaBill")}</SelectItem>
                    <SelectItem value={BillInputBillType.udhar_entry}>{t("billing.summary.udhar", { credit: words.credit })}</SelectItem>
                    <SelectItem value={BillInputBillType.gst_invoice}>{t("billing.summary.gstInvoice")}</SelectItem>
                    <SelectItem value={BillInputBillType.estimate}>{t("billing.summary.estimateBill")}</SelectItem>
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
                        trackEvent(ACTIVITY_EVENTS.CUSTOMER_SELECTED, { customerId: c.id, customerName: c.name });
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-customer" className="h-9 text-sm">
                      <SelectValue placeholder={t("billing.summary.walkInOption")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk_in">{t("billing.summary.walkInOption")}</SelectItem>
                      {orderedCustomers.map((c) => (
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
                      placeholder={t("billing.summary.namePlaceholder", { credit: words.credit })}
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <Input
                      data-testid="input-customer-mobile"
                      className="h-9 text-sm"
                      inputMode="numeric"
                      placeholder={t("billing.summary.mobilePlaceholder")}
                      value={customerMobile}
                      onChange={(e) => setCustomerMobile(e.target.value.replace(/\D/g, "").slice(0, 15))}
                    />
                  </div>
                  {matchingMobileCustomer && (
                    <p data-testid="text-mobile-customer-match" className="text-xs text-blue-600">
                      {t("billing.summary.mobileMatches", { name: matchingMobileCustomer.name })}
                    </p>
                  )}
                  {(creditAmount > 0 || billType === BillInputBillType.udhar_entry) &&
                    !hasCreditCustomerIdentity && (
                      <p className="text-xs text-amber-600">{t("billing.summary.udharNeedsIdentity", { credit: words.credit })}</p>
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
              onUpdateLineBatch={onUpdateLineBatch}
              onReadScale={onReadScale}
              scaleReadingLineKey={scaleReadingLineKey}
              onRemoveItem={onRemoveItem}
            />
            {cart.length > 0 && (
              <div className="flex min-h-11 items-center border-t border-[#edf1f6] px-3.5">
                <button className="inline-flex min-h-11 items-center text-[12px] font-extrabold text-[var(--brand)] hover:underline">
                  {t("billing.summary.addMoreItems")}
                </button>
                <span className="ml-auto text-[12px] font-bold text-[#6B6455]">
                  {cart.length === 1
                    ? t("billing.summary.itemCount", { count: cart.length })
                    : t("billing.summary.itemCountPlural", { count: cart.length })}
                </span>
              </div>
            )}
            {negativeStockWarnings.length > 0 && (
              <div className="border-t border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-snug text-amber-800">
                <p className="font-black text-amber-900">{t("billing.summary.negativeStockTitle")}</p>
                <p className="mt-0.5 font-semibold">
                  {t("billing.summary.negativeStockDetail", {
                    name: negativeStockWarnings[0].productName,
                    after: negativeStockWarnings[0].after,
                    unit: negativeStockWarnings[0].unit,
                  })}
                </p>
                {negativeStockWarnings.length > 1 && (
                  <p className="mt-1 font-bold">
                    {negativeStockWarnings.length === 2
                      ? t("billing.summary.negativeStockMore", { count: negativeStockWarnings.length - 1 })
                      : t("billing.summary.negativeStockMorePlural", { count: negativeStockWarnings.length - 1 })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Totals box */}
          <div className="rounded-[11px] border border-[#e5ebf4] bg-white px-3 pb-3.5 pt-3">
            {/* Subtotal */}
            <div className="flex h-[29px] items-center justify-between text-[12px]">
              <span className="font-semibold text-[#6B6455]">{t("billing.summary.subtotal")}</span>
              <span data-testid="text-subtotal" className="font-black text-[#3D4354]">{fmtRs(subtotal)}</span>
            </div>

            {lineDiscountTotal > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#6B6455]">{t("billing.summary.lineDiscounts")} <span className="text-[10px] text-[#A9A395]">{t("billing.summary.lineDiscountsHint")}</span></span>
                <span data-testid="text-line-discounts" className="font-black text-[#1a8a4e]">−{fmtRs(lineDiscountTotal)}</span>
              </div>
            )}

            {loyaltyDiscount > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#6B6455]">{t("billing.summary.loyaltyRewards")} <span className="text-[10px] text-[#A9A395]">{t("billing.summary.loyaltyPointsHint", { points: loyaltyPoints.toLocaleString("en-IN") })}</span></span>
                <span className="font-black text-violet-700">−{fmtRs(loyaltyDiscount)}</span>
              </div>
            )}

            {/* GST — exclusive adds to the payable; inclusive is informational */}
            {gstAmount > 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#6B6455]">
                  {t("billing.summary.gst")} <span className="text-[10.5px] text-[#A9A395]">({describeTaxSplit(gstAmount, { cgst: gstCgst, sgst: gstSgst, igst: gstIgst, supplyType: gstSupplyType })})</span>
                </span>
                <span data-testid="text-gst" className={gstMode === "exclusive" ? "font-black text-[#3D4354]" : "font-bold text-[#7C7566]"}>
                  {gstMode === "exclusive" ? `+${fmtRs(gstAmount)}` : t("billing.summary.gstInclusive", { amount: fmtRs(gstAmount) })}
                </span>
              </div>
            )}

            {/* Discount */}
            <div className="flex h-[29px] items-center justify-between text-[12px]">
              <span className="font-semibold text-[#6B6455]">{t("billing.summary.discount")}</span>
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
                    {...discountProps}
                    onBlur={() => { discountProps.onBlur(); setEditingDiscount(false); }}
                    onKeyDown={(e) => { discountProps.onKeyDown(e); if (e.key === "Enter") setEditingDiscount(false); }}
                    className="w-16 rounded-[7px] border border-[#dbe8ff] bg-white px-2 py-1 text-right text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
                    placeholder={t("billing.summary.discountPlaceholder")}
                  />
                )}
                <button
                  onClick={() => setEditingDiscount((v) => !v)}
                  className="inline-flex h-11 items-center rounded-[7px] border border-[#dbe8ff] bg-[#f5f9ff] px-3 text-[11px] font-extrabold text-[var(--brand)] hover:bg-[#eaf2ff]"
                >
                  {safeDiscount > 0 && !editingDiscount ? t("billing.summary.edit") : t("billing.summary.apply")}
                </button>
              </div>
            </div>

            {/* Why the discount — feeds the discounts report. Only shown once a discount exists. */}
            {safeDiscount > 0 && (
              <div className="flex h-[29px] items-center justify-between gap-2 text-[12px]">
                <span className="shrink-0 font-semibold text-[#98917F]">{t("billing.summary.discountReason")}</span>
                <input
                  data-testid="input-discount-reason"
                  type="text"
                  maxLength={200}
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder={t("billing.summary.discountReasonPlaceholder")}
                  className="w-full max-w-[200px] rounded-[7px] border border-transparent bg-[#FAF7F0] px-2 py-1 text-right text-[11px] font-semibold text-[#585E76] placeholder:text-[#9aa7bd] focus:border-[#dbe8ff] focus:bg-white focus:outline-none"
                />
              </div>
            )}

            {/* Round off — the nearest-rupee adjustment folded into the grand total. */}
            {roundOff !== 0 && (
              <div className="flex h-[29px] items-center justify-between text-[12px]">
                <span className="font-semibold text-[#6B6455]">{t("billing.summary.roundOff")}</span>
                <span data-testid="text-round-off" className="font-black text-[#3D4354]">
                  {roundOff > 0 ? "+" : "−"}{fmtRs(Math.abs(roundOff))}
                </span>
              </div>
            )}

            {/* Grand total */}
            <div className="mt-2 flex items-center justify-between border-t border-[#edf1f6] pt-3">
              <span className="font-display text-[18px] font-black tracking-tight text-[var(--brand-ink)]">{t("billing.summary.grandTotal")}</span>
              <span className="font-display text-[21px] font-black tracking-tight text-[var(--brand-ink)]" data-testid="text-total">
                {fmtRs(grandTotal)}
              </span>
            </div>
          </div>

          <button type="button" onClick={() => setShowSaleExtras((value) => !value)} aria-expanded={showSaleExtras} className="flex min-h-11 w-full items-center rounded-[9px] border border-[#dfe8f5] bg-[#f8fbff] px-3.5 text-left text-[12px] font-extrabold text-[#6B6455]">
            {t("billing.summary.moreOptions")}
            <span className="ml-2 text-[10px] font-semibold text-[#98917F]">{t("billing.summary.moreOptionsHint")}</span>
            <ChevronDown size={15} className={`ml-auto transition-transform ${showSaleExtras ? "rotate-180" : ""}`} />
          </button>

          {showSaleExtras ? <>
          {/* Coupon box — dashed blue */}
          <button onClick={() => setCouponExpanded((value) => !value)} aria-expanded={couponExpanded} className="flex h-11 w-full items-center gap-2.5 rounded-[9px] border border-dashed border-[#b9cdf6] bg-white px-3.5 transition-colors hover:bg-[#f5f9ff]">
            <Tag size={15} className="text-[var(--brand)]" />
            <span className="text-[12px] font-extrabold text-[var(--brand)]">{t("billing.summary.applyCoupon")}</span>
            <ChevronRight size={15} className={`ml-auto text-[var(--brand)] transition-transform ${couponExpanded ? "rotate-90" : ""}`} />
          </button>
          {couponExpanded && (
            <div className="rounded-[9px] border border-[#dbe8ff] bg-[#f8fbff] p-2.5">
              <div className="flex items-center gap-2">
                <input autoFocus value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); onCouponApplied?.(null, 0, ""); setCouponMsg(null); }} onKeyDown={(e) => e.key === "Enter" && void handleApplyCoupon()} placeholder={t("billing.summary.couponPlaceholder")} className="h-11 flex-1 rounded-[7px] border border-[#dbe8ff] bg-white px-3 text-[11px] font-semibold uppercase placeholder:font-medium placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
                <button onClick={() => void handleApplyCoupon()} disabled={couponBusy || !couponCode.trim() || subtotal <= 0} className="inline-flex h-11 items-center gap-1 rounded-[7px] bg-[var(--brand)] px-3 text-[11px] font-semibold text-white hover:bg-[#0054e8] disabled:opacity-50">{couponBusy ? <Loader2 size={11} className="animate-spin" /> : <Tag size={11} />} Apply</button>
              </div>
              {couponMsg && <p className={`pt-1.5 text-[10px] font-semibold ${couponMsg.ok ? "text-[#16a34a]" : "text-rose-500"}`}>{couponMsg.text}</p>}
            </div>
          )}

          <button onClick={() => setLoyaltyExpanded((value) => !value)} aria-expanded={loyaltyExpanded} className="flex min-h-11 w-full items-center gap-2.5 rounded-[9px] border border-violet-200 bg-violet-50/60 px-3.5 py-2 transition-colors hover:bg-violet-50">
            <Award size={15} className="text-violet-700" />
            <span className="text-left text-[12px] font-extrabold text-violet-800">{t("billing.summary.useLoyalty")}</span>
            {loyaltyCustomerSelected && loyaltyActive && !loyaltyLoading ? <span className="ml-auto text-[10px] font-black text-violet-700">{t("billing.summary.loyaltyAvailableChip", { points: loyaltyBalance.toLocaleString("en-IN") })}</span> : null}
            <ChevronRight size={15} className={`${loyaltyCustomerSelected && loyaltyActive && !loyaltyLoading ? "" : "ml-auto"} text-violet-700 transition-transform ${loyaltyExpanded ? "rotate-90" : ""}`} />
          </button>
          {loyaltyExpanded && (
            <div className="rounded-[9px] border border-violet-200 bg-violet-50/50 p-3">
              {!loyaltyOnline ? <p className="text-[11px] font-semibold text-amber-700">{t("billing.summary.loyaltyOffline")}</p>
                : !loyaltyCustomerSelected ? <p className="text-[11px] font-semibold text-violet-800">{t("billing.summary.loyaltyNeedsCustomer")}</p>
                  : loyaltyLoading ? <p className="flex items-center gap-2 text-[11px] font-semibold text-violet-700"><Loader2 size={12} className="animate-spin" /> {t("billing.summary.loyaltyLoading")}</p>
                    : !loyaltyActive ? <p className="text-[11px] font-semibold text-slate-600">{t("billing.summary.loyaltyInactive")}</p>
                      : loyaltyBalance < loyaltyMinimumPoints ? <p className="text-[11px] font-semibold text-slate-600">{t("billing.summary.loyaltyBelowMinimum", { tier: loyaltyTier ? t("billing.summary.loyaltyTierPrefix", { tier: loyaltyTier }) : "", points: loyaltyBalance.toLocaleString("en-IN"), minimum: loyaltyMinimumPoints.toLocaleString("en-IN") })}</p>
                        : <>
                            <div className="flex items-center gap-2">
                              <Input type="number" min={loyaltyMinimumPoints} max={loyaltyMaxPoints} {...loyaltyProps} placeholder={t("billing.summary.loyaltyMinPlaceholder", { minimum: loyaltyMinimumPoints })} className="h-11 bg-white text-xs" />
                              <Button type="button" variant="outline" className="h-11 shrink-0 border-violet-200 text-[11px] font-black text-violet-700" disabled={loyaltyMaxPoints < loyaltyMinimumPoints} onClick={() => setLoyaltyPoints(loyaltyMaxPoints)}>{t("billing.summary.loyaltyUseMax")}</Button>
                              {loyaltyPoints > 0 ? <Button type="button" variant="ghost" className="h-11 px-2 text-[11px] font-bold text-slate-500" onClick={() => setLoyaltyPoints(0)}>{t("billing.summary.loyaltyClear")}</Button> : null}
                            </div>
                            <p className="mt-2 text-[10px] font-semibold text-violet-700">{t("billing.summary.loyaltySaveNote", { tier: loyaltyTier ? t("billing.summary.loyaltyTierShortPrefix", { tier: loyaltyTier }) : "", points: loyaltyBalance.toLocaleString("en-IN"), amount: fmtRs(loyaltyDiscount) })}</p>
                            {loyaltyMaxPoints < loyaltyMinimumPoints ? <p className="mt-1 text-[10px] font-semibold text-amber-700">{t("billing.summary.loyaltyBelowRedeemable")}</p> : null}
                          </>}
            </div>
          )}
          </> : null}

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
            retailPaymentDynamicQr={retailPaymentDynamicQr}
            retailPaymentRequired={retailPaymentRequired}
            retailPaymentVerified={retailPaymentVerified}
            retailPaymentLoading={retailPaymentLoading}
            onVerifyRetailPayment={onVerifyRetailPayment}
            upiReference={upiReference}
            setUpiReference={setUpiReference}
            cardTerminalConfigured={cardTerminalConfigured}
            cardTerminalApproved={cardTerminalApproved}
            cardTerminalLoading={cardTerminalLoading}
            onChargeCardTerminal={onChargeCardTerminal}
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
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" role="status">
              <div className="flex items-center gap-2 text-sm font-black">
                <CheckCircle size={16} />
                <span>{t("billing.summary.billSavedSafely")}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-emerald-700">{t("billing.summary.nextBillReady", { billNo: lastBillNo })}</p>
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

        {/* What the active trade needs before this bill can be confirmed — a
            pharmacy's prescription attach sits here, directly above the action
            it unblocks, so the counter is not hunting for it after a refusal. */}
        {tradeSlots}

        {/* Save Bill button — 54px blue gradient */}
        <Button
          data-testid="button-confirm-bill"
          style={{ background: "linear-gradient(180deg, var(--brand) 0%, var(--brand-strong) 100%)" }}
          className="relative h-[54px] w-full rounded-[10px] text-[16px] font-black text-white shadow-[0_12px_24px_rgba(0,77,255,0.28)] hover:opacity-95"
          onClick={cart.length === 0 && lastBillNo ? onNewBill : onConfirmBill}
          disabled={confirmBillPending || (!lastBillNo && cart.length === 0) || (cart.length > 0 && (!newBillingAllowed || !createBillAllowed))}
        >
          {confirmBillPending ? (
            <>
              <Loader2 size={18} className="mr-2 animate-spin" />
              {t("billing.summary.saving")}
            </>
          ) : cart.length === 0 && lastBillNo ? (
            <>Start new bill</>
          ) : (
            <>
              {isEstimateBill
                ? t("billing.summary.saveEstimateAction", { amount: fmtRs(grandTotal) })
                : t("billing.summary.paymentAction", { action: paymentAction, amount: fmtRs(grandTotal) })}
              <span className="absolute right-2.5 top-1/2 hidden h-6 min-w-[34px] -translate-y-1/2 items-center justify-center rounded-[7px] bg-[rgba(0,35,140,0.35)] px-1.5 text-[11px] font-black text-white sm:inline-flex">
                F12
              </span>
            </>
          )}
        </Button>

        {cart.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <SecBtn testId="button-save-as-estimate" onClick={onSaveEstimate} disabled={confirmBillPending} icon={<FileText size={13} />} label={t("billing.summary.saveEstimate")} />
            <SecBtn
              testId="button-hold-bill"
              onClick={onHoldBill}
              disabled={confirmBillPending || holdBillPending}
              icon={holdBillPending ? <Loader2 size={13} className="animate-spin" /> : <PauseCircle size={13} />}
              label={holdBillPending ? t("billing.summary.holding") : t("billing.summary.hold")}
              shortcut="F9"
            />
          </div>
        ) : hasLastPrintableBill ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5" aria-label={t("chrome.savedBillActions")}>
            <SecBtn onClick={onPrintBill} icon={<Printer size={13} />} label={t("billing.summary.print")} />
            <SecBtn primary onClick={onSharePdf} icon={<Smartphone size={13} />} label={t("billing.summary.whatsapp")} />
          </div>
        ) : null}

        {cart.length > 0 && (
          <button
            data-testid="button-clear-cart"
            onClick={onClearCart}
            className="mt-1 min-h-11 w-full rounded-lg py-1.5 text-xs font-medium text-[#6B6455] hover:bg-red-50 hover:text-red-600"
          >
            {t("billing.summary.clearCart")}
          </button>
        )}

        {/* Keyboard shortcuts — 5 buttons */}
        <div className="mt-2 hidden grid-cols-5 gap-1.5 border-t border-[#edf1f6] pt-2.5 sm:grid">
          {[
            { key: "F2", label: t("billing.summary.shortcutSearch") },
            { key: "F4", label: t("billing.summary.shortcutDiscount") },
            { key: "F6", label: t("billing.summary.shortcutCustomer") },
            { key: "F9", label: t("billing.summary.shortcutHold") },
            { key: "Ctrl+S", label: t("billing.summary.shortcutSave") },
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
  primary,
}: {
  testId?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  primary?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={primary ? "flex min-h-11 flex-col items-center gap-1 rounded-[9px] border border-[#15803d] bg-[#16a34a] py-2 text-xs font-bold text-white transition-colors hover:bg-[#15803d] disabled:pointer-events-none disabled:opacity-40" : "flex min-h-11 flex-col items-center gap-1 rounded-[9px] border border-[#e2eaf5] bg-white py-2 text-xs font-bold text-[#3D4354] transition-colors hover:bg-[#FAF7F0] disabled:pointer-events-none disabled:opacity-40"}
    >
      {icon}
      <span>{label}</span>
      {shortcut && <span className="hidden text-[9px] text-[#6B6455] sm:inline">{shortcut}</span>}
    </button>
  );
}
