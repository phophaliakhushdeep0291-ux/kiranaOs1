import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BillInputBillType, BillPaymentMode, getListBillsQueryKey, useConfirmBill, useListCustomers, type Bill, type Customer, type Product, type ProductSellingUnit } from "@/lib/api/client";
import { useListProducts } from "@/features/core/products/queries";
import { bindProductBarcodeLocalFirst } from "@/features/core/products/local-actions";
import type { KnownProductDetails } from "@/features/core/products/product-knowledge";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { createProductLocalFirst } from "@/features/core/products/local-actions";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import { useAuth } from "@/features/core/auth/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/core/sync";
import { useFeature } from "@/features/core/subscription";
import { usePermission } from "@/features/core/staff/permissions";
import { useDebounce } from "@/hooks/use-debounce";
import { offlineDB } from "@/lib/offline/db";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BillingSearch } from "./components/BillingSearch";
import { BillingSummary } from "./components/BillingSummary";
import { OpenBillsBar, type OpenBillChip } from "./components/OpenBillsBar";
import { BillingOrderQrButton } from "@/features/core/customer-order/BillingOrderQrButton";
import { BILLING_DRAFT_KEY, formatHeldBillAge, HELD_BILLS_KEY, isHeldBillStale, newBillId, pruneExpiredHeldBills } from "./open-bills";
import { commitBillingWorkspace, prepareNewBillWorkspace, prepareResumeBillWorkspace } from "./billing-workspace";
import { updateCustomerOrder } from "@/features/core/orders/api";
import { BillingVoicePanel } from "./components/BillingVoicePanel";
import { applyRoundOff, billNeedsCustomer, billingDiscountApprovalSummary, billingSensitiveApprovalFingerprint, calculateCartSubtotal, calculateLineDiscountTotal, cartItemGross, cartItemLineDiscount, cartItemUnitRate, clampAmount, LARGE_DISCOUNT_MIN_AMOUNT, LARGE_DISCOUNT_MIN_PERCENT, lineNeedsOwnerApproval, normalizeSearchText, productSearchText, roundMoney, roundQuantity } from "./billing-calculations";
import { resolveLinePrice } from "@/features/core/pricing/resolve-line-price";
import { sellingUnitMaxPrice } from "@/features/core/products/pages/product-pricing";
import { useShopPricingRules } from "@/features/core/pricing/pricing-rules-cache";
import { writeBillingReceiptErrorWindow, writeBillingReceiptPendingWindow, writeBillingReceiptWindow } from "./billing-print";
import { shareBillOnWhatsapp, derivePaymentModeLabel, type BillShareInput } from "@/features/core/bills/share";
import { deliverBillWhatsapp } from "@/features/core/bills/whatsapp-delivery";
import { getPrinterConfigSync, loadPrinterConfig } from "@/features/core/settings/printer-config";
import { getTaxConfigSync, loadTaxConfig } from "@/features/core/settings/tax-config";
import { isActionProtected, loadSecurityPolicy } from "@/features/core/settings/security-policy";
import { defaultPaymentMode, hasExplicitDefaultPayment, keyboardShortcutsEnabled, playCounterBeep } from "@/features/core/settings/app-preferences";
import { computeGstBreakdown } from "@/lib/gst";
import { gstStateCode } from "@/lib/gstin";
import { toInventoryBaseQty } from "@/features/core/inventory/calculations";
import { parseBillingVoiceCommand } from "./billing-voice-parser";
import type { SellableBatch } from "@/features/core/inventory/inventory-lots-api";
import { billingSlotsFor } from "@/features/core/billing/billing-slots";
import { productConfiguratorFor, type ProductConfigurator } from "@/features/core/billing/product-configurators";
import { SPLIT_PAYMENT, addonUnitPrice, cartItemKey, type AppliedOffer, type BillingDraft, type BillingSensitiveAction, type BillTypeSelection, type CartItem, type HeldBill, type LinePricingMeta, type PaymentSelection, type PrintableBill, type SpeechRecognitionConstructor, type SpeechRecognitionLike, type VoiceNewProductLine, type VoiceParsedDraft } from "./billing-types";
import { createRetailPaymentQr, getRetailPaymentReadiness, verifyRetailPayment, type RetailQrCheckout } from "../retail-payment";
import { RetailDynamicQrDialog } from "./components/RetailDynamicQrDialog";
import { CardTerminalDialog } from "./components/CardTerminalDialog";
import { getCardTerminalReadiness, newCardTerminalRequestId, startCardTerminalCharge, type CardTerminalCharge, type CardTerminalStatus } from "@/features/core/billing/card-terminal";
import { getActiveLocationId } from "@/features/core/stores/location-context";
import { getLoyaltyAccount, getLoyaltyProgram } from "@/features/core/loyalty/api";
import { lookupGiftCard } from "@/features/core/gift-cards/api";
import { startBackendTranscription, type BackendTranscriptionSession } from "@/features/core/voice/backend-transcription";
import { isScaleBillingUnit, readScaleViaHardwareBridge, scaleReadingToBillingQuantity, showCustomerDisplayViaHardwareBridge, type HardwareCustomerDisplayState } from "@/features/core/hardware/local-hardware-bridge";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { speechRecognitionLocale } from "@/features/core/voice/voice-recognition";
import {
  ACTIVITY_EVENTS,
  matchSearchSuggestions,
  preferredFilterFor,
  suggestNextProducts,
  trackEvent,
  trendingProductIds,
  usePersonalization,
} from "@/lib/activity";

const RECENT_PRODUCTS_KEY = "kirana-os:billing-recent-products:v1";
const BILL_SUMMARY_WIDTH_KEY = "kirana-os:bill-summary-width:v1";
const MIN_SUMMARY_WIDTH = 320;
const MAX_SUMMARY_WIDTH = 600;
const MAX_RECENT_PRODUCTS = 18;

function readBillSummaryWidth() {
  try {
    const raw = Number(localStorage.getItem(BILL_SUMMARY_WIDTH_KEY));
    return Number.isFinite(raw) && raw >= MIN_SUMMARY_WIDTH ? Math.min(raw, MAX_SUMMARY_WIDTH) : 376;
  } catch {
    return 376;
  }
}

function clampBillSummaryWidth(value: number) {
  const max = typeof window === "undefined" ? MAX_SUMMARY_WIDTH : Math.min(MAX_SUMMARY_WIDTH, Math.max(MIN_SUMMARY_WIDTH, Math.floor(window.innerWidth * 0.58)));
  return Math.min(Math.max(value, MIN_SUMMARY_WIDTH), max);
}

function productStockQty(product: Product) {
  return roundMoney(Number(product.stockBaseQty ?? product.stockQuantity ?? 0));
}

function productStockUnit(product: Product) {
  return product.baseUnit ?? product.stockUnit ?? product.unit ?? product.displayUnit ?? "unit";
}

function productBelongsToActiveLocation(product: Product) {
  const activeLocationId = getActiveLocationId();
  if (!activeLocationId) return true;
  const productLocationId = (product as Product & { inventoryLocationId?: string; locationId?: string }).inventoryLocationId
    ?? (product as Product & { inventoryLocationId?: string; locationId?: string }).locationId;
  return !productLocationId || productLocationId === activeLocationId;
}

function isStockTracked(product: Product) {
  return (product.stockTrackingEnabled ?? product.trackStock ?? true) !== false;
}

function cartItemBaseQuantity(item: CartItem) {
  if (item.sellingUnit && item.sellingUnit.conversionToBase > 0) {
    return roundQuantity(item.quantity * item.sellingUnit.conversionToBase);
  }
  return toInventoryBaseQty(item.quantity, item.unit, item.product.baseUnit ?? item.product.unit ?? item.unit);
}

function activeSellingUnits(product: Product): ProductSellingUnit[] {
  return (product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
}

function defaultSellingUnit(product: Product): ProductSellingUnit | undefined {
  const units = activeSellingUnits(product);
  return units.find((unit) => unit.isDefault) ?? units[0];
}

let billingDraftCache: BillingDraft = {};

function readBillingDraft(): BillingDraft {
  return billingDraftCache;
}

async function loadBillingDraft(): Promise<BillingDraft> {
  const draft = await offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null);
  billingDraftCache = draft ?? {};
  return billingDraftCache;
}

function writeBillingDraft(draft: BillingDraft) {
  billingDraftCache = draft;
  void offlineDB.setSetting(BILLING_DRAFT_KEY, draft).catch(() => undefined);
}

function clearBillingDraft() {
  billingDraftCache = {};
  void offlineDB.delete("settings", BILLING_DRAFT_KEY).catch(() => undefined);
}

async function loadSettingList<T>(key: string, fallback: T[]): Promise<T[]> {
  return (await offlineDB.getSetting<T[]>(key).catch(() => null)) ?? fallback;
}

function saveSettingList<T>(key: string, rows: T[]) {
  void offlineDB.setSetting(key, rows).catch(() => undefined);
}

export default function Billing() {
  const { t, language } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { shop, user } = useAuth();
  const [location, setLocation] = useLocation();
  const { isOnline } = useOfflineStatus();
  const newBillingFeature = useFeature("new_billing");
  const createBillPermission = usePermission("create_bill");
  const applyDiscountPermission = usePermission("apply_discount");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const customerNameInputRef = useRef<HTMLInputElement | null>(null);
  const summaryResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pendingAutoPrintRef = useRef<{ popup: Window; printable: PrintableBill } | null>(null);
  // §13 "average billing time": the clock starts on the first line of a bill,
  // not on page load. A billing screen left open all morning between customers
  // would otherwise report a 3-hour average bill.
  const billingStartedAtRef = useRef<number | null>(null);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>(() => readBillingDraft().cart ?? []);
  const [pendingProductConfiguration, setPendingProductConfiguration] = useState<{
    product: Product;
    configurator: ProductConfigurator;
    data: unknown;
  } | null>(null);
  const [configuringProductId, setConfiguringProductId] = useState<string | null>(null);
  const [scaleReadingLineKey, setScaleReadingLineKey] = useState<string | null>(null);
  const [discount, setDiscount] = useState(() => readBillingDraft().discount ?? 0);
  const [discountReason, setDiscountReason] = useState(() => readBillingDraft().discountReason ?? "");
  const [appliedOffer, setAppliedOffer] = useState<AppliedOffer | null>(() => readBillingDraft().appliedOffer ?? null);
  // A resumed draft wins; otherwise open on the shop's default payment mode
  // (Settings → Advanced → Default payment).
  const [paymentMode, setPaymentMode] = useState<PaymentSelection>(() => readBillingDraft().paymentMode ?? defaultPaymentMode());
  const [billType, setBillType] = useState<BillTypeSelection>(() => readBillingDraft().billType ?? BillInputBillType.normal_sale);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => readBillingDraft().selectedCustomerId ?? "walk_in");
  const [customerName, setCustomerName] = useState(() => readBillingDraft().customerName ?? "");
  const [customerMobile, setCustomerMobile] = useState(() => readBillingDraft().customerMobile ?? "");
  const [paidAmount, setPaidAmount] = useState<number | "">(() => readBillingDraft().paidAmount ?? "");
  const [splitCashAmount, setSplitCashAmount] = useState<number | "">(() => readBillingDraft().splitCashAmount ?? "");
  const [splitUpiAmount, setSplitUpiAmount] = useState<number | "">(() => readBillingDraft().splitUpiAmount ?? "");
  const [allowAdvancePayment, setAllowAdvancePayment] = useState(() => readBillingDraft().allowAdvancePayment === true);
  const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [activeBillId, setActiveBillId] = useState<string>(() => readBillingDraft().activeBillId ?? newBillId());
  const openBillTransitionLockRef = useRef(false);
  const [openBillTransitionPending, setOpenBillTransitionPending] = useState(false);
  // If the workspace bill came from a customer QR order, its id — so finalizing marks that order
  // fulfilled + links the bill. Mirrored into a ref so the save-success callback reads it live.
  const [sourceOrderId, setSourceOrderId] = useState<string | undefined>(() => readBillingDraft().sourceOrderId);
  const [sourceOrderFingerprint, setSourceOrderFingerprint] = useState<string | undefined>(() => readBillingDraft().sourceOrderFingerprint);
  const sourceOrderIdRef = useRef<string | undefined>(sourceOrderId);
  useEffect(() => { sourceOrderIdRef.current = sourceOrderId; }, [sourceOrderId]);
  const [lastBillNo, setLastBillNo] = useState<string | null>(null);
  const [lastPrintableBill, setLastPrintableBill] = useState<PrintableBill | null>(null);
  const [summaryWidth, setSummaryWidth] = useState(() => readBillSummaryWidth());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hardwareConfigVersion, setHardwareConfigVersion] = useState(0);
  const [sensitivePinOpen, setSensitivePinOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);
  const [pendingPrintBillType, setPendingPrintBillType] = useState<BillTypeSelection | null>(null);
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);

  useEffect(() => {
    if (!mobileCheckoutOpen) return;
    document.body.setAttribute("data-app-mobile-task-open", "true");
    return () => document.body.removeAttribute("data-app-mobile-task-open");
  }, [mobileCheckoutOpen]);
  // Unlisted items the voice draft priced, held while the owner approves creating them.
  const [pendingNewProducts, setPendingNewProducts] = useState<VoiceNewProductLine[] | null>(null);
  const [sensitiveApproval, setSensitiveApproval] = useState<{ ownerPin: string; reason: string; actions: BillingSensitiveAction[]; fingerprint: string } | null>(null);
  const [pendingSensitiveBillType, setPendingSensitiveBillType] = useState<BillTypeSelection | null>(null);
  const [voiceCommand, setVoiceCommand] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<VoiceParsedDraft | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMicMessage, setVoiceMicMessage] = useState(t("billing.page.micDefaultHint"));
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [verifiedRetailPayment, setVerifiedRetailPayment] = useState<{ intentId: string; amountPaise: number; locationId: string } | null>(null);
  const [retailQrCheckout, setRetailQrCheckout] = useState<RetailQrCheckout | null>(null);
  const [customerDisplayFlash, setCustomerDisplayFlash] = useState<{ state: "paid"; totalPaise: number } | null>(null);
  const [cardTerminalCharge, setCardTerminalCharge] = useState<CardTerminalCharge | null>(null);
  const [approvedCardPayment, setApprovedCardPayment] = useState<{ intentId: string; amountPaise: number; locationId: string } | null>(null);
  const [cardTerminalLoading, setCardTerminalLoading] = useState(false);
  const cardTerminalAttemptRef = useRef<{ requestId: string; amountPaise: number; locationId: string | null } | null>(null);
  const [retailPaymentLoading, setRetailPaymentLoading] = useState(false);
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState(0);
  const [giftCardCode, setGiftCardCodeState] = useState("");
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardAmount, setGiftCardAmount] = useState(0);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [giftCardError, setGiftCardError] = useState<string | null>(null);
  const [localProductRows, setLocalProductRows] = useState<Product[]>([]);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBackendRecordingRef = useRef<BackendTranscriptionSession | null>(null);
  const preferBackendVoiceRef = useRef(false);
  const customerDisplayRevisionRef = useRef(Date.now());

  useEffect(() => () => {
    voiceRecognitionRef.current?.abort?.();
    voiceBackendRecordingRef.current?.cancel();
  }, []);

  const requestedBillType = useMemo<BillTypeSelection | null>(() => {
    const query = location.includes("?")
      ? location.slice(location.indexOf("?") + 1)
      : typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : "";
    const raw = (new URLSearchParams(query).get("billType") ?? new URLSearchParams(query).get("type") ?? "").toLowerCase();
    if (["estimate", "rough"].includes(raw)) return BillInputBillType.estimate;
    if (["normal_sale", "normal", "pakka", "paka"].includes(raw)) return BillInputBillType.normal_sale;
    return null;
  }, [location]);

  const debouncedSearch = useDebounce(search.trim(), 90);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const products = useListProducts({ limit: 350 }, {
    query: { staleTime: 2 * 60_000, placeholderData: (previousData: Product[] | undefined) => previousData ?? [] },
  });
  const customers = useListCustomers();
  // Smart Adaptive Pricing — the shop's owner-defined rules (cached, offline-safe).
  const { rules: shopPricingRules } = useShopPricingRules();
  const retailPaymentReadiness = useQuery({ queryKey: ["retail-payment-readiness"], queryFn: getRetailPaymentReadiness, staleTime: 5 * 60_000, retry: false });
  const cardTerminalReadiness = useQuery({ queryKey: ["card-terminal-readiness"], queryFn: getCardTerminalReadiness, staleTime: 5 * 60_000, retry: false });

  const typedCustomerName = customerName.trim();
  const typedCustomerMobile = customerMobile.replace(/\D/g, "").trim();
  const selectedCustomerBackendId = selectedCustomerId === "walk_in" ? "" : selectedCustomerId;
  const selectedCustomer = selectedCustomerBackendId ? customers.data?.find((customer: Customer) => customer.id === selectedCustomerBackendId) : undefined;
  const matchingMobileCustomer = typedCustomerMobile ? customers.data?.find((customer: Customer) => customer.mobile?.replace(/\D/g, "") === typedCustomerMobile) : undefined;
  const resolvedCustomerId = selectedCustomerBackendId || matchingMobileCustomer?.id || "";
  const resolvedCustomerName = selectedCustomer?.name || matchingMobileCustomer?.name || typedCustomerName;
  const resolvedCustomerMobile = selectedCustomer?.mobile || matchingMobileCustomer?.mobile || typedCustomerMobile;
  const resolvedCustomerRecord = selectedCustomer ?? matchingMobileCustomer;
  const resolvedBuyerGstin = resolvedCustomerRecord?.gstNumber ?? undefined;
  const resolvedBuyerStateCode = resolvedCustomerRecord?.stateCode ?? undefined;
  const resolvedBuyerAddress = resolvedCustomerRecord?.address ?? undefined;
  const hasCreditCustomerIdentity = Boolean(resolvedCustomerId || (typedCustomerName && typedCustomerMobile));
  const loyaltyProgram = useQuery({
    queryKey: ["loyalty-program"],
    queryFn: getLoyaltyProgram,
    enabled: isOnline,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const loyaltyAccount = useQuery({
    queryKey: ["loyalty-account", resolvedCustomerId],
    queryFn: () => getLoyaltyAccount(resolvedCustomerId),
    enabled: isOnline && Boolean(resolvedCustomerId) && loyaltyProgram.data?.active === true,
    staleTime: 30_000,
    retry: false,
  });

  const subtotal = useMemo(() => calculateCartSubtotal(cart), [cart]);
  const lineDiscountTotal = useMemo(() => calculateLineDiscountTotal(cart), [cart]);
  // GST: one engine for UI, local record and server. Inclusive (kirana MRP
  // default) extracts tax from the entered prices without changing the payable;
  // exclusive adds it on top after reducing the taxable base by the discount.
  // Seller/buyer state decides CGST+SGST vs IGST. Omitting the jurisdiction made the
  // counter always show CGST+SGST, even when billing an out-of-state buyer — the printed
  // tax invoice already resolved this correctly, so the two disagreed. The engine treats a
  // missing code as intra-state, which is the right default for a walk-in sale.
  const sellerStateCode = gstStateCode(shop?.gstNumber);
  const buyerStateCode = (() => {
    const record = resolvedCustomerRecord as { stateCode?: string | null; gstNumber?: string | null } | undefined;
    const explicit = String(record?.stateCode ?? "").trim();
    return explicit || gstStateCode(record?.gstNumber);
  })();
  // An invoice discount reduces taxable value (CGST Act section 15(3)), so it
  // is capped against the entered line subtotal, not subtotal + GST. Loyalty is
  // another invoice discount and follows the same rule.
  const safeDiscount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const redemptionPaisePerPoint = Number(loyaltyProgram.data?.redemptionPaisePerPoint || 0);
  const loyaltyBalance = Number(loyaltyAccount.data?.account.pointsBalance || 0);
  const loyaltyMaxByBill = redemptionPaisePerPoint > 0
    ? Math.floor((Math.max(0, subtotal - safeDiscount) * 100) / redemptionPaisePerPoint)
    : 0;
  const loyaltyMaxPoints = Math.max(0, Math.min(loyaltyBalance, loyaltyMaxByBill));
  const effectiveLoyaltyPoints = Math.min(Math.max(0, Math.floor(loyaltyPointsToRedeem)), loyaltyMaxPoints);
  const loyaltyDiscount = roundMoney((effectiveLoyaltyPoints * redemptionPaisePerPoint) / 100);
  const totalDiscount = roundMoney(safeDiscount + loyaltyDiscount);
  const gstBreakdown = useMemo(
    () => computeGstBreakdown(
      cart.map((item) => ({ price: cartItemUnitRate(item), quantity: item.quantity, gstRate: item.product.gstRate ?? 0, lineDiscount: cartItemLineDiscount(item) })),
      getTaxConfigSync().mode,
      { sellerStateCode, buyerStateCode },
      totalDiscount,
    ),
    [cart, sellerStateCode, buyerStateCode, totalDiscount],
  );
  const payableBase = roundMoney(gstBreakdown.discountedLineTotal + gstBreakdown.gstToAdd);
  const rawGrandTotal = payableBase;
  // Nearest-rupee round-off (shop's Taxes → "Round off" setting). grandTotal becomes
  // the whole-rupee figure the counter collects, so every downstream tender/split/
  // credit/change-due and the stored total stay consistent with the cash in the drawer.
  const roundOffEnabled = getTaxConfigSync().roundOff;
  const { payable: grandTotal, roundOff: roundOffAmount } = applyRoundOff(rawGrandTotal, roundOffEnabled);
  const effectiveGiftCardAmount = roundMoney(Math.min(Math.max(0, giftCardAmount), giftCardBalance ?? 0, grandTotal));
  const totalGst = gstBreakdown.gst;
  const splitCash = typeof splitCashAmount === "number" ? clampAmount(splitCashAmount, 0, grandTotal) : 0;
  const splitUpi = typeof splitUpiAmount === "number" ? clampAmount(splitUpiAmount, 0, Math.max(0, grandTotal - splitCash)) : 0;
  const splitPaidAmount = roundMoney(Math.min(grandTotal, splitCash + splitUpi));
  const splitUdharAmount = roundMoney(Math.max(0, grandTotal - splitCash - splitUpi));
  const plainPaidAmount = typeof paidAmount === "number"
    ? clampAmount(paidAmount, 0, allowAdvancePayment ? Math.max(grandTotal, paidAmount) : grandTotal)
    : grandTotal;
  const effectivePaidAmount = paymentMode === SPLIT_PAYMENT
    ? splitPaidAmount
    : paymentMode === BillPaymentMode.credit || billType === BillInputBillType.udhar_entry
      ? 0
      : paymentMode === BillPaymentMode.gift_card
        ? grandTotal
        : plainPaidAmount;
  const advanceAmount = allowAdvancePayment && paymentMode !== SPLIT_PAYMENT ? roundMoney(Math.max(0, effectivePaidAmount - grandTotal)) : 0;
  const creditAmount = billType === BillInputBillType.udhar_entry ? grandTotal : roundMoney(Math.max(0, grandTotal - Math.min(effectivePaidAmount, grandTotal)));
  const upiTenderAmount = paymentMode === SPLIT_PAYMENT ? splitUpi : paymentMode === BillPaymentMode.upi ? Math.min(effectivePaidAmount, grandTotal) : 0;
  const upiTenderPaise = Math.round(upiTenderAmount * 100);
  const retailPaymentVerified = Boolean(verifiedRetailPayment
    && verifiedRetailPayment.amountPaise === upiTenderPaise
    && verifiedRetailPayment.locationId === getActiveLocationId());

  // A card terminal charge settles into the bank tender, which is where the
  // acquirer actually credits the shop.
  const cardTenderAmount = paymentMode === BillPaymentMode.bank ? Math.min(effectivePaidAmount, grandTotal) : 0;
  const cardTenderPaise = Math.round(cardTenderAmount * 100);
  const cardPaymentApproved = Boolean(approvedCardPayment
    && approvedCardPayment.amountPaise === cardTenderPaise
    && approvedCardPayment.locationId === getActiveLocationId());

  useEffect(() => {
    if (verifiedRetailPayment && !retailPaymentVerified) setVerifiedRetailPayment(null);
  }, [retailPaymentVerified, verifiedRetailPayment]);

  // An approval is only good for the amount and branch it was taken against;
  // edit the cart and the cashier must charge the card again.
  useEffect(() => {
    if (approvedCardPayment && !cardPaymentApproved) setApprovedCardPayment(null);
  }, [cardPaymentApproved, approvedCardPayment]);

  async function handleChargeCardTerminal() {
    if (!isOnline) {
      toast({ title: t("billing.page.internetRequired"), description: t("billing.page.providerOffline"), variant: "destructive" });
      return;
    }
    if (cardTenderPaise <= 0) return;
    const locationId = getActiveLocationId();
    const previous = cardTerminalAttemptRef.current;
    const requestId = previous && previous.amountPaise === cardTenderPaise && previous.locationId === locationId
      ? previous.requestId
      : newCardTerminalRequestId();
    cardTerminalAttemptRef.current = { requestId, amountPaise: cardTenderPaise, locationId };
    setCardTerminalLoading(true);
    try {
      setCardTerminalCharge(await startCardTerminalCharge(cardTenderPaise, locationId, requestId));
    } catch (error) {
      // Ambiguous provider outcomes are returned as an `uncertain` intent. A
      // thrown error is therefore a definite local/provider rejection and a
      // later click may safely start a fresh request.
      cardTerminalAttemptRef.current = null;
      toast({ title: t("billing.page.paymentNotVerified"), description: error instanceof Error ? error.message : t("billing.page.providerFailed"), variant: "destructive" });
    } finally {
      setCardTerminalLoading(false);
    }
  }

  async function handleVerifyRetailPayment() {
    if (!isOnline) {
      toast({ title: t("billing.page.internetRequired"), description: t("billing.page.providerOffline"), variant: "destructive" });
      return;
    }
    if (upiTenderPaise <= 0) return;
    setRetailPaymentLoading(true);
    try {
      if (retailPaymentReadiness.data?.dynamicQrEnabled) {
        setRetailQrCheckout(await createRetailPaymentQr(upiTenderPaise));
        return;
      }
      const verified = await verifyRetailPayment(upiTenderPaise);
      setVerifiedRetailPayment(verified);
      toast({ title: t("billing.page.upiVerified"), description: t("billing.page.upiVerifiedDetail") });
    } catch (error) {
      toast({ title: t("billing.page.paymentNotVerified"), description: error instanceof Error ? error.message : t("billing.page.providerFailed"), variant: "destructive" });
    } finally {
      setRetailPaymentLoading(false);
    }
  }

  function setGiftCardCode(value: string) {
    setGiftCardCodeState(value);
    setGiftCardBalance(null);
    setGiftCardAmount(0);
    setGiftCardError(null);
  }

  async function handleLookupGiftCard() {
    if (!isOnline) return;
    setGiftCardLoading(true);
    setGiftCardError(null);
    try {
      const card = await lookupGiftCard(giftCardCode);
      if (card.status !== "active") throw new Error(t("billing.page.giftCardStatus", { status: card.status }));
      setGiftCardBalance(card.balance);
      setGiftCardAmount(roundMoney(Math.min(card.balance, grandTotal)));
    } catch (error) {
      setGiftCardBalance(null);
      setGiftCardAmount(0);
      setGiftCardError(error instanceof Error ? error.message : t("billing.page.giftCardUnverified"));
    } finally {
      setGiftCardLoading(false);
    }
  }

  // Demo "sample" products (id starts with "demo_") are example data for the dashboard tour
  // only — they don't exist on the server, so a real bill that referenced them would land in
  // permanent sync CONFLICT ("Product not found: demo_product_…"). Keep them out of billing.
  useEffect(() => {
    let cancelled = false;
    const loadLocalProducts = async () => {
      const rows = await offlineDB.getAll<Product>("products").catch(() => []);
      if (!cancelled) setLocalProductRows(rows.filter(productBelongsToActiveLocation));
    };
    void loadLocalProducts();
    window.addEventListener("kirana:local-data-changed", loadLocalProducts);
    window.addEventListener("kirana:sync-queue-updated", loadLocalProducts);
    return () => {
      cancelled = true;
      window.removeEventListener("kirana:local-data-changed", loadLocalProducts);
      window.removeEventListener("kirana:sync-queue-updated", loadLocalProducts);
    };
  }, []);

  // The products repository already reconciles server rows with pending local
  // work. Direct IndexedDB rows are only an instant first-paint fallback; using
  // them after an authoritative empty response resurrects removed products.
  const productRows = useMemo(
    () => products.data === undefined ? localProductRows : products.data,
    [products.data, localProductRows],
  );

  const allProducts = useMemo(() => productRows.filter((product) => product.deletedAt == null && (product as { deleted_at?: unknown }).deleted_at == null && !String(product.id ?? "").startsWith("demo_")), [productRows]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    allProducts.forEach((product) => {
      const category = product.category?.trim();
      if (category) set.add(category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 14);
  }, [allProducts]);

  const productById = useMemo(() => new Map(allProducts.map((product) => [product.id, product])), [allProducts]);

  const negativeStockWarnings = useMemo(() => cart
    .filter((item) => !item.isCustom && isStockTracked(item.product))
    .map((item) => {
      const available = productStockQty(item.product);
      const requested = cartItemBaseQuantity(item);
      const after = roundMoney(available - requested);
      if (after >= 0) return null;
      const unit = productStockUnit(item.product);
      return {
        productId: item.product.id,
        productName: item.product.name,
        available,
        requested,
        after,
        unit,
      };
    })
    .filter((warning): warning is NonNullable<typeof warning> => warning != null), [cart]);

  const productSearchIndex = useMemo(() => allProducts.map((product) => ({
    product,
    searchText: productSearchText(product),
    category: product.category ?? "",
  })), [allProducts]);


  // §13 personalization. The device's own recent list still leads — "what I just
  // touched" is what the user is reaching for — and the learned ranking fills the
  // rest, so a freshly set-up counter shows the shop's real sellers instead of an
  // empty row. Ordering only; nothing is hidden and nothing is pre-selected.
  const personalization = usePersonalization(Boolean(shop?.id));
  const recentProducts = useMemo(() => {
    const ordered: string[] = [...recentProductIds];
    for (const suggestion of personalization.data?.quickProducts ?? []) {
      if (!ordered.includes(suggestion.key)) ordered.push(suggestion.key);
    }
    return ordered
      .slice(0, 8)
      .map((id) => productById.get(id))
      .filter((p): p is Product => p != null);
  }, [recentProductIds, productById, personalization.data]);

  // "Predicting likely products for upcoming billing actions" and "suggesting
  // commonly purchased product combinations" are the same row on screen, because
  // they answer the same question at different moments: an empty cart asks "what
  // does this user start with at this hour", a filled one asks "what goes with
  // this". One row means one place to look, not two competing shelves.
  const cartProductIds = useMemo(
    () => cart.filter((item) => !item.isCustom).map((item) => item.product.id),
    [cart],
  );
  const nextSuggestion = useMemo(() => {
    const { reason, productIds } = suggestNextProducts(personalization.data, cartProductIds);
    const products = productIds.map((id) => productById.get(id)).filter((p): p is Product => p != null);
    return products.length > 0 ? { reason, products } : { reason: null, products: [] };
  }, [personalization.data, cartProductIds, productById]);

  // "Highlighting trending products based on online sessions" — a marker on the
  // cards that are already on screen, not a separate shelf competing for space.
  const trendingIds = useMemo(() => trendingProductIds(personalization.data), [personalization.data]);

  const searchSuggestions = useMemo(
    () => matchSearchSuggestions(personalization.data, search),
    [personalization.data, search],
  );

  // "Retaining preferred filters": restore the category this user actually works
  // in, once, on first load. Applied only while the box is untouched — a restored
  // filter that fought the user's own choice would be worse than none.
  const filterRestored = useRef(false);
  useEffect(() => {
    // Both inputs load asynchronously and in either order, so this waits for the
    // category list too. Latching on personalization alone silently did nothing
    // whenever products resolved second — which on a real counter is most times.
    if (filterRestored.current || !personalization.data || categories.length === 0) return;
    filterRestored.current = true;
    const preferred = preferredFilterFor(personalization.data, "/billing");
    if (!preferred || preferred === "all") return;
    // Stored lowercased by the aggregator; the product's own casing is what the
    // filter compares against.
    const match = categories.find((category) => category.toLowerCase() === preferred.toLowerCase());
    if (match) setSelectedCategory(match);
  }, [personalization.data, categories]);

  // "Learning and suggesting preferred payment methods". Deliberately narrow:
  // it only fills a default nobody has set, only before the bill has been
  // touched, and only for cash/UPI. Credit and gift-card change what the bill
  // *means*, and split is usually an artefact of one unusual sale — none of
  // those may be chosen for the user.
  const learnedPaymentApplied = useRef(false);
  const draftHadPaymentMode = useRef(readBillingDraft().paymentMode != null);
  useEffect(() => {
    if (learnedPaymentApplied.current || !personalization.data) return;
    learnedPaymentApplied.current = true;
    if (draftHadPaymentMode.current || hasExplicitDefaultPayment() || cart.length > 0) return;
    const learned = personalization.data.preferredPaymentMethod;
    if (learned !== BillPaymentMode.cash && learned !== BillPaymentMode.upi) return;
    if (learned === defaultPaymentMode()) return;
    setPaymentMode(learned);
  }, [personalization.data, cart.length]);

  function chooseCategory(category: string) {
    setSelectedCategory(category);
    // Recorded so the preference above can be learned in the first place; "all"
    // is the default, so choosing it is a reset rather than a preference.
    if (category !== "all") {
      trackEvent(ACTIVITY_EVENTS.FEATURE_USED, { feature: "billing_category_filter", filters: [category] }, { screen: "/billing" });
    }
  }

  const filteredProducts = useMemo(() => {
    const q = normalizeSearchText(deferredSearch);
    const categoryFiltered = selectedCategory === "all" ? productSearchIndex : productSearchIndex.filter((entry) => entry.category === selectedCategory);
    if (!q) return categoryFiltered.slice(0, 30).map((entry) => entry.product);
    const starts = categoryFiltered.filter((entry) => entry.searchText.startsWith(q));
    const contains = categoryFiltered.filter((entry) => !entry.searchText.startsWith(q) && entry.searchText.includes(q));
    return [...starts, ...contains].slice(0, 30).map((entry) => entry.product);
  }, [deferredSearch, productSearchIndex, selectedCategory]);


  useEffect(() => {
    let active = true;
    void Promise.all([loadBillingDraft(), loadSettingList<HeldBill>(HELD_BILLS_KEY, [])])
      .then(([draft, held]) => {
        if (!active) return;
        if (Object.keys(draft).length > 0) {
          if (draft.activeBillId) setActiveBillId(draft.activeBillId);
          setSourceOrderId(draft.sourceOrderId);
          setSourceOrderFingerprint(draft.sourceOrderFingerprint);
          setCart(draft.cart ?? []);
          setDiscount(draft.discount ?? 0);
          setDiscountReason(draft.discountReason ?? "");
          setAppliedOffer(draft.appliedOffer ?? null);
          setPaymentMode(draft.paymentMode ?? BillPaymentMode.cash);
          setBillType(draft.billType ?? BillInputBillType.normal_sale);
          setSelectedCustomerId(draft.selectedCustomerId ?? "walk_in");
          setCustomerName(draft.customerName ?? "");
          setCustomerMobile(draft.customerMobile ?? "");
          setPaidAmount(draft.paidAmount ?? "");
          setSplitCashAmount(draft.splitCashAmount ?? "");
          setSplitUpiAmount(draft.splitUpiAmount ?? "");
          // `=== true`, never `?? false`: the draft is unvalidated persisted JSON, and
          // ?? only replaces null/undefined — a stored 0/1 would flow through as a
          // NUMBER and every save would then fail Zod with "Expected boolean, received
          // number", permanently, because the bad value is rewritten to the draft.
          setAllowAdvancePayment(draft.allowAdvancePayment === true);
          setDraftRestored(Boolean(draft.cart?.length));
        }
        // Drop week-old parked carts on load — they're abandoned, not open, and
        // waste a capped switcher slot. Persist the pruned set so it stays clean.
        const { kept, archived } = pruneExpiredHeldBills(held);
        setHeldBills(kept.slice(0, 10));
        if (archived > 0) {
          saveSettingList(HELD_BILLS_KEY, kept);
          toast({ title: archived === 1 ? t("billing.page.parkedBillsCleared", { count: archived }) : t("billing.page.parkedBillsClearedPlural", { count: archived }), description: t("billing.page.parkedBillsClearedDetail") });
        }
      })
      .finally(() => {
        if (active) setDraftHydrated(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    writeBillingDraft({ activeBillId, sourceOrderId, sourceOrderFingerprint, cart, discount: safeDiscount, discountReason, appliedOffer, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment });
  }, [draftHydrated, activeBillId, sourceOrderId, sourceOrderFingerprint, cart, safeDiscount, discountReason, appliedOffer, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment]);

  // Re-price the cart when a pricing input changes (customer, group, payment
  // mode, or the shop's rules). Manual/custom lines keep the cashier's price;
  // everything else follows the engine. This is the spec's "recalculate on
  // relevant change" behaviour. Runs only after the draft has hydrated so it
  // never fights the initial restore.
  useEffect(() => {
    if (!draftHydrated) return;
    setCart((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        if (item.manualRate || item.isCustom) return item;
        const priced = resolveLine(item.product, item.quantity, item.sellingUnit);
        if (Math.abs(priced.rate - item.rate) > 0.005 || item.pricing?.explanation !== priced.pricing.explanation) {
          changed = true;
          return { ...item, rate: priced.rate, pricing: priced.pricing };
        }
        return item;
      });
      return changed ? next : previous;
    });
    // resolveLine closes over the same inputs listed here; excluded to avoid a new identity each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHydrated, resolvedCustomerId, selectedCustomer, paymentMode, shopPricingRules]);

  useEffect(() => {
    if (discount !== safeDiscount) setDiscount(safeDiscount);
  }, [discount, safeDiscount]);

  useEffect(() => {
    if (!draftHydrated || !requestedBillType) return;
    setBillType(requestedBillType);
  }, [draftHydrated, requestedBillType]);

  useEffect(() => {
    if (!draftHydrated || billType !== BillInputBillType.estimate) return;
    setPaymentMode(BillPaymentMode.cash);
    setPaidAmount("");
    setSplitCashAmount("");
    setSplitUpiAmount("");
    setAllowAdvancePayment(false);
  }, [billType, draftHydrated]);

  // Hydrate the printer + tax config caches so receipts honour the saved paper
  // size/copies/footer and totals honour the saved GST mode from Settings.
  useEffect(() => {
    void loadPrinterConfig().finally(() => setHardwareConfigVersion((current) => current + 1));
    void loadTaxConfig();
    void loadSecurityPolicy(); // which counter actions still ask for the owner PIN
  }, []);

  // A confirmed or abandoned payment is news, not a lasting state: the customer
  // needs to see it, then the display returns to whatever the cart is doing.
  useEffect(() => {
    if (!customerDisplayFlash) return;
    const timeout = window.setTimeout(() => setCustomerDisplayFlash(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [customerDisplayFlash]);

  // While a dynamic QR is live the customer must see the amount they are about
  // to approve, which for a split tender is the UPI leg — not the bill total.
  const customerDisplayFrame = useMemo<Pick<HardwareCustomerDisplayState, "state" | "totalPaise">>(() => {
    if (customerDisplayFlash) return customerDisplayFlash;
    if (retailQrCheckout && ["creating", "pending"].includes(retailQrCheckout.status)) {
      return { state: "awaiting_payment", totalPaise: retailQrCheckout.amountPaise };
    }
    return { state: cart.length > 0 ? "sale" : "idle", totalPaise: Math.round(grandTotal * 100) };
  }, [customerDisplayFlash, retailQrCheckout, cart.length, grandTotal]);

  useEffect(() => {
    if (hardwareConfigVersion === 0) return;
    const printer = getPrinterConfigSync();
    if (printer.connection !== "bridge" || !printer.customerDisplay) return;
    const revision = Math.max(Date.now(), customerDisplayRevisionRef.current + 1);
    customerDisplayRevisionRef.current = revision;
    const timeout = window.setTimeout(() => {
      void showCustomerDisplayViaHardwareBridge(printer.bridgeUrl, {
        revision,
        state: customerDisplayFrame.state,
        itemCount: cart.length,
        totalPaise: customerDisplayFrame.totalPaise,
      }).catch(() => {
        // A customer display is informative, never a reason to block billing or
        // repeatedly interrupt a cashier. Settings exposes an explicit test.
      });
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [cart.length, customerDisplayFrame, hardwareConfigVersion]);

  useEffect(() => {
    setSensitiveApproval(null);
  }, [safeDiscount, subtotal, cart, effectiveLoyaltyPoints]);

  useEffect(() => {
    setLoyaltyPointsToRedeem(0);
    setGiftCardCode("");
  }, [resolvedCustomerId]);

  useEffect(() => {
    if (billType === BillInputBillType.estimate) setLoyaltyPointsToRedeem(0);
  }, [billType]);

  useEffect(() => {
    if (loyaltyPointsToRedeem !== effectiveLoyaltyPoints) setLoyaltyPointsToRedeem(effectiveLoyaltyPoints);
  }, [effectiveLoyaltyPoints, loyaltyPointsToRedeem]);

  useEffect(() => {
    if (!allowAdvancePayment && typeof paidAmount === "number" && paidAmount > grandTotal) setPaidAmount(grandTotal);
    setSplitCashAmount((current) => typeof current === "number" ? clampAmount(current, 0, grandTotal) : current);
    setSplitUpiAmount((current) => {
      const cash = typeof splitCashAmount === "number" ? clampAmount(splitCashAmount, 0, grandTotal) : 0;
      return typeof current === "number" ? clampAmount(current, 0, Math.max(0, grandTotal - cash)) : current;
    });
  }, [allowAdvancePayment, grandTotal, paidAmount, splitCashAmount]);

  const confirmBill = useConfirmBill({
    mutation: {
      onSuccess: (data: Bill) => {
        const billNo = data.billNumber ?? data.billNo ?? `PENDING-${Date.now()}`;
        setVerifiedRetailPayment(null);
        // Coupon usage and discount impact commit atomically with the bill.
        setAppliedOffer(null);
        const pendingPrint = pendingAutoPrintRef.current;
        const printableForSavedBill = pendingPrint
          ? { ...pendingPrint.printable, billId: data.id, billNo, createdAt: data.createdAt ?? pendingPrint.printable.createdAt }
          : null;
        setLastBillNo(billNo);
        setLastPrintableBill((previous) => printableForSavedBill ?? (previous ? { ...previous, billId: data.id, billNo, createdAt: data.createdAt ?? previous.createdAt } : null));
        if (pendingPrint && printableForSavedBill) {
          try {
            writeBillingReceiptWindow(pendingPrint.popup, printableForSavedBill, { autoPrint: true });
          } catch {
            toast({ title: t("billing.page.printWindowClosed"), description: t("billing.page.printWindowClosedDetail"), variant: "destructive" });
          } finally {
            pendingAutoPrintRef.current = null;
          }
        }
        // If this bill was made from a customer QR order, close that order out and link the bill.
        // Best-effort + online-only (the inbox needs the network anyway); on failure the owner can
        // still "Mark done" by hand, so a caught error must not disturb the save.
        const fulfilledOrderId = sourceOrderIdRef.current;
        if (fulfilledOrderId) {
          sourceOrderIdRef.current = undefined;
          // Link the stable bill id (a local-first "PENDING-…" number would be a throwaway).
          const linkedBillId = data.id ?? data.billNumber ?? data.billNo ?? billNo;
          void updateCustomerOrder(fulfilledOrderId, { status: "fulfilled", billId: linkedBillId })
            .then(() => queryClient.invalidateQueries({ queryKey: ["customer-orders"] }))
            .catch(() => undefined);
        }
        setSensitiveApproval(null);
        setMobileCheckoutOpen(false);
        resetCurrentBill();
        setActiveBillId(newBillId());
        clearBillingDraft();
        queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["customers"] });
        queryClient.invalidateQueries({ queryKey: ["customers-ledger-list"] });
        queryClient.invalidateQueries({ queryKey: ["udhar-dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["udhar"] });
        queryClient.invalidateQueries({ queryKey: ["loyalty-account"] });
        queryClient.invalidateQueries({ queryKey: ["loyalty-accounts"] });
        playCounterBeep("success"); // honours Settings → Advanced → Sound effects
        toast({ title: t("billing.page.billSaved", { billNo }), description: isOnline ? t("billing.page.billSavedOnline") : t("billing.page.billSavedOffline") });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? t("billing.page.saveFailedLocally");
        if (pendingAutoPrintRef.current) {
          try {
            writeBillingReceiptErrorWindow(pendingAutoPrintRef.current.popup, msg);
          } catch {
            // The toast below is still the source of truth if the print window is gone.
          } finally {
            pendingAutoPrintRef.current = null;
          }
        }
        playCounterBeep("error");
        toast({ title: t("billing.page.billingError"), description: msg, variant: "destructive" });
      },
    },
  });

  function resetCurrentBill() {
    setSourceOrderId(undefined);
    setSourceOrderFingerprint(undefined);
    setCart([]);
    setDiscount(0);
    setDiscountReason("");
    setAppliedOffer(null);
    setLoyaltyPointsToRedeem(0);
    setPaidAmount("");
    setSplitCashAmount("");
    setSplitUpiAmount("");
    setCustomerName("");
    setCustomerMobile("");
    setSelectedCustomerId("walk_in");
    setBillType(requestedBillType ?? BillInputBillType.normal_sale);
    setPaymentMode(defaultPaymentMode()); // next bill starts on the shop's default too
    setAllowAdvancePayment(false);
    setDraftRestored(false);
  }

  function rememberRecentProduct(productId: string) {
    if (productId.startsWith("custom-")) return;
    setRecentProductIds((previous) => {
      const next = [productId, ...previous.filter((id) => id !== productId)].slice(0, MAX_RECENT_PRODUCTS);
      saveSettingList(RECENT_PRODUCTS_KEY, next);
      return next;
    });
  }

  // Canonical price for a line: the Smart Pricing engine over product tiers +
  // owner rules + this bill's customer/group/payment. With no rules it returns
  // exactly productSellingPrice(), so behaviour is unchanged until rules exist.
  // Returns the rate + the metadata the cart chip shows (why this price).
  function resolveLine(product: Product, quantity: number, selectedUnit = defaultSellingUnit(product)): { rate: number; pricing: LinePricingMeta } {
    const result = resolveLinePrice(product, {
      shopId: shop?.id,
      quantity,
      sellingUnitId: selectedUnit?.id,
      unitCode: selectedUnit?.unitCode ?? product.rateUnit ?? product.displayUnit ?? "piece",
      unitLabel: selectedUnit?.name,
      defaultPrice: selectedUnit?.defaultPrice,
      minimumSellingPrice: selectedUnit?.minimumPrice ?? undefined,
      // The product MRP belongs to the default pack; a bigger pack gets it scaled
      // to its own size, or its price is clamped to another size's ceiling.
      maximumRetailPrice: sellingUnitMaxPrice(selectedUnit, product, defaultSellingUnit(product)),
      productCost: selectedUnit?.costPrice ?? undefined,
      useLegacyProductRules: selectedUnit?.isDefault !== false,
      shopRules: shopPricingRules,
      customerId: resolvedCustomerId || undefined,
      customerGroup: (selectedCustomer as { customerGroup?: string } | undefined)?.customerGroup || undefined,
      paymentMethod: paymentMode !== SPLIT_PAYMENT ? String(paymentMode) : undefined,
      source: "BILLING",
    });
    return {
      rate: result.recommendedUnitPrice,
      pricing: {
        explanation: result.explanation,
        appliedRuleType: result.appliedRuleType,
        originalUnitPrice: result.originalUnitPrice,
        requiresApproval: result.requiresApproval,
        confidence: result.confidence,
        appliedRuleId: result.appliedRuleId,
        calculationVersion: result.calculationVersion,
        minimumAllowedPrice: result.minimumAllowedPrice,
        maximumAllowedPrice: result.maximumAllowedPrice,
      },
    };
  }

  function commitAddToCart(product: Product, options?: { custom?: boolean; addons?: CartItem["addons"] }) {
    setCart((previous) => {
      const sellingUnit = defaultSellingUnit(product);
      const candidate: CartItem = {
        product,
        quantity: 1,
        rate: product.defaultPricePerRateUnit,
        unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece",
        sellingUnit,
        isCustom: options?.custom,
        addons: options?.addons,
      };
      const candidateKey = cartItemKey(candidate);
      const existing = previous.find((item) => cartItemKey(item) === candidateKey);
      if (existing && !options?.custom) {
        const quantity = roundQuantity(existing.quantity + 1);
        const priced = resolveLine(product, quantity, existing.sellingUnit);
        return previous.map((item) => cartItemKey(item) === candidateKey ? { ...item, quantity, rate: item.manualRate ? item.rate : priced.rate, pricing: item.manualRate ? item.pricing : priced.pricing } : item);
      }
      const quantity = 1;
      const priced = resolveLine(product, quantity, sellingUnit);
      return [...previous, { product, quantity, rate: options?.custom ? product.defaultPricePerRateUnit : priced.rate, unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece", sellingUnit, isCustom: options?.custom, manualRate: options?.custom, pricing: options?.custom ? undefined : priced.pricing, addons: options?.addons }];
    });
    rememberRecentProduct(product.id);
    if (billingStartedAtRef.current === null) billingStartedAtRef.current = Date.now();
    if (!options?.custom) {
      trackEvent(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: product.id, productName: product.name });
    }
    setSearch("");
  }

  function addToCart(product: Product, options?: { custom?: boolean }) {
    if (options?.custom) {
      commitAddToCart(product, options);
      return;
    }
    const configurator = productConfiguratorFor(product);
    if (!configurator) {
      commitAddToCart(product);
      return;
    }
    if (configuringProductId) return;
    setConfiguringProductId(product.id);
    void configurator.load(product)
      .then((data) => {
        if (data) setPendingProductConfiguration({ product, configurator, data });
        else commitAddToCart(product);
      })
      .catch((error: unknown) => {
        toast({
          title: t("billing.page.unitChoicesFailed"),
          description: error instanceof Error ? error.message : t("billing.page.tryAgain"),
          variant: "destructive",
        });
      })
      .finally(() => setConfiguringProductId(null));
  }

  /**
   * Capture-on-first-scan: bind the code the till just read to the item the cashier picked.
   *
   * Local-first, so it works with no network and the next scan of the same packet resolves
   * on this device immediately. The cached product list is patched in place rather than
   * refetched for the same reason — a refetch would need the internet the shop may not
   * have, and would undo the point of binding offline.
   */
  async function bindScannedBarcode(product: Product, code: string) {
    const updated = await bindProductBarcodeLocalFirst(product.id, code);
    queryClient.setQueriesData<Product[]>({ queryKey: ["products"] }, (rows) =>
      Array.isArray(rows) ? rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)) : rows,
    );
  }

  /** Genuinely new stock: open the product form with the scanned code already filled in. */
  function createProductForScannedBarcode(code: string, knownProduct?: KnownProductDetails) {
    setLocation("/products");
    // Same handoff the voice assistant uses: the form listens for this draft once the
    // products route has mounted.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kirana:voice-product-draft", {
        detail: {
          draft: {
            mode: "create",
            barcode: code,
            ...(knownProduct ? {
              name: knownProduct.name,
              brand: knownProduct.brand,
              category: knownProduct.category,
              unit: knownProduct.unit,
              packSizeValue: knownProduct.packSizeValue,
              packSizeUnit: knownProduct.packSizeUnit,
              aliases: knownProduct.aliases,
              description: knownProduct.description,
              imageUrl: knownProduct.imageUrl ?? undefined,
            } : {}),
          },
          merge: false,
        },
      }));
    }, 350);
  }

  function parseVoiceDraft(commandOverride?: string) {
    const command = (commandOverride ?? voiceCommand).trim();
    if (!command) {
      toast({ title: t("billing.page.voiceCommandEmpty"), description: t("billing.page.voiceCommandEmptyDetail"), variant: "destructive" });
      return;
    }
    const draft = parseBillingVoiceCommand(command, allProducts);
    setVoiceDraft(draft);
    if (draft.lines.length === 0) {
      toast({ title: t("billing.page.noProductMatched"), description: t("billing.page.noProductMatchedDetail"), variant: "destructive" });
      return;
    }
    toast({ title: t("billing.page.voiceDraftReady"), description: draft.lines.length === 1 ? t("billing.page.voiceDraftReadyDetail", { count: draft.lines.length }) : t("billing.page.voiceDraftReadyDetailPlural", { count: draft.lines.length }) });
  }

  /**
   * Turn the voice draft's unlisted items into real products, then bill them.
   *
   * Built through the product form's own pipeline rather than a hand-rolled input, so a
   * voice-created product is shaped exactly like a typed one — same defaults, same paise
   * mirrors, same default pack. Only the name and the spoken price are ours; cost, pack
   * size and the rest stay empty on purpose, which is what marks it as needing details.
   */
  async function createVoiceProducts(rows: VoiceNewProductLine[], ownerPin: string, reason: string) {
    const created: Product[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const form = { ...productToForm(), name: row.name, sellingPrice: row.sellingPrice };
        created.push(await createProductLocalFirst(formToInput(form, ownerPin, reason)));
      } catch (error) {
        failed.push(error instanceof Error ? error.message : row.name);
      }
    }
    if (created.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setCart((previous) => {
        let next = [...previous];
        for (const product of created) {
          const row = rows.find((candidate) => candidate.name === normalizeSearchText(product.name)) ?? rows[created.indexOf(product)];
          const sellingUnit = defaultSellingUnit(product);
          next = [...next, {
            product,
            quantity: row?.quantity ?? 1,
            rate: row?.sellingPrice ?? 0,
            unit: sellingUnit?.name ?? product.rateUnit ?? "piece",
            sellingUnit,
            manualRate: true,
          }];
          rememberRecentProduct(product.id);
          trackEvent(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: product.id, productName: product.name, via: "voice_new_product" });
        }
        return next;
      });
      if (billingStartedAtRef.current === null) billingStartedAtRef.current = Date.now();
    }
    if (failed.length > 0) {
      toast({ title: t("billing.page.newProductFailed"), description: failed[0], variant: "destructive" });
    }
    return created.length;
  }

  function addVoiceDraftToCart() {
    if (!voiceDraft) return;
    // Creating a catalogue entry is owner-approved everywhere else in the app, and the
    // till is not the place to make an exception: the approval happens here instead of
    // sending the cashier to the Products screen, so the half-built bill survives it.
    if (voiceDraft.newProducts.length > 0) {
      setPendingNewProducts(voiceDraft.newProducts);
      return;
    }
    if (voiceDraft.lines.length === 0) return;
    setCart((previous) => {
      let next = [...previous];
      for (const line of voiceDraft.lines) {
        const sellingUnit = activeSellingUnits(line.product).find((unit) =>
          [unit.name, unit.unitType, unit.packSizeUnit].filter(Boolean).some((value) => String(value).toLowerCase() === line.unit.toLowerCase()),
        ) ?? defaultSellingUnit(line.product);
        const candidate: CartItem = {
          product: line.product,
          quantity: line.quantity,
          rate: line.rate,
          unit: sellingUnit?.name ?? line.unit,
          sellingUnit,
          manualRate: true,
        };
        const candidateKey = cartItemKey(candidate);
        const existing = next.find((item) => cartItemKey(item) === candidateKey);
        if (existing) {
          next = next.map((item) => cartItemKey(item) === candidateKey ? { ...item, quantity: roundQuantity(item.quantity + line.quantity), rate: line.rate, unit: candidate.unit, sellingUnit, manualRate: true } : item);
        } else {
          next.push(candidate);
        }
      }
      return next;
    });
    voiceDraft.lines.forEach((line) => rememberRecentProduct(line.product.id));
    trackEvent(ACTIVITY_EVENTS.VOICE_COMMAND_USED, { lines: voiceDraft.lines.length, matched: true });
    for (const line of voiceDraft.lines) {
      trackEvent(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: line.product.id, productName: line.product.name, via: "voice" });
    }
    if (billingStartedAtRef.current === null) billingStartedAtRef.current = Date.now();
    if (voiceDraft.customerName) {
      setSelectedCustomerId("walk_in");
      setCustomerName(voiceDraft.customerName);
    }
    if (voiceDraft.udharAmount !== undefined) {
      setPaymentMode(BillPaymentMode.credit);
      setBillType(BillInputBillType.normal_sale);
      setPaidAmount(0);
    }
    setVoiceCommand("");
    setVoiceDraft(null);
    toast({ title: t("billing.page.addedToCart"), description: t("billing.page.addedToCartDetail") });
  }

  async function startBackendVoiceListening() {
    const existingText = voiceCommand.trim();
    setVoiceMicMessage(t("billing.page.micRequesting"));
    try {
      voiceBackendRecordingRef.current = await startBackendTranscription({
        onStart: () => {
          setVoiceListening(true);
          setVoiceMicMessage(t("billing.page.micRecording"));
        },
        onTranscribing: () => {
          setVoiceListening(false);
          setVoiceMicMessage(t("billing.page.micTranscribing"));
        },
        onTranscript: ({ transcript, provider }) => {
          setVoiceCommand(existingText ? `${existingText} ${transcript}` : transcript);
          setVoiceMicMessage(t("billing.page.micCapturedWithProvider", { provider }));
        },
        onError: (message) => {
          setVoiceMicMessage(message);
          toast({ title: t("billing.page.voiceTranscription"), description: message, variant: "destructive" });
        },
        onEnd: () => {
          voiceBackendRecordingRef.current = null;
          setVoiceListening(false);
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("billing.page.voiceRecordingFailed");
      voiceBackendRecordingRef.current = null;
      setVoiceListening(false);
      setVoiceMicMessage(message);
      toast({ title: t("billing.page.micCouldNotStart"), description: message, variant: "destructive" });
    }
  }

  async function startVoiceListening() {
    if (voiceListening) {
      if (voiceBackendRecordingRef.current) {
        setVoiceMicMessage(t("billing.page.micStopped"));
        voiceBackendRecordingRef.current.stop();
        return;
      }
      voiceRecognitionRef.current?.stop?.();
      setVoiceListening(false);
      return;
    }

    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition || preferBackendVoiceRef.current) {
      await startBackendVoiceListening();
      return;
    }

    const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      const message = t("billing.page.micNeedsHttps");
      setVoiceMicMessage(message);
      toast({ title: t("billing.page.micBlockedByBrowser"), description: message, variant: "destructive" });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = t("billing.page.micNoPermissionApi");
      setVoiceMicMessage(message);
      toast({ title: t("billing.page.micNotAvailable"), description: message, variant: "destructive" });
      return;
    }

    try {
      setVoiceMicMessage(t("billing.page.micRequestingPermission"));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "PermissionError";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? t("billing.page.micBlockedDetail")
        : name === "NotFoundError"
          ? t("billing.page.micNotFound")
          : t("billing.page.micPermissionFailed", { name });
      setVoiceMicMessage(message);
      toast({ title: t("billing.page.micPermissionNeeded"), description: message, variant: "destructive" });
      return;
    }

    let gotResult = false;
    let heardText = "";
    const existingText = voiceCommand.trim();
    let autoStopTimer: number | undefined;
    const recognition = new Recognition();
    voiceRecognitionRef.current = recognition;
    recognition.lang = speechRecognitionLocale(language);
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceListening(true);
      setVoiceMicMessage(t("billing.page.micLive"));
      autoStopTimer = window.setTimeout(() => recognition.stop?.(), 12000);
    };

    recognition.onresult = (event) => {
      const parts: string[] = [];
      const startIndex = event.resultIndex ?? 0;
      for (let index = startIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index]?.[0]?.transcript?.trim();
        if (transcript) parts.push(transcript);
      }
      const transcript = parts.join(" ").replace(/\s+/g, " ").trim();
      if (!transcript) return;
      gotResult = true;
      heardText = transcript;
      setVoiceCommand(existingText ? `${existingText} ${heardText}` : heardText);
      setVoiceMicMessage(t("billing.page.micCapturedOnce"));
    };

    recognition.onerror = (event) => {
      const error = event?.error ?? "unknown";
      const message = error === "not-allowed" || error === "service-not-allowed"
        ? t("billing.page.micPermissionBlocked")
        : error === "audio-capture"
          ? t("billing.page.micNoDevice")
          : error === "no-speech"
            ? t("billing.page.micNoSpeech")
            : error === "network"
              ? t("billing.page.micServiceUnreachable")
              : t("billing.page.voiceCaptureFailed", { error });
      const useBackendNext = error === "network" || error === "service-not-allowed";
      if (useBackendNext) preferBackendVoiceRef.current = true;
      const actionableMessage = useBackendNext
        ? `${message} Press Start mic again to use Artha cloud transcription.`
        : message;
      setVoiceMicMessage(actionableMessage);
      if (error !== "aborted") {
        toast({ title: t("billing.page.micIssue"), description: actionableMessage, variant: error === "no-speech" ? "default" : "destructive" });
      }
    };

    recognition.onend = () => {
      if (autoStopTimer) window.clearTimeout(autoStopTimer);
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
      if (gotResult) {
        setVoiceMicMessage(t("billing.page.micCaptured"));
      } else {
        setVoiceMicMessage(t("billing.page.micNothingCaptured"));
      }
    };

    try {
      recognition.start();
    } catch (error) {
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
      const message = error instanceof Error ? error.message : t("billing.page.micRefresh");
      setVoiceMicMessage(message);
      toast({ title: t("billing.page.micCouldNotStart"), description: message, variant: "destructive" });
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command) return;
      setVoiceCommand(command);
      setVoiceMicMessage(t("billing.page.voiceAssistantSent"));
      window.setTimeout(() => parseVoiceDraft(command), 50);
    };
    window.addEventListener("kirana:voice-billing-command", handler);
    return () => window.removeEventListener("kirana:voice-billing-command", handler);
  }, [products.data, productSearchIndex]);

  function updateQty(lineKey: string, nextQuantity: number) {
    setCart((previous) => previous
      .map((item) => {
        if (cartItemKey(item) !== lineKey) return item;
        const quantity = Math.max(0, roundQuantity(nextQuantity));
        if (item.manualRate || item.isCustom) return { ...item, quantity };
        const priced = resolveLine(item.product, quantity, item.sellingUnit);
        return { ...item, quantity, rate: priced.rate, pricing: priced.pricing };
      })
      .filter((item) => item.quantity > 0));
  }

  function updateRate(lineKey: string, nextRate: number) {
    setCart((previous) => previous.map((item) => cartItemKey(item) === lineKey ? { ...item, rate: Math.max(0, roundMoney(nextRate)), manualRate: true } : item));
  }

  function updateLineDiscount(lineKey: string, nextDiscount: number) {
    setCart((previous) => previous.map((item) => {
      if (cartItemKey(item) !== lineKey) return item;
      const clamped = Math.min(Math.max(0, roundMoney(nextDiscount)), cartItemGross(item));
      return { ...item, lineDiscount: clamped > 0 ? clamped : undefined };
    }));
  }

  function updateLineNote(lineKey: string, nextNote: string) {
    setCart((previous) => previous.map((item) => {
      if (cartItemKey(item) !== lineKey) return item;
      const trimmed = nextNote.trim().slice(0, 200);
      return { ...item, note: trimmed || undefined };
    }));
  }

  /**
   * Pin this line to a batch, or hand it back to FEFO.
   *
   * The chosen batch is part of the line's identity (cartItemKey), so this
   * rewrites the key. Matching on the OLD key first is therefore required —
   * after the change the line no longer answers to the key that was clicked.
   */
  // Values contributed by the active trade's billing slots, keyed by slot id.
  // A pharmacy puts the authorising prescription here; every other shop keeps an
  // empty object and renders nothing.
  const [billingSlotValues, setBillingSlotValues] = useState<Record<string, unknown>>({});
  // Keyed on the cart rather than recomputed per render: this page re-renders on
  // every keystroke in the search box, and ten of the eleven trades register no
  // slot at all — so all of this walking is thrown away almost every time.
  const { slotProducts, slotProductIds } = useMemo(() => {
    const products = cart.filter((item) => !item.isCustom).map((item) => item.product as unknown as Record<string, unknown>);
    return { slotProducts: products, slotProductIds: products.map((product) => String(product.id)) };
  }, [cart]);
  const activeBillingSlots = useMemo(
    () => billingSlotsFor({ productIds: slotProductIds, products: slotProducts }),
    [slotProductIds, slotProducts],
  );

  function updateLineBatch(lineKey: string, batch?: SellableBatch) {
    setCart((previous) => previous.map((item) => (
      cartItemKey(item) === lineKey ? { ...item, batch } : item
    )));
  }

  function updateUnit(lineKey: string, unitCode: string) {
    setCart((previous) => {
      const current = previous.find((item) => cartItemKey(item) === lineKey);
      if (!current) return previous;
      const sellingUnit = activeSellingUnits(current.product).find((candidate) => candidate.unitCode === unitCode);
      if (!sellingUnit) return previous;
      const priced = resolveLine(current.product, current.quantity, sellingUnit);
      const updated: CartItem = { ...current, unit: sellingUnit.name, sellingUnit, rate: priced.rate, pricing: priced.pricing, manualRate: false };
      const updatedKey = cartItemKey(updated);
      const collision = previous.find((item) => cartItemKey(item) === updatedKey && cartItemKey(item) !== lineKey);
      if (!collision) {
        return previous.map((item) => cartItemKey(item) === lineKey ? updated : item);
      }
      const quantity = roundQuantity(collision.quantity + updated.quantity);
      const mergedPrice = collision.manualRate ? undefined : resolveLine(collision.product, quantity, collision.sellingUnit);
      return previous
        .filter((item) => cartItemKey(item) !== lineKey)
        .map((item) => cartItemKey(item) === updatedKey
          ? { ...item, quantity, rate: collision.manualRate ? collision.rate : mergedPrice?.rate ?? collision.rate, pricing: collision.manualRate ? collision.pricing : mergedPrice?.pricing }
          : item);
    });
  }

  function removeItem(lineKey: string) {
    // Read the line before the update rather than inside the updater: React
    // re-invokes state updaters under StrictMode, and a side effect in there
    // would count the removal twice.
    const removed = cart.find((item) => cartItemKey(item) === lineKey);
    if (removed && !removed.isCustom) {
      trackEvent(ACTIVITY_EVENTS.PRODUCT_REMOVED_FROM_BILL, { productId: removed.product.id, productName: removed.product.name });
    }
    setCart((previous) => previous.filter((item) => cartItemKey(item) !== lineKey));
  }

  async function readCartLineFromScale(lineKey: string, billingUnit: string) {
    const printer = getPrinterConfigSync();
    if (printer.connection !== "bridge") {
      toast({ title: t("billing.page.connectScale"), description: t("billing.page.connectScaleDetail"), variant: "destructive" });
      return;
    }
    if (!isScaleBillingUnit(billingUnit)) {
      toast({ title: t("billing.page.scaleUnitUnsupported"), description: t("billing.page.scaleUnitUnsupportedDetail", { unit: billingUnit }), variant: "destructive" });
      return;
    }
    setScaleReadingLineKey(lineKey);
    try {
      const reading = await readScaleViaHardwareBridge(printer.bridgeUrl);
      const quantity = scaleReadingToBillingQuantity(reading, billingUnit);
      updateQty(lineKey, quantity);
      toast({ title: t("billing.page.scaleApplied"), description: t("billing.page.scaleAppliedDetail", { quantity: quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 }), unit: billingUnit }) });
    } catch (error) {
      toast({ title: t("billing.page.scaleNotApplied"), description: error instanceof Error ? error.message : t("billing.page.scaleCheckBridge"), variant: "destructive" });
    } finally {
      setScaleReadingLineKey(null);
    }
  }

  function validateBeforeConfirm(nextBillType: BillTypeSelection) {
    if (cart.length === 0) {
      toast({ title: t("billing.page.cartEmpty"), description: t("billing.page.cartEmptyDetail"), variant: "destructive" });
      return false;
    }
    if (cart.some((item) => item.quantity <= 0 || item.rate <= 0)) {
      toast({ title: t("billing.page.invalidItem"), description: t("billing.page.invalidItemDetail"), variant: "destructive" });
      return false;
    }
    if (nextBillType === BillInputBillType.gst_invoice && getTaxConfigSync().mode === "none") {
      toast({ title: t("billing.page.gstModeRequired"), description: t("billing.page.gstModeRequiredDetail"), variant: "destructive" });
      return false;
    }
    if (totalDiscount > subtotal) {
      toast({ title: t("billing.page.discountTooHigh"), description: t("billing.page.discountTooHighDetail"), variant: "destructive" });
      return false;
    }
    if (effectiveLoyaltyPoints > 0 && !isOnline) {
      toast({ title: t("billing.page.connectToRedeemPoints"), description: t("billing.page.connectToRedeemPointsDetail"), variant: "destructive" });
      return false;
    }
    if (paymentMode === BillPaymentMode.gift_card) {
      if (!isOnline) {
        toast({ title: t("billing.page.connectToRedeemGift"), description: t("billing.page.connectToRedeemGiftDetail"), variant: "destructive" });
        return false;
      }
      if (!giftCardCode || giftCardBalance === null || effectiveGiftCardAmount <= 0) {
        toast({ title: t("billing.page.verifyGiftCard"), description: t("billing.page.verifyGiftCardDetail"), variant: "destructive" });
        return false;
      }
    }
    if (effectiveLoyaltyPoints > 0 && effectiveLoyaltyPoints < Number(loyaltyProgram.data?.minimumRedeemPoints || 0)) {
      toast({ title: t("billing.page.morePointsRequired"), description: t("billing.page.morePointsRequiredDetail", { points: loyaltyProgram.data?.minimumRedeemPoints ?? 0 }), variant: "destructive" });
      return false;
    }
    const needsCustomer = billNeedsCustomer({
      isUdharEntry: nextBillType === BillInputBillType.udhar_entry,
      creditAmount,
      isCreditMode: paymentMode === BillPaymentMode.credit,
      isSplitMode: paymentMode === SPLIT_PAYMENT,
      splitUdharAmount,
    });
    if (needsCustomer && !hasCreditCustomerIdentity) {
      toast({ title: t("billing.page.udharNeedsCustomer"), description: t("billing.page.udharNeedsCustomerDetail"), variant: "destructive" });
      customerNameInputRef.current?.focus();
      return false;
    }
    if (!allowAdvancePayment && paymentMode !== SPLIT_PAYMENT && typeof paidAmount === "number" && paidAmount > grandTotal) {
      toast({ title: t("billing.page.paidMoreThanBill"), description: t("billing.page.paidMoreThanBillDetail"), variant: "destructive" });
      return false;
    }
    if (paymentMode === SPLIT_PAYMENT && splitCash + splitUpi > grandTotal) {
      toast({ title: t("billing.page.splitTooHigh"), description: t("billing.page.splitTooHighDetail"), variant: "destructive" });
      return false;
    }
    return true;
  }

  function makePrintableBill(nextBillType: BillTypeSelection, paid: number, credit: number, payments?: PrintableBill["payments"]): PrintableBill {
    const year = new Date().getFullYear();
    const customerBalance = Number(resolvedCustomerRecord?.udharAmount ?? resolvedCustomerRecord?.totalUdhar);
    return {
      billNo: nextBillType === BillInputBillType.estimate ? `EST-${year}-LOCAL-${Date.now()}` : `LOCAL-${Date.now()}`,
      createdAt: new Date().toISOString(),
      customerName: resolvedCustomerName || "Walk-in",
      customerMobile: resolvedCustomerMobile || undefined,
      buyerGstin: resolvedBuyerGstin || undefined,
      buyerStateCode: resolvedBuyerStateCode || undefined,
      buyerAddress: resolvedBuyerAddress || undefined,
      items: cart,
      subtotal,
      discount: totalDiscount,
      roundOff: roundOffAmount,
      total: grandTotal,
      paid,
      credit,
      previousUdhar: resolvedCustomerRecord && Number.isFinite(customerBalance) ? customerBalance : undefined,
      paymentMode,
      billType: nextBillType,
      payments,
      shop: {
        name: shop?.name ?? "Artha",
        address: shop?.address ?? null,
        city: shop?.city ?? null,
        phone: shop?.phone ?? user?.mobile ?? null,
        gstNumber: shop?.gstNumber ?? null,
        cashierName: user?.name ?? null,
      },
      copyLabel: nextBillType === BillInputBillType.estimate ? t("billing.page.estimateCopy") : t("billing.page.originalCustomerCopy"),
    };
  }

  function billingSensitiveApprovalCovers(
    actions: BillingSensitiveAction[],
    approval: typeof sensitiveApproval = sensitiveApproval,
  ) {
    if (actions.length === 0) return true;
    const fingerprint = billingSensitiveApprovalFingerprint(cart, safeDiscount, effectiveLoyaltyPoints);
    return Boolean(
      approval?.ownerPin
      && approval.fingerprint === fingerprint
      && actions.every((action) => approval.actions.includes(action)),
    );
  }

  function requiredBillingSensitiveActions(): BillingSensitiveAction[] {
    const actions: BillingSensitiveAction[] = [];
    // The counter prompts early for good UX; the server independently derives
    // the same actions from catalogue and money data and cannot be switched off.
    const isLargeDiscount = billingDiscountApprovalSummary(cart, safeDiscount).requiresApproval;
    if (isLargeDiscount && isActionProtected("largeDiscount")) actions.push("large_discount");
    const hasBelowMinimumRate = cart.some(lineNeedsOwnerApproval);
    if (hasBelowMinimumRate && isActionProtected("sellBelowMin")) actions.push("selling_below_minimum_price");
    if (effectiveLoyaltyPoints > 0) actions.push("loyalty_redemption"); // server-enforced on redeem
    return actions;
  }

  function handleConfirm(
    overrideBillType?: BillTypeSelection,
    printDecision?: boolean,
    approvalOverride?: NonNullable<typeof sensitiveApproval>,
  ) {
    if (!newBillingFeature.allowed) {
      toast({ title: t("billing.page.billingLocked"), description: newBillingFeature.reason, variant: "destructive" });
      return;
    }
    if (!createBillPermission.allowed) {
      toast({ title: t("billing.page.permissionDenied"), description: createBillPermission.reason, variant: "destructive" });
      return;
    }
    if (safeDiscount > 0 && !applyDiscountPermission.allowed) {
      toast({ title: t("billing.page.discountNotAllowed"), description: applyDiscountPermission.reason, variant: "destructive" });
      return;
    }
    if (appliedOffer && Math.abs(appliedOffer.subtotal - subtotal) > 0.005) {
      toast({ title: t("billing.page.reapplyCoupon"), description: t("billing.page.couponStale"), variant: "destructive" });
      return;
    }
    if (appliedOffer && safeDiscount + 0.005 < appliedOffer.discount) {
      toast({ title: t("billing.page.reapplyCoupon"), description: t("billing.page.couponMismatch"), variant: "destructive" });
      return;
    }
    const nextBillType = overrideBillType ?? billType;
    const isUdharEntry = nextBillType === BillInputBillType.udhar_entry;

    if (!validateBeforeConfirm(nextBillType)) return;
    if (upiTenderPaise > 0 && retailPaymentReadiness.data?.confirmationRequired && !retailPaymentVerified) {
      toast({ title: t("billing.page.verifyUpiPayment"), description: t("billing.page.providerRequired"), variant: "destructive" });
      return;
    }

    if (negativeStockWarnings.length > 0) {
      const first = negativeStockWarnings[0];
      toast({
        title: t("billing.page.negativeStockTitle"),
        description: `${first.productName}: ${first.available} ${first.unit} available, ${first.requested} ${first.unit} selling. Stock will become ${first.after} ${first.unit}.`,
      });
    }

    const sensitiveActions = requiredBillingSensitiveActions();
    const effectiveSensitiveApproval = approvalOverride ?? sensitiveApproval;
    if (sensitiveActions.length > 0 && !billingSensitiveApprovalCovers(sensitiveActions, effectiveSensitiveApproval)) {
      setPendingSensitiveBillType(nextBillType);
      setSensitivePinOpen(true);
      return;
    }

    const printerConfig = getPrinterConfigSync();
    if (printerConfig.autoPrint && printerConfig.askBeforePrint && printDecision === undefined) {
      setPendingPrintBillType(nextBillType);
      setPrintConfirmOpen(true);
      return;
    }

    const paid = isUdharEntry ? 0 : effectivePaidAmount;
    const cappedPaidForCredit = Math.min(paid, grandTotal);
    const remainingCredit = isUdharEntry ? grandTotal : roundMoney(Math.max(0, grandTotal - cappedPaidForCredit));

    const payments = paymentMode === SPLIT_PAYMENT
      ? [
          ...(splitCash > 0 ? [{ mode: BillPaymentMode.cash, amount: splitCash }] : []),
          ...(splitUpi > 0 ? [{ mode: BillPaymentMode.upi, amount: splitUpi, ...(retailPaymentVerified ? { retailPaymentIntentId: verifiedRetailPayment?.intentId } : {}) }] : []),
          ...(remainingCredit > 0 ? [{ mode: BillPaymentMode.credit, amount: remainingCredit }] : []),
        ]
      : paymentMode === BillPaymentMode.credit || isUdharEntry
        ? [{ mode: BillPaymentMode.credit, amount: grandTotal }]
        : paymentMode === BillPaymentMode.gift_card
          ? [
              { mode: BillPaymentMode.gift_card, amount: effectiveGiftCardAmount, giftCardCode },
              ...(grandTotal - effectiveGiftCardAmount > 0 ? [{ mode: BillPaymentMode.cash, amount: roundMoney(grandTotal - effectiveGiftCardAmount) }] : []),
            ]
        : [
            ...(paid > 0 ? [{
              mode: paymentMode,
              amount: paid,
              ...(paymentMode === BillPaymentMode.upi && retailPaymentVerified ? { retailPaymentIntentId: verifiedRetailPayment?.intentId } : {}),
              ...(paymentMode === BillPaymentMode.bank && cardPaymentApproved ? { retailPaymentIntentId: approvedCardPayment?.intentId } : {}),
            }] : []),
            ...(remainingCredit > 0 ? [{ mode: BillPaymentMode.credit, amount: remainingCredit }] : []),
          ];

    const printable = makePrintableBill(nextBillType, paid, remainingCredit, payments);
    setLastPrintableBill(printable);
    pendingAutoPrintRef.current = null;

    // §13. Emitted here, at the point of no return, rather than in the mutation's
    // onSuccess: the local-first path completes the sale on the device and syncs
    // later, so waiting for a server ack would lose every offline bill from the
    // activity record — which is exactly the shop that needs suggestions most.
    // The bill itself remains the authoritative record; this is behaviour only.
    trackEvent(
      ACTIVITY_EVENTS.BILL_CREATED,
      {
        billId: activeBillId,
        billType: nextBillType,
        paymentMethod: paymentMode === SPLIT_PAYMENT ? "split" : String(paymentMode),
        itemCount: cart.length,
        productIds: cart.filter((item) => !item.isCustom).map((item) => item.product.id),
        hasCustomer: Boolean(resolvedCustomerId),
        hasDiscount: safeDiscount > 0,
      },
      { durationMs: billingStartedAtRef.current === null ? undefined : Date.now() - billingStartedAtRef.current },
    );
    if (paid > 0) {
      trackEvent(ACTIVITY_EVENTS.PAYMENT_COMPLETED, {
        billId: activeBillId,
        paymentMethod: paymentMode === SPLIT_PAYMENT ? "split" : String(paymentMode),
      });
    }
    billingStartedAtRef.current = null;

    if (getPrinterConfigSync().autoPrint) {
      if (printDecision !== false) {
        const popup = window.open("", "_blank", "width=460,height=760");
        if (popup) {
          pendingAutoPrintRef.current = { popup, printable };
          writeBillingReceiptPendingWindow(popup, printable);
        } else {
          toast({ title: t("billing.page.printBlocked"), description: t("billing.page.popupsBlockedSave"), variant: "destructive" });
        }
      }
    }

    confirmBill.mutate({
      data: {
        // Stable per-open-bill identity. The local-first path already mints its own,
        // but the ONLINE path (coupons/loyalty/gift cards go straight to the server)
        // needs this so a retry after a lost response dedupes server-side instead of
        // creating a second bill and double-redeeming the coupon. A fresh id is set
        // after every successful save, so distinct sales never collide.
        clientBillId: activeBillId,
        billType: nextBillType,
        gstMode: getTaxConfigSync().mode,
        // Ride the round-off setting with the bill so the offline validator and the
        // server round the total the same way this counter just did (and payments reconcile).
        // Coerced hard: these three flags are the only booleans the bill schema (local AND
        // server) accepts, and each is sourced from persisted/synced JSON that a stray
        // number can poison — which blocks the save outright with a Zod type error.
        roundOff: roundOffEnabled === true,
        customerId: resolvedCustomerId || undefined,
        customerName: resolvedCustomerName || "Walk-in",
        customerMobile: resolvedCustomerMobile || undefined,
        buyerGstin: resolvedBuyerGstin || undefined,
        buyerStateCode: resolvedBuyerStateCode || undefined,
        buyerAddress: resolvedBuyerAddress || undefined,
        discount: safeDiscount,
        discountReason: safeDiscount > 0 ? discountReason.trim() || undefined : undefined,
        offerId: appliedOffer?.id,
        offerCode: appliedOffer?.code,
        offerDiscount: appliedOffer?.discount,
        loyaltyPointsToRedeem: effectiveLoyaltyPoints > 0 ? effectiveLoyaltyPoints : undefined,
        actualAmount: grandTotal,
        buyerPaidAmount: paid,
        waivedAmount: 0,
        allowAdvancePayment: allowAdvancePayment === true,
        advanceAmount,
        prescriptionId: (billingSlotValues.prescriptionId as { id?: string } | undefined)?.id,
        items: cart.map((item) => ({
          productId: item.isCustom ? undefined : item.product.id,
          inventoryLotId: item.batch?.id,
          sellingUnitId: item.sellingUnit?.id,
          sellingUnitCode: item.sellingUnit?.unitCode,
          sellingUnitLabel: item.sellingUnit?.name ?? item.unit,
          conversionToBase: item.sellingUnit?.conversionToBase,
          name: item.product.name,
          quantity: item.quantity,
          enteredUnit: item.unit,
          // The one place add-on money enters the money path. Everything
          // downstream — net, GST, totals, the server's recompute and the
          // assurance rules — sees a unit rate and needs no knowledge of add-ons.
          // The dish's own rate is what the MRP ceiling and the pricing engine
          // reasoned about, and it stays that way above this line.
          ratePerRateUnit: roundMoney(item.rate + addonUnitPrice(item.addons)),
          baseRatePerRateUnit: roundMoney(item.rate),
          addons: item.addons?.length ? item.addons : undefined,
          lineDiscount: cartItemLineDiscount(item),
          note: item.note?.trim() || undefined,
          originalUnitPrice: item.pricing?.originalUnitPrice,
          appliedPricingRuleId: item.pricing?.appliedRuleId ?? undefined,
          appliedPricingRuleType: item.pricing?.appliedRuleType,
          pricingExplanation: item.pricing?.explanation,
          pricingConfidence: item.pricing?.confidence,
          pricingCalculationVersion: item.pricing?.calculationVersion,
          wasPriceOverridden: item.manualRate === true,
          gstRate: item.product.gstRate ?? 0,
          hsn: item.product.hsn ?? undefined,
        })),
        payments,
        ownerPin: sensitiveActions.length > 0 ? effectiveSensitiveApproval?.ownerPin : undefined,
        reason: sensitiveActions.length > 0 ? effectiveSensitiveApproval?.reason : undefined,
        sensitiveActions,
      },
    });
  }

  // Snapshot the bill currently in the workspace as an open-bills entry (keyed by activeBillId).
  function serializeActiveBill(): HeldBill {
    return {
      id: activeBillId,
      sourceOrderId,
      sourceOrderFingerprint,
      label: `${resolvedCustomerName || t("billing.page.walkIn")} • ₹${grandTotal.toLocaleString("en-IN")} • ${cart.length === 1 ? t("billing.search.resultCount", { count: cart.length }) : t("billing.search.resultCountPlural", { count: cart.length })}`,
      createdAt: new Date().toISOString(),
      cart,
      discount: safeDiscount,
      discountReason,
      appliedOffer,
      paymentMode,
      billType,
      selectedCustomerId,
      customerName,
      customerMobile,
      paidAmount,
      splitCashAmount,
      splitUpiAmount,
      allowAdvancePayment,
    };
  }

  function loadBillIntoActive(bill: HeldBill) {
    setActiveBillId(bill.id);
    setSourceOrderId(bill.sourceOrderId);
    setSourceOrderFingerprint(bill.sourceOrderFingerprint);
    setCart(bill.cart ?? []);
    setDiscount(bill.discount ?? 0);
    setDiscountReason(bill.discountReason ?? "");
    setAppliedOffer(bill.appliedOffer ?? null);
    setPaymentMode(bill.paymentMode ?? BillPaymentMode.cash);
    setBillType(bill.billType ?? BillInputBillType.normal_sale);
    setSelectedCustomerId(bill.selectedCustomerId ?? "walk_in");
    setCustomerName(bill.customerName ?? "");
    setCustomerMobile(bill.customerMobile ?? "");
    setPaidAmount(bill.paidAmount ?? "");
    setSplitCashAmount(bill.splitCashAmount ?? "");
    setSplitUpiAmount(bill.splitUpiAmount ?? "");
    setAllowAdvancePayment(bill.allowAdvancePayment === true);
    setDraftRestored(Boolean(bill.cart?.length));
  }

  // Save the workspace bill back into the open-bills set — but only if it has items, so empty
  // bills aren't littered around.
  async function newBill(): Promise<boolean> {
    if (openBillTransitionLockRef.current) return false;

    const nextActiveBillId = newBillId();
    const transition = prepareNewBillWorkspace(
      heldBills,
      cart.length > 0 ? serializeActiveBill() : null,
      nextActiveBillId,
    );
    if (!transition.ok) {
      toast({
        title: t("billing.page.openBillLimitReached"),
        description: t("billing.page.openBillLimitReachedDetail"),
        variant: "destructive",
      });
      return false;
    }
    openBillTransitionLockRef.current = true;
    setOpenBillTransitionPending(true);
    try {
      await commitBillingWorkspace(offlineDB, transition.snapshot, (snapshot) => {
        billingDraftCache = snapshot.activeDraft;
        setHeldBills(snapshot.heldBills);
        resetCurrentBill();
        setActiveBillId(nextActiveBillId);
        setMobileCheckoutOpen(false);
      });
      return true;
    } catch {
      toast({
        title: t("billing.page.openBillSaveFailed"),
        description: t("billing.page.openBillSaveFailedDetail"),
        variant: "destructive",
      });
      return false;
    } finally {
      openBillTransitionLockRef.current = false;
      setOpenBillTransitionPending(false);
    }
  }

  // Explicit "Hold" button: save the current bill and clear the workspace.
  async function holdCurrentBill(): Promise<void> {
    if (cart.length === 0) {
      toast({ title: t("billing.page.nothingToHold"), description: t("billing.page.nothingToHoldDetail") });
      return;
    }
    if (await newBill()) {
      toast({ title: t("billing.page.billHeld"), description: t("billing.page.billHeldDetail") });
    }
  }

  // Switch only after the target draft and remaining parked set are durable.
  // Removing the target before parking the current bill avoids cap eviction.
  async function resumeHeldBill(id: string): Promise<void> {
    if (openBillTransitionLockRef.current) return;
    const transition = prepareResumeBillWorkspace(
      heldBills,
      cart.length > 0 ? serializeActiveBill() : null,
      id,
    );
    if (!transition.ok) return;

    openBillTransitionLockRef.current = true;
    setOpenBillTransitionPending(true);
    try {
      await commitBillingWorkspace(offlineDB, transition.snapshot, (snapshot) => {
        billingDraftCache = snapshot.activeDraft;
        setHeldBills(snapshot.heldBills);
        loadBillIntoActive(transition.target);
      });
    } catch {
      toast({
        title: t("billing.page.openBillSwitchFailed"),
        description: t("billing.page.openBillSwitchFailedDetail"),
        variant: "destructive",
      });
    } finally {
      openBillTransitionLockRef.current = false;
      setOpenBillTransitionPending(false);
    }
  }

  function clearCartWithConfirmation() {
    if (cart.length === 0) return;
    setClearConfirmOpen(true);
  }

  function executeClearCart() {
    setClearConfirmOpen(false);
    resetCurrentBill();
    clearBillingDraft();
    toast({ title: t("billing.page.cartCleared"), description: t("billing.page.cartClearedDetail") });
  }

  function printBillSnapshot(snapshot = lastPrintableBill ?? makePrintableBill(billType, effectivePaidAmount, creditAmount)) {
    const popup = window.open("", "_blank", "width=460,height=760");
    if (!popup) {
      toast({ title: t("billing.page.printBlocked"), description: t("billing.page.popupsBlocked"), variant: "destructive" });
      return;
    }
    writeBillingReceiptWindow(popup, snapshot, { autoPrint: true });
  }

  async function shareLastBillOnWhatsapp() {
    const snapshot = lastPrintableBill ?? makePrintableBill(billType, effectivePaidAmount, creditAmount);
    const shareInput: BillShareInput = {
      shopName: snapshot.shop?.name ?? t("billing.page.defaultShopName"),
      shopLocation: [snapshot.shop?.city, snapshot.shop?.address].filter(Boolean)[0] as string | undefined,
      billNo: snapshot.billNo,
      dateIso: snapshot.createdAt,
      items: snapshot.items.map((it) => ({
        name: it.product?.name ?? "Item",
        quantity: it.quantity,
        rate: it.rate,
        lineTotal: roundMoney(it.quantity * it.rate),
      })),
      total: snapshot.total,
      paid: snapshot.paid,
      credit: snapshot.credit,
      paymentMode: derivePaymentModeLabel(snapshot.payments, snapshot.credit, snapshot.total),
      customerName: snapshot.customerName,
      customerMobile: snapshot.customerMobile,
      previousUdhar: snapshot.previousUdhar,
      showPreviousUdhar: getPrinterConfigSync().showPreviousUdhar,
      showGst: getPrinterConfigSync().showGstBreakup,
    };
    if (snapshot.billId) {
      const printer = getPrinterConfigSync();
      const result = await deliverBillWhatsapp({ billId: snapshot.billId, idempotencyKey: crypto.randomUUID(), input: shareInput, showGst: printer.showGstBreakup, showPreviousUdhar: printer.showPreviousUdhar });
      toast({ title: result.queued ? "WhatsApp queued" : result.state === "sent_via_api" ? "WhatsApp sent" : "Opened in WhatsApp", description: result.queued ? "It will be delivered once this device reconnects." : undefined });
      return;
    }
    const { targetedCustomer } = shareBillOnWhatsapp(shareInput);
    toast({
      title: t("billing.page.openingWhatsapp"),
      description: targetedCustomer ? "Ready to send to the customer's number." : t("billing.page.pickAChat"),
    });
  }

  const startSummaryResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    summaryResizeRef.current = { startX: event.clientX, startWidth: summaryWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!summaryResizeRef.current) return;
      const delta = summaryResizeRef.current.startX - event.clientX;
      const nextWidth = clampBillSummaryWidth(summaryResizeRef.current.startWidth + delta);
      setSummaryWidth(nextWidth);
    };
    const onMouseUp = () => {
      if (!summaryResizeRef.current) return;
      summaryResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(BILL_SUMMARY_WIDTH_KEY, String(summaryWidth));
  }, [summaryWidth]);

  function requestSummaryAction(action: "discount" | "coupon" | "customer") {
    window.dispatchEvent(new CustomEvent("kirana:billing-summary-action", { detail: { action } }));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // Settings → Advanced → Keyboard shortcuts. Escape-to-clear stays on
      // because it is a browser convention, not an app hotkey.
      if (!keyboardShortcutsEnabled() && event.key !== "Escape") return;
      if (event.key === "Escape" && search) {
        event.preventDefault();
        setSearch("");
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        requestSummaryAction("discount");
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        requestSummaryAction("customer");
        return;
      }
      if (event.key === "F9" && cart.length > 0) {
        event.preventDefault();
        void holdCurrentBill();
        return;
      }
      if ((event.key === "F12" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")) && cart.length > 0) {
        event.preventDefault();
        void handleConfirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="min-h-[calc(100dvh-var(--app-mobile-topbar-height)-var(--app-mobile-nav-height))] bg-white lg:h-[calc(100dvh-var(--app-desktop-topbar-height)-var(--app-banner-height))] lg:min-h-0 lg:overflow-hidden">
      <div className="flex min-h-full flex-col gap-3 px-2.5 py-2.5 pb-[calc(var(--app-mobile-fixed-action-height)+2rem)] sm:px-3 sm:py-3 sm:pb-[calc(var(--app-mobile-fixed-action-height)+2rem)] lg:h-full lg:flex-row lg:gap-4 lg:px-4 lg:pb-3">
      {/* ── LEFT PANEL: product search + grid ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-visible lg:min-h-0 lg:overflow-hidden">
        {(heldBills.length > 0 || cart.length > 0) && (
          <OpenBillsBar
            bills={[
              { id: activeBillId, name: resolvedCustomerName || t("billing.page.walkIn"), itemCount: cart.length, active: true },
              ...heldBills.map((entry): OpenBillChip => ({ id: entry.id, name: entry.customerName?.trim() || t("billing.page.walkIn"), itemCount: entry.cart?.length ?? 0, active: false, stale: isHeldBillStale(entry), ageLabel: formatHeldBillAge(entry) })),
            ]}
            onSwitch={resumeHeldBill}
            onNew={newBill}
            busy={openBillTransitionPending}
          />
        )}
        <BillingSearch
          railAction={<BillingOrderQrButton />}
          isOnline={isOnline}
          draftRestored={draftRestored}
          cartLength={cart.length}
          onHideDraftRestored={() => setDraftRestored(false)}
          search={search}
          onSearchChange={setSearch}
          searchInputRef={searchInputRef}
          productsLoading={products.isLoading || products.isFetching}
          filteredProducts={filteredProducts}
          allProducts={allProducts}
          onAddProduct={addToCart}
          onBindBarcode={bindScannedBarcode}
          onCreateProductWithBarcode={createProductForScannedBarcode}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectedCategoryChange={chooseCategory}
          voiceVisible={voiceVisible}
          onToggleVoice={() => setVoiceVisible((v) => !v)}
          recentProducts={recentProducts}
          suggestedProducts={nextSuggestion.products}
          suggestionReason={nextSuggestion.reason}
          searchSuggestions={searchSuggestions}
          trendingProductIds={trendingIds}
          onHoldBill={holdCurrentBill}
          cartItemCount={cart.length}
          cartSubtotal={subtotal}
          cartTax={totalGst}
          cartDiscount={safeDiscount}
          cartGrandTotal={grandTotal}
          onApplyDiscount={() => requestSummaryAction("discount")}
          onApplyCoupon={() => requestSummaryAction("coupon")}
          onChooseCustomer={() => requestSummaryAction("customer")}
        />
        {voiceVisible && (
          <div className="shrink-0 border-t">
            <BillingVoicePanel
              voiceCommand={voiceCommand}
              onVoiceCommandChange={setVoiceCommand}
              voiceListening={voiceListening}
              voiceMicMessage={voiceMicMessage}
              voiceDraft={voiceDraft}
              onStartVoiceListening={() => void startVoiceListening()}
              onParseVoiceDraft={() => parseVoiceDraft()}
              onAddVoiceDraftToCart={addVoiceDraftToCart}
            />
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: cart + customer + payment ── */}
      <div
        className={mobileCheckoutOpen
          ? "fixed inset-0 z-[70] flex min-h-0 flex-col bg-[#f7f9fd] lg:static lg:z-auto lg:flex lg:bg-transparent"
          : "hidden lg:static lg:flex lg:min-h-0"}
        role={mobileCheckoutOpen ? "dialog" : undefined}
        aria-modal={mobileCheckoutOpen ? "true" : undefined}
        aria-label={mobileCheckoutOpen ? t("billing.page.reviewCollectPayment") : undefined}
      >
        <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-[#e1e8f2] bg-white px-4 lg:hidden">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#64748b]">{t("billing.page.checkout")}</p>
            <h2 className="font-display text-[19px] font-black text-[var(--brand-ink)]">{t("billing.page.reviewCollect", { amount: grandTotal.toLocaleString("en-IN") })}</h2>
          </div>
          <button
            type="button"
            onClick={() => setMobileCheckoutOpen(false)}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#dce5f1] px-4 text-[13px] font-black text-[#42526e]"
            aria-label={t("billing.page.closeCheckout")}
          >
            Back
          </button>
        </div>
        <div className="flex min-h-0 flex-1 overflow-y-auto p-2 pb-[var(--app-mobile-checkout-panel-clearance)] overscroll-contain lg:overflow-visible lg:p-0">
      <BillingSummary
        tradeSlots={activeBillingSlots.length > 0 ? (
          <div data-testid="billing-trade-slots">
            {activeBillingSlots.map(({ id, Component }) => (
              <Component
                key={id}
                productIds={slotProductIds}
                value={billingSlotValues[id]}
                onChange={(value) => setBillingSlotValues((previous) => ({ ...previous, [id]: value }))}
              />
            ))}
          </div>
        ) : null}
        summaryWidth={summaryWidth}
        onStartSummaryResize={startSummaryResize}
        isOnline={isOnline}
        billType={billType}
        setBillType={setBillType}
        customers={customers.data ?? []}
        selectedCustomerId={selectedCustomerId}
        setSelectedCustomerId={setSelectedCustomerId}
        customerName={customerName}
        setCustomerName={setCustomerName}
        customerMobile={customerMobile}
        setCustomerMobile={setCustomerMobile}
        customerNameInputRef={customerNameInputRef}
        matchingMobileCustomer={matchingMobileCustomer}
        creditAmount={creditAmount}
        hasCreditCustomerIdentity={hasCreditCustomerIdentity}
        cart={cart}
        subtotal={subtotal}
        lineDiscountTotal={lineDiscountTotal}
        safeDiscount={safeDiscount}
        setDiscount={setDiscount}
        discountReason={discountReason}
        setDiscountReason={setDiscountReason}
        onCouponApplied={(offerId, discount, code) => { setAppliedOffer(offerId ? { id: offerId, discount, code, subtotal } : null); }}
        loyaltyOnline={isOnline}
        loyaltyCustomerSelected={Boolean(resolvedCustomerId)}
        loyaltyLoading={loyaltyProgram.isLoading || loyaltyAccount.isLoading}
        loyaltyActive={loyaltyProgram.data?.active === true && billType !== BillInputBillType.estimate}
        loyaltyTier={loyaltyAccount.data?.account.tier}
        loyaltyBalance={loyaltyBalance}
        loyaltyMinimumPoints={Number(loyaltyProgram.data?.minimumRedeemPoints || 0)}
        loyaltyMaxPoints={loyaltyMaxPoints}
        loyaltyPoints={effectiveLoyaltyPoints}
        setLoyaltyPoints={setLoyaltyPointsToRedeem}
        loyaltyDiscount={loyaltyDiscount}
        gstAmount={gstBreakdown.gst}
        gstMode={gstBreakdown.mode}
        gstCgst={gstBreakdown.cgst}
        gstSgst={gstBreakdown.sgst}
        gstIgst={gstBreakdown.igst}
        gstSupplyType={gstBreakdown.supplyType}
        grandTotal={grandTotal}
        roundOff={roundOffAmount}
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
        splitCash={splitCash}
        splitUpi={splitUpi}
        splitUdharAmount={splitUdharAmount}
        effectivePaidAmount={effectivePaidAmount}
        advanceAmount={advanceAmount}
        retailPaymentConfigured={retailPaymentReadiness.data?.configured ?? false}
        retailPaymentDynamicQr={retailPaymentReadiness.data?.dynamicQrEnabled ?? false}
        cardTerminalConfigured={cardTerminalReadiness.data?.configured ?? false}
        cardTerminalApproved={cardPaymentApproved}
        cardTerminalLoading={cardTerminalLoading}
        onChargeCardTerminal={handleChargeCardTerminal}
        retailPaymentRequired={retailPaymentReadiness.data?.confirmationRequired ?? false}
        retailPaymentVerified={retailPaymentVerified}
        retailPaymentLoading={retailPaymentLoading}
        onVerifyRetailPayment={() => void handleVerifyRetailPayment()}
        giftCardCode={giftCardCode}
        setGiftCardCode={setGiftCardCode}
        giftCardBalance={giftCardBalance}
        giftCardAmount={effectiveGiftCardAmount}
        setGiftCardAmount={setGiftCardAmount}
        giftCardLoading={giftCardLoading}
        giftCardError={giftCardError}
        onLookupGiftCard={() => void handleLookupGiftCard()}
        lastBillNo={lastBillNo}
        newBillingAllowed={newBillingFeature.allowed}
        newBillingReason={newBillingFeature.reason}
        createBillAllowed={createBillPermission.allowed}
        confirmBillPending={confirmBill.isPending}
        holdBillPending={openBillTransitionPending}
        hasLastPrintableBill={Boolean(lastPrintableBill)}
        onConfirmBill={() => handleConfirm()}
        onNewBill={newBill}
        onSaveEstimate={() => handleConfirm(BillInputBillType.estimate)}
        onHoldBill={holdCurrentBill}
        onPrintBill={() => printBillSnapshot()}
        onSharePdf={() => { void shareLastBillOnWhatsapp(); }}
        onClearCart={clearCartWithConfirmation}
        onUpdateQty={updateQty}
        onUpdateRate={updateRate}
        onUpdateUnit={updateUnit}
        onUpdateLineDiscount={updateLineDiscount}
        onUpdateLineNote={updateLineNote}
        onUpdateLineBatch={updateLineBatch}
        onReadScale={(lineKey, billingUnit) => void readCartLineFromScale(lineKey, billingUnit)}
        scaleReadingLineKey={scaleReadingLineKey}
        onRemoveItem={removeItem}
        negativeStockWarnings={negativeStockWarnings}
      />
        </div>
      </div>
      </div>

      {/* Sticky mobile checkout bar — keeps the running total and the single next
          action reachable one-thumb without competing with the product browser.
          without scrolling to the bottom of the summary. Desktop shows the full
          summary panel always, so this is mobile-only. Sits above the bottom nav. */}
      {cart.length > 0 && !mobileCheckoutOpen && (
        <div
          className="fixed inset-x-0 z-40 border-t border-[#e6ecf4] bg-white px-3 py-2.5 shadow-[0_-6px_22px_rgba(15,35,80,0.10)] lg:hidden"
          style={{ bottom: "var(--app-mobile-bottom-nav-clearance)" }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-[#64748b]">
                {cart.length} item{cart.length === 1 ? "" : "s"}
                {creditAmount > 0 ? " · udhar" : ""}
              </div>
              <div className="font-display text-[20px] font-black leading-tight text-[var(--brand-ink)]">
                ₹{grandTotal.toLocaleString("en-IN")}
              </div>
            </div>
            <button
              type="button"
              data-testid="mobile-save-bill"
              onClick={() => setMobileCheckoutOpen(true)}
              disabled={confirmBill.isPending || !newBillingFeature.allowed}
              className="inline-flex h-12 min-w-[150px] items-center justify-center rounded-xl bg-[var(--brand)] px-5 text-[15px] font-black text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              {confirmBill.isPending
                ? t("billing.summary.saving")
                : billType === BillInputBillType.estimate
                  ? t("billing.page.reviewEstimate", { amount: grandTotal.toLocaleString("en-IN") })
                  : t("billing.page.reviewCollect", { amount: grandTotal.toLocaleString("en-IN") })}
            </button>
          </div>
        </div>
      )}

      {pendingProductConfiguration ? (() => {
        const Configurator = pendingProductConfiguration.configurator.Component;
        return (
          <Configurator
            product={pendingProductConfiguration.product}
            data={pendingProductConfiguration.data}
            onCancel={() => setPendingProductConfiguration(null)}
            onConfirm={(result) => {
              commitAddToCart(pendingProductConfiguration.product, { addons: result.addons });
              setPendingProductConfiguration(null);
            }}
          />
        );
      })() : null}

      <OwnerPinModal
        open={sensitivePinOpen}
        onCancel={() => setSensitivePinOpen(false)}
        title={t("billing.page.ownerApprovalRequired")}
        description={t("billing.page.ownerApprovalDetail", { amount: LARGE_DISCOUNT_MIN_AMOUNT, percent: LARGE_DISCOUNT_MIN_PERCENT })}
        confirmLabel={t("billing.page.approveBill")}
        reasonRequired
        onConfirm={async ({ ownerPin, reason }) => {
          const actions = requiredBillingSensitiveActions();
          const approval = {
            ownerPin,
            reason,
            actions,
            fingerprint: billingSensitiveApprovalFingerprint(cart, safeDiscount, effectiveLoyaltyPoints),
          };
          setSensitiveApproval(approval);
          setSensitivePinOpen(false);
          const nextType = pendingSensitiveBillType ?? undefined;
          setPendingSensitiveBillType(null);
          // React callbacks retain the state from the render that created them.
          // Pass the freshly-entered approval explicitly so this same attempt
          // cannot enqueue the previous (possibly rejected) PIN.
          window.setTimeout(() => handleConfirm(nextType, undefined, approval), 0);
        }}
      />

      <OwnerPinModal
        open={pendingNewProducts !== null}
        onCancel={() => setPendingNewProducts(null)}
        title={t("billing.page.newProductApproval")}
        description={t("billing.page.newProductApprovalDetail", { count: pendingNewProducts?.length ?? 0 })}
        confirmLabel={t("billing.page.newProductApprove")}
        onConfirm={async ({ ownerPin, reason }) => {
          const rows = pendingNewProducts ?? [];
          setPendingNewProducts(null);
          const madeCount = await createVoiceProducts(rows, ownerPin, reason || t("billing.page.newProductReason"));
          if (madeCount === 0) return;
          // The matched lines still have to reach the cart; re-running the normal path
          // now that the draft has nothing left to create.
          setVoiceDraft((previous) => (previous ? { ...previous, newProducts: [] } : previous));
          window.setTimeout(() => addVoiceDraftToCart(), 0);
        }}
      />

      <RetailDynamicQrDialog
        checkout={retailQrCheckout}
        onClose={() => setRetailQrCheckout(null)}
        onStatusChange={(status) => setRetailQrCheckout((current) => (current && current.status !== status ? { ...current, status } : current))}
        onConfirmed={(checkout) => {
          setVerifiedRetailPayment({ intentId: checkout.intentId, amountPaise: checkout.amountPaise, locationId: checkout.location.id });
          setCustomerDisplayFlash({ state: "paid", totalPaise: checkout.amountPaise });
          setRetailQrCheckout(null);
          toast({ title: t("billing.page.upiVerified"), description: t("billing.page.upiVerifiedDetail") });
        }}
      />

      <CardTerminalDialog
        charge={cardTerminalCharge}
        simulated={cardTerminalReadiness.data?.simulated ?? false}
        onClose={(status: CardTerminalStatus) => {
          if (status !== "uncertain") cardTerminalAttemptRef.current = null;
          setCardTerminalCharge(null);
        }}
        onApproved={(charge) => {
          cardTerminalAttemptRef.current = null;
          setApprovedCardPayment({ intentId: charge.intentId, amountPaise: charge.amountPaise, locationId: charge.location.id });
          setCustomerDisplayFlash({ state: "paid", totalPaise: charge.amountPaise });
          setCardTerminalCharge(null);
          toast({ title: t("billing.pay.cardTerminal.approvedShort"), description: t("billing.pay.cardTerminal.approved") });
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title={t("billing.page.clearBillTitle")}
        description={t("billing.page.clearBillBody")}
        confirmLabel={t("billing.page.clearBillConfirm")}
        destructive
        onConfirm={executeClearCart}
        onCancel={() => setClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={printConfirmOpen}
        title={t("billing.page.printAfterSavingTitle")}
        description={t("billing.page.printAfterSavingBody")}
        confirmLabel={t("billing.page.savePrint")}
        cancelLabel={t("billing.page.saveNoPrint")}
        disabled={confirmBill.isPending}
        onConfirm={() => {
          const nextType = pendingPrintBillType ?? undefined;
          setPrintConfirmOpen(false);
          setPendingPrintBillType(null);
          window.setTimeout(() => handleConfirm(nextType, true), 0);
        }}
        onCancel={() => {
          const nextType = pendingPrintBillType ?? undefined;
          setPrintConfirmOpen(false);
          setPendingPrintBillType(null);
          window.setTimeout(() => handleConfirm(nextType, false), 0);
        }}
      />
    </div>
  );
}
