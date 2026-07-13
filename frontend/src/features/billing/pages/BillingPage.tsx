import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BillInputBillType, BillPaymentMode, getListBillsQueryKey, useConfirmBill, useListCustomers, useListProducts, type Bill, type Customer, type Product, type ProductSellingUnit } from "@/lib/api/client";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useAuth } from "@/features/auth/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { useFeature } from "@/features/subscription";
import { usePermission } from "@/features/staff/permissions";
import { useDebounce } from "@/hooks/use-debounce";
import { offlineDB } from "@/lib/offline/db";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BillingSearch } from "./components/BillingSearch";
import { BillingSummary } from "./components/BillingSummary";
import { OpenBillsBar, type OpenBillChip } from "./components/OpenBillsBar";
import { BillingOrderQrButton } from "@/features/customer-order/BillingOrderQrButton";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, newBillId, upsertOpenBill } from "./open-bills";
import { updateCustomerOrder } from "@/features/orders/api";
import { BillingVoicePanel } from "./components/BillingVoicePanel";
import { billNeedsCustomer, clampAmount, lineNeedsOwnerApproval, normalizeSearchText, productSearchText, productSellingPrice, roundMoney } from "./billing-calculations";
import { resolveLinePrice } from "@/features/pricing/resolve-line-price";
import { useShopPricingRules } from "@/features/pricing/pricing-rules-cache";
import { writeBillingReceiptErrorWindow, writeBillingReceiptPendingWindow, writeBillingReceiptWindow } from "./billing-print";
import { shareBillOnWhatsapp, derivePaymentModeLabel, type BillShareInput } from "@/features/bills/share";
import { getPrinterConfigSync, loadPrinterConfig } from "@/features/settings/printer-config";
import { getTaxConfigSync, loadTaxConfig } from "@/features/settings/tax-config";
import { computeGstBreakdown } from "@/lib/gst";
import { redeemOffer } from "@/features/offers/api";
import { toInventoryBaseQty } from "@/features/inventory/calculations";
import { parseBillingVoiceCommand } from "./billing-voice-parser";
import { SPLIT_PAYMENT, cartItemKey, type BillingDraft, type BillingSensitiveAction, type BillTypeSelection, type CartItem, type HeldBill, type LinePricingMeta, type PaymentSelection, type PrintableBill, type SpeechRecognitionConstructor, type SpeechRecognitionLike, type VoiceParsedDraft } from "./billing-types";

const RECENT_PRODUCTS_KEY = "kirana-os:billing-recent-products:v1";
const FAVORITE_PRODUCTS_KEY = "kirana-os:billing-favorite-products:v1";
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

function isStockTracked(product: Product) {
  return (product.stockTrackingEnabled ?? product.trackStock ?? true) !== false;
}

function cartItemBaseQuantity(item: CartItem) {
  if (item.sellingUnit && item.sellingUnit.conversionToBase > 0) {
    return roundMoney(item.quantity * item.sellingUnit.conversionToBase);
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { shop, user } = useAuth();
  const [location] = useLocation();
  const { isOnline } = useOfflineStatus();
  const newBillingFeature = useFeature("new_billing");
  const createBillPermission = usePermission("create_bill");
  const applyDiscountPermission = usePermission("apply_discount");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const customerNameInputRef = useRef<HTMLInputElement | null>(null);
  const summaryResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pendingAutoPrintRef = useRef<{ popup: Window; printable: PrintableBill } | null>(null);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [cart, setCart] = useState<CartItem[]>(() => readBillingDraft().cart ?? []);
  const [discount, setDiscount] = useState(() => readBillingDraft().discount ?? 0);
  const [paymentMode, setPaymentMode] = useState<PaymentSelection>(() => readBillingDraft().paymentMode ?? BillPaymentMode.cash);
  const [billType, setBillType] = useState<BillTypeSelection>(() => readBillingDraft().billType ?? BillInputBillType.normal_sale);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => readBillingDraft().selectedCustomerId ?? "walk_in");
  const [customerName, setCustomerName] = useState(() => readBillingDraft().customerName ?? "");
  const [customerMobile, setCustomerMobile] = useState(() => readBillingDraft().customerMobile ?? "");
  const [paidAmount, setPaidAmount] = useState<number | "">(() => readBillingDraft().paidAmount ?? "");
  const [splitCashAmount, setSplitCashAmount] = useState<number | "">(() => readBillingDraft().splitCashAmount ?? "");
  const [splitUpiAmount, setSplitUpiAmount] = useState<number | "">(() => readBillingDraft().splitUpiAmount ?? "");
  const [allowAdvancePayment, setAllowAdvancePayment] = useState(() => readBillingDraft().allowAdvancePayment ?? false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [activeBillId, setActiveBillId] = useState<string>(() => readBillingDraft().activeBillId ?? newBillId());
  // If the workspace bill came from a customer QR order, its id — so finalizing marks that order
  // fulfilled + links the bill. Mirrored into a ref so the save-success callback reads it live.
  const [sourceOrderId, setSourceOrderId] = useState<string | undefined>(() => readBillingDraft().sourceOrderId);
  const sourceOrderIdRef = useRef<string | undefined>(sourceOrderId);
  useEffect(() => { sourceOrderIdRef.current = sourceOrderId; }, [sourceOrderId]);
  const [lastBillNo, setLastBillNo] = useState<string | null>(null);
  const [lastPrintableBill, setLastPrintableBill] = useState<PrintableBill | null>(null);
  const [summaryWidth, setSummaryWidth] = useState(() => readBillSummaryWidth());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [sensitivePinOpen, setSensitivePinOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);
  const [pendingPrintBillType, setPendingPrintBillType] = useState<BillTypeSelection | null>(null);
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);
  const [sensitiveApproval, setSensitiveApproval] = useState<{ ownerPin: string; reason: string; actions: BillingSensitiveAction[] } | null>(null);
  const [pendingSensitiveBillType, setPendingSensitiveBillType] = useState<BillTypeSelection | null>(null);
  const [voiceCommand, setVoiceCommand] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<VoiceParsedDraft | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMicMessage, setVoiceMicMessage] = useState("Click mic and speak slowly. You can also type the same command.");
  const [voiceVisible, setVoiceVisible] = useState(false);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

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
  const shouldSearchProducts = deferredSearch.length >= 1;

  const products = useListProducts({ limit: 350 }, {
    query: { staleTime: 2 * 60_000, placeholderData: (previousData: Product[] | undefined) => previousData ?? [] },
  });
  const customers = useListCustomers();
  // Smart Adaptive Pricing — the shop's owner-defined rules (cached, offline-safe).
  const { rules: shopPricingRules } = useShopPricingRules();

  const subtotal = useMemo(() => roundMoney(cart.reduce((sum, item) => sum + item.quantity * item.rate, 0)), [cart]);
  // GST: one engine for UI, local record and server. Inclusive (kirana MRP
  // default) extracts tax from the entered prices without changing the payable;
  // exclusive adds it on top — and then the discount cap must include it.
  const gstBreakdown = useMemo(
    () => computeGstBreakdown(cart.map((item) => ({ price: item.rate, quantity: item.quantity, gstRate: item.product.gstRate ?? 0 })), getTaxConfigSync().mode),
    [cart],
  );
  const payableBase = roundMoney(subtotal + gstBreakdown.gstToAdd);
  const safeDiscount = Math.min(Math.max(Number(discount) || 0, 0), payableBase);
  const grandTotal = roundMoney(Math.max(0, payableBase - safeDiscount));
  const totalGst = gstBreakdown.gst;
  const typedCustomerName = customerName.trim();
  const typedCustomerMobile = customerMobile.replace(/\D/g, "").trim();
  const selectedCustomerBackendId = selectedCustomerId === "walk_in" ? "" : selectedCustomerId;
  const selectedCustomer = selectedCustomerBackendId ? customers.data?.find((customer: Customer) => customer.id === selectedCustomerBackendId) : undefined;
  const matchingMobileCustomer = typedCustomerMobile ? customers.data?.find((customer: Customer) => customer.mobile?.replace(/\D/g, "") === typedCustomerMobile) : undefined;
  const resolvedCustomerId = selectedCustomerBackendId || matchingMobileCustomer?.id || "";
  const resolvedCustomerName = selectedCustomer?.name || matchingMobileCustomer?.name || typedCustomerName;
  const resolvedCustomerMobile = selectedCustomer?.mobile || matchingMobileCustomer?.mobile || typedCustomerMobile;
  const hasCreditCustomerIdentity = Boolean(resolvedCustomerId || (typedCustomerName && typedCustomerMobile));
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
      : plainPaidAmount;
  const advanceAmount = allowAdvancePayment && paymentMode !== SPLIT_PAYMENT ? roundMoney(Math.max(0, effectivePaidAmount - grandTotal)) : 0;
  const creditAmount = billType === BillInputBillType.udhar_entry ? grandTotal : roundMoney(Math.max(0, grandTotal - Math.min(effectivePaidAmount, grandTotal)));

  // Demo "sample" products (id starts with "demo_") are example data for the dashboard tour
  // only — they don't exist on the server, so a real bill that referenced them would land in
  // permanent sync CONFLICT ("Product not found: demo_product_…"). Keep them out of billing.
  const allProducts = useMemo(() => (products.data ?? []).filter((product) => product.deletedAt == null && (product as { deleted_at?: unknown }).deleted_at == null && !String(product.id ?? "").startsWith("demo_")), [products.data]);

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


  const recentProducts = useMemo(
    () =>
      recentProductIds
        .slice(0, 8)
        .map((id) => productById.get(id))
        .filter((p): p is Product => p != null),
    [recentProductIds, productById],
  );

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
          setCart(draft.cart ?? []);
          setDiscount(draft.discount ?? 0);
          setPaymentMode(draft.paymentMode ?? BillPaymentMode.cash);
          setBillType(draft.billType ?? BillInputBillType.normal_sale);
          setSelectedCustomerId(draft.selectedCustomerId ?? "walk_in");
          setCustomerName(draft.customerName ?? "");
          setCustomerMobile(draft.customerMobile ?? "");
          setPaidAmount(draft.paidAmount ?? "");
          setSplitCashAmount(draft.splitCashAmount ?? "");
          setSplitUpiAmount(draft.splitUpiAmount ?? "");
          setAllowAdvancePayment(draft.allowAdvancePayment ?? false);
          setDraftRestored(Boolean(draft.cart?.length));
        }
        setHeldBills(held.slice(0, 10));
      })
      .finally(() => {
        if (active) setDraftHydrated(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    writeBillingDraft({ activeBillId, sourceOrderId, cart, discount: safeDiscount, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment });
  }, [draftHydrated, activeBillId, sourceOrderId, cart, safeDiscount, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment]);

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
    void loadPrinterConfig();
    void loadTaxConfig();
  }, []);

  useEffect(() => {
    setSensitiveApproval(null);
  }, [safeDiscount, subtotal, cart]);

  useEffect(() => {
    if (!allowAdvancePayment && typeof paidAmount === "number" && paidAmount > grandTotal) setPaidAmount(grandTotal);
    setSplitCashAmount((current) => typeof current === "number" ? clampAmount(current, 0, grandTotal) : current);
    setSplitUpiAmount((current) => {
      const cash = typeof splitCashAmount === "number" ? clampAmount(splitCashAmount, 0, grandTotal) : 0;
      return typeof current === "number" ? clampAmount(current, 0, Math.max(0, grandTotal - cash)) : current;
    });
  }, [allowAdvancePayment, grandTotal, paidAmount, splitCashAmount]);

  const appliedOfferRef = useRef<{ id: string; discount: number } | null>(null);

  const confirmBill = useConfirmBill({
    mutation: {
      onSuccess: (data: Bill) => {
        const billNo = data.billNumber ?? data.billNo ?? `PENDING-${Date.now()}`;
        // Count the coupon redemption (usage + discount impact) — fire-and-forget;
        // offline redemptions are skipped rather than queued.
        if (appliedOfferRef.current) {
          void redeemOffer(appliedOfferRef.current.id, appliedOfferRef.current.discount).catch(() => undefined);
          appliedOfferRef.current = null;
        }
        const pendingPrint = pendingAutoPrintRef.current;
        const printableForSavedBill = pendingPrint
          ? { ...pendingPrint.printable, billNo, createdAt: data.createdAt ?? pendingPrint.printable.createdAt }
          : null;
        setLastBillNo(billNo);
        setLastPrintableBill((previous) => printableForSavedBill ?? (previous ? { ...previous, billNo, createdAt: data.createdAt ?? previous.createdAt } : null));
        if (pendingPrint && printableForSavedBill) {
          try {
            writeBillingReceiptWindow(pendingPrint.popup, printableForSavedBill, { autoPrint: true });
          } catch {
            toast({ title: "Print window closed", description: "Bill was saved. Use Print to print the last bill.", variant: "destructive" });
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
        toast({ title: `Bill ${billNo} saved`, description: isOnline ? "Bill saved. Cloud backup will run automatically." : "Data safe locally. Cloud backup pending." });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? "Could not save bill locally";
        if (pendingAutoPrintRef.current) {
          try {
            writeBillingReceiptErrorWindow(pendingAutoPrintRef.current.popup, msg);
          } catch {
            // The toast below is still the source of truth if the print window is gone.
          } finally {
            pendingAutoPrintRef.current = null;
          }
        }
        toast({ title: "Billing error", description: msg, variant: "destructive" });
      },
    },
  });

  function resetCurrentBill() {
    setSourceOrderId(undefined);
    setCart([]);
    setDiscount(0);
    setPaidAmount("");
    setSplitCashAmount("");
    setSplitUpiAmount("");
    setCustomerName("");
    setCustomerMobile("");
    setSelectedCustomerId("walk_in");
    setBillType(requestedBillType ?? BillInputBillType.normal_sale);
    setPaymentMode(BillPaymentMode.cash);
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
      maximumRetailPrice: selectedUnit?.maximumPrice ?? undefined,
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

  function addToCart(product: Product, options?: { custom?: boolean }) {
    setCart((previous) => {
      const sellingUnit = defaultSellingUnit(product);
      const candidate: CartItem = {
        product,
        quantity: 1,
        rate: product.defaultPricePerRateUnit,
        unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece",
        sellingUnit,
        isCustom: options?.custom,
      };
      const candidateKey = cartItemKey(candidate);
      const existing = previous.find((item) => cartItemKey(item) === candidateKey);
      if (existing && !options?.custom) {
        const quantity = roundMoney(existing.quantity + 1);
        const priced = resolveLine(product, quantity, existing.sellingUnit);
        return previous.map((item) => cartItemKey(item) === candidateKey ? { ...item, quantity, rate: item.manualRate ? item.rate : priced.rate, pricing: item.manualRate ? item.pricing : priced.pricing } : item);
      }
      const quantity = 1;
      const priced = resolveLine(product, quantity, sellingUnit);
      return [...previous, { product, quantity, rate: options?.custom ? product.defaultPricePerRateUnit : priced.rate, unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece", sellingUnit, isCustom: options?.custom, manualRate: options?.custom, pricing: options?.custom ? undefined : priced.pricing }];
    });
    rememberRecentProduct(product.id);
    setSearch("");
  }

  function parseVoiceDraft(commandOverride?: string) {
    const command = (commandOverride ?? voiceCommand).trim();
    if (!command) {
      toast({ title: "Voice command empty", description: "Speak or type a command first.", variant: "destructive" });
      return;
    }
    const draft = parseBillingVoiceCommand(command, allProducts);
    setVoiceDraft(draft);
    if (draft.lines.length === 0) {
      toast({ title: "No product matched", description: "Add product aliases/Hindi names and try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Voice draft ready", description: `${draft.lines.length} item${draft.lines.length === 1 ? "" : "s"} matched. Review and add to cart.` });
  }

  function addVoiceDraftToCart() {
    if (!voiceDraft || voiceDraft.lines.length === 0) return;
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
          next = next.map((item) => cartItemKey(item) === candidateKey ? { ...item, quantity: roundMoney(item.quantity + line.quantity), rate: line.rate, unit: candidate.unit, sellingUnit, manualRate: true } : item);
        } else {
          next.push(candidate);
        }
      }
      return next;
    });
    voiceDraft.lines.forEach((line) => rememberRecentProduct(line.product.id));
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
    toast({ title: "Added to cart", description: "Review quantity, rate and profit before confirming bill." });
  }

  async function startVoiceListening() {
    if (voiceListening) {
      voiceRecognitionRef.current?.stop?.();
      setVoiceListening(false);
      return;
    }

    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      const message = "This browser cannot convert speech to text. Use Chrome/Edge, or type the command and press Parse command.";
      setVoiceMicMessage(message);
      toast({ title: "Mic speech not supported", description: message, variant: "destructive" });
      return;
    }

    const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      const message = "Mic works only on localhost or HTTPS. Open the app on localhost/HTTPS and allow microphone.";
      setVoiceMicMessage(message);
      toast({ title: "Mic blocked by browser", description: message, variant: "destructive" });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "This browser cannot request microphone permission. Use Chrome or Edge on localhost.";
      setVoiceMicMessage(message);
      toast({ title: "Mic not available", description: message, variant: "destructive" });
      return;
    }

    try {
      setVoiceMicMessage("Requesting microphone permission...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "PermissionError";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone is blocked. Click the lock icon near localhost, set Microphone to Allow, then refresh this page."
        : name === "NotFoundError"
          ? "No microphone is selected in Windows/browser input settings."
          : `Microphone permission failed (${name}). Type the command manually or fix browser mic permission.`;
      setVoiceMicMessage(message);
      toast({ title: "Mic permission needed", description: message, variant: "destructive" });
      return;
    }

    let gotResult = false;
    let heardText = "";
    const existingText = voiceCommand.trim();
    let autoStopTimer: number | undefined;
    const recognition = new Recognition();
    voiceRecognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceListening(true);
      setVoiceMicMessage("Mic is live. Speak slowly: Ramesh ke naam 2 kilo chini 45 rupay kilo.");
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
      setVoiceMicMessage("Voice captured once. Review the text, then press Parse command.");
    };

    recognition.onerror = (event) => {
      const error = event?.error ?? "unknown";
      const message = error === "not-allowed" || error === "service-not-allowed"
        ? "Mic permission is blocked. Click the lock icon near the URL and allow Microphone."
        : error === "audio-capture"
          ? "No microphone was found. Check Windows input device and browser mic permission."
          : error === "no-speech"
            ? "No voice was heard. Speak closer to the mic or type the command."
            : error === "network"
              ? "Chrome speech service is not reachable. Type the command and press Parse command."
              : `Voice capture failed (${error}). Type the command or try mic again.`;
      setVoiceMicMessage(message);
      if (error !== "aborted") {
        toast({ title: "Mic issue", description: message, variant: error === "no-speech" ? "default" : "destructive" });
      }
    };

    recognition.onend = () => {
      if (autoStopTimer) window.clearTimeout(autoStopTimer);
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
      if (gotResult) {
        setVoiceMicMessage("Voice captured. Press Parse command to review cart draft.");
      } else {
        setVoiceMicMessage("No command captured. Check browser mic permission, or type the command manually.");
      }
    };

    try {
      recognition.start();
    } catch (error) {
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
      const message = error instanceof Error ? error.message : "Mic could not start. Refresh page or type manually.";
      setVoiceMicMessage(message);
      toast({ title: "Mic could not start", description: message, variant: "destructive" });
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command) return;
      setVoiceCommand(command);
      setVoiceMicMessage("Voice assistant sent this command. Review the parsed draft before adding to cart.");
      window.setTimeout(() => parseVoiceDraft(command), 50);
    };
    window.addEventListener("kirana:voice-billing-command", handler);
    return () => window.removeEventListener("kirana:voice-billing-command", handler);
  }, [products.data, productSearchIndex]);

  function toggleFavoriteProduct(productId: string) {
    setFavoriteProductIds((previous) => {
      const next = previous.includes(productId) ? previous.filter((id) => id !== productId) : [productId, ...previous].slice(0, 40);
      saveSettingList(FAVORITE_PRODUCTS_KEY, next);
      return next;
    });
  }

  function updateQty(lineKey: string, nextQuantity: number) {
    setCart((previous) => previous
      .map((item) => {
        if (cartItemKey(item) !== lineKey) return item;
        const quantity = Math.max(0, roundMoney(nextQuantity));
        if (item.manualRate || item.isCustom) return { ...item, quantity };
        const priced = resolveLine(item.product, quantity, item.sellingUnit);
        return { ...item, quantity, rate: priced.rate, pricing: priced.pricing };
      })
      .filter((item) => item.quantity > 0));
  }

  function updateRate(lineKey: string, nextRate: number) {
    setCart((previous) => previous.map((item) => cartItemKey(item) === lineKey ? { ...item, rate: Math.max(0, roundMoney(nextRate)), manualRate: true } : item));
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
      const quantity = roundMoney(collision.quantity + updated.quantity);
      const mergedPrice = collision.manualRate ? undefined : resolveLine(collision.product, quantity, collision.sellingUnit);
      return previous
        .filter((item) => cartItemKey(item) !== lineKey)
        .map((item) => cartItemKey(item) === updatedKey
          ? { ...item, quantity, rate: collision.manualRate ? collision.rate : mergedPrice?.rate ?? collision.rate, pricing: collision.manualRate ? collision.pricing : mergedPrice?.pricing }
          : item);
    });
  }

  function removeItem(lineKey: string) {
    setCart((previous) => previous.filter((item) => cartItemKey(item) !== lineKey));
  }

  function validateBeforeConfirm(nextBillType: BillTypeSelection) {
    if (cart.length === 0) {
      toast({ title: "Cart is empty", description: "Add products or loose items before billing.", variant: "destructive" });
      return false;
    }
    if (cart.some((item) => item.quantity <= 0 || item.rate <= 0)) {
      toast({ title: "Invalid item", description: "Every item must have quantity and rate above zero.", variant: "destructive" });
      return false;
    }
    if (safeDiscount > subtotal) {
      toast({ title: "Discount too high", description: "Discount cannot exceed bill subtotal.", variant: "destructive" });
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
      toast({ title: "Customer required for udhar", description: "Select a customer or type customer name + mobile number.", variant: "destructive" });
      customerNameInputRef.current?.focus();
      return false;
    }
    if (!allowAdvancePayment && paymentMode !== SPLIT_PAYMENT && typeof paidAmount === "number" && paidAmount > grandTotal) {
      toast({ title: "Paid amount is more than bill", description: "Tick 'extra is advance' only if you really want to accept advance.", variant: "destructive" });
      return false;
    }
    if (paymentMode === SPLIT_PAYMENT && splitCash + splitUpi > grandTotal) {
      toast({ title: "Split payment too high", description: "Cash + UPI cannot exceed bill total.", variant: "destructive" });
      return false;
    }
    return true;
  }

  function makePrintableBill(nextBillType: BillTypeSelection, paid: number, credit: number, payments?: PrintableBill["payments"]): PrintableBill {
    const year = new Date().getFullYear();
    return {
      billNo: nextBillType === BillInputBillType.estimate ? `EST-${year}-LOCAL-${Date.now()}` : `LOCAL-${Date.now()}`,
      createdAt: new Date().toISOString(),
      customerName: resolvedCustomerName || "Walk-in",
      customerMobile: resolvedCustomerMobile || undefined,
      items: cart,
      subtotal,
      discount: safeDiscount,
      total: grandTotal,
      paid,
      credit,
      paymentMode,
      billType: nextBillType,
      payments,
      shop: {
        name: shop?.name ?? "KiranaOS",
        address: shop?.address ?? null,
        city: shop?.city ?? null,
        phone: shop?.phone ?? user?.mobile ?? null,
        gstNumber: shop?.gstNumber ?? null,
        cashierName: user?.name ?? null,
      },
      copyLabel: nextBillType === BillInputBillType.estimate ? "Estimate copy" : "Original customer copy",
    };
  }

  function billingSensitiveApprovalCovers(actions: BillingSensitiveAction[]) {
    if (actions.length === 0) return true;
    return Boolean(sensitiveApproval?.ownerPin && actions.every((action) => sensitiveApproval.actions.includes(action)));
  }

  function requiredBillingSensitiveActions(): BillingSensitiveAction[] {
    const actions: BillingSensitiveAction[] = [];
    const isLargeDiscount = subtotal > 0 && safeDiscount >= Math.max(100, subtotal * 0.1);
    if (isLargeDiscount) actions.push("large_discount");
    const hasBelowMinimumRate = cart.some(lineNeedsOwnerApproval);
    if (hasBelowMinimumRate) actions.push("selling_below_minimum_price");
    return actions;
  }

  function handleConfirm(overrideBillType?: BillTypeSelection, printDecision?: boolean) {
    if (!newBillingFeature.allowed) {
      toast({ title: "Billing locked", description: newBillingFeature.reason, variant: "destructive" });
      return;
    }
    if (!createBillPermission.allowed) {
      toast({ title: "Permission denied", description: createBillPermission.reason, variant: "destructive" });
      return;
    }
    if (safeDiscount > 0 && !applyDiscountPermission.allowed) {
      toast({ title: "Discount not allowed", description: applyDiscountPermission.reason, variant: "destructive" });
      return;
    }
    const nextBillType = overrideBillType ?? billType;
    const isUdharEntry = nextBillType === BillInputBillType.udhar_entry;

    if (!validateBeforeConfirm(nextBillType)) return;

    if (negativeStockWarnings.length > 0) {
      const first = negativeStockWarnings[0];
      toast({
        title: "Stock will go negative",
        description: `${first.productName}: ${first.available} ${first.unit} available, ${first.requested} ${first.unit} selling. Stock will become ${first.after} ${first.unit}.`,
      });
    }

    const sensitiveActions = requiredBillingSensitiveActions();
    if (sensitiveActions.length > 0 && !billingSensitiveApprovalCovers(sensitiveActions)) {
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
          ...(splitUpi > 0 ? [{ mode: BillPaymentMode.upi, amount: splitUpi }] : []),
          ...(remainingCredit > 0 ? [{ mode: BillPaymentMode.credit, amount: remainingCredit }] : []),
        ]
      : paymentMode === BillPaymentMode.credit || isUdharEntry
        ? [{ mode: BillPaymentMode.credit, amount: grandTotal }]
        : [
            ...(paid > 0 ? [{ mode: paymentMode, amount: paid }] : []),
            ...(remainingCredit > 0 ? [{ mode: BillPaymentMode.credit, amount: remainingCredit }] : []),
          ];

    const printable = makePrintableBill(nextBillType, paid, remainingCredit, payments);
    setLastPrintableBill(printable);
    pendingAutoPrintRef.current = null;

    if (printerConfig.autoPrint) {
      if (printDecision !== false) {
        const popup = window.open("", "_blank", "width=460,height=760");
        if (popup) {
          pendingAutoPrintRef.current = { popup, printable };
          writeBillingReceiptPendingWindow(popup, printable);
        } else {
          toast({ title: "Print blocked", description: "Bill will save. Use Print after saving or allow pop-ups.", variant: "destructive" });
        }
      }
    }

    confirmBill.mutate({
      data: {
        billType: nextBillType,
        gstMode: getTaxConfigSync().mode,
        customerId: resolvedCustomerId || undefined,
        customerName: resolvedCustomerName || "Walk-in",
        customerMobile: resolvedCustomerMobile || undefined,
        discount: safeDiscount,
        actualAmount: grandTotal,
        buyerPaidAmount: paid,
        waivedAmount: 0,
        allowAdvancePayment,
        advanceAmount,
        items: cart.map((item) => ({
          productId: item.isCustom ? undefined : item.product.id,
          sellingUnitId: item.sellingUnit?.id,
          sellingUnitCode: item.sellingUnit?.unitCode,
          sellingUnitLabel: item.sellingUnit?.name ?? item.unit,
          conversionToBase: item.sellingUnit?.conversionToBase,
          name: item.product.name,
          quantity: item.quantity,
          enteredUnit: item.unit,
          ratePerRateUnit: item.rate,
          originalUnitPrice: item.pricing?.originalUnitPrice,
          appliedPricingRuleId: item.pricing?.appliedRuleId ?? undefined,
          appliedPricingRuleType: item.pricing?.appliedRuleType,
          pricingExplanation: item.pricing?.explanation,
          pricingConfidence: item.pricing?.confidence,
          pricingCalculationVersion: item.pricing?.calculationVersion,
          wasPriceOverridden: item.manualRate === true,
          gstRate: item.product.gstRate ?? 0,
        })),
        payments,
        ownerPin: sensitiveActions.length > 0 ? sensitiveApproval?.ownerPin : undefined,
        reason: sensitiveActions.length > 0 ? sensitiveApproval?.reason : undefined,
        sensitiveActions,
      },
    });
  }

  // Snapshot the bill currently in the workspace as an open-bills entry (keyed by activeBillId).
  function serializeActiveBill(): HeldBill {
    return {
      id: activeBillId,
      sourceOrderId,
      label: `${resolvedCustomerName || "Walk-in"} • ₹${grandTotal.toLocaleString("en-IN")} • ${cart.length} item${cart.length === 1 ? "" : "s"}`,
      createdAt: new Date().toISOString(),
      cart,
      discount: safeDiscount,
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
    setCart(bill.cart ?? []);
    setDiscount(bill.discount ?? 0);
    setPaymentMode(bill.paymentMode ?? BillPaymentMode.cash);
    setBillType(bill.billType ?? BillInputBillType.normal_sale);
    setSelectedCustomerId(bill.selectedCustomerId ?? "walk_in");
    setCustomerName(bill.customerName ?? "");
    setCustomerMobile(bill.customerMobile ?? "");
    setPaidAmount(bill.paidAmount ?? "");
    setSplitCashAmount(bill.splitCashAmount ?? "");
    setSplitUpiAmount(bill.splitUpiAmount ?? "");
    setAllowAdvancePayment(bill.allowAdvancePayment ?? false);
    setDraftRestored(Boolean(bill.cart?.length));
  }

  // Save the workspace bill back into the open-bills set — but only if it has items, so empty
  // bills aren't littered around.
  function stashActiveBill(list: HeldBill[]): HeldBill[] {
    return cart.length > 0 ? upsertOpenBill(list, serializeActiveBill()) : list;
  }

  // Start a brand-new empty bill while keeping the current one in the Open Bills set.
  function newBill() {
    const nextHeld = stashActiveBill(heldBills);
    setHeldBills(nextHeld);
    saveSettingList(HELD_BILLS_KEY, nextHeld);
    resetCurrentBill();
    setActiveBillId(newBillId());
    clearBillingDraft();
  }

  // Explicit "Hold" button: save the current bill and clear the workspace.
  function holdCurrentBill() {
    if (cart.length === 0) {
      toast({ title: "Nothing to hold", description: "Add items before holding a bill." });
      return;
    }
    newBill();
    toast({ title: "Bill held", description: "Switch back to it any time from Open Bills." });
  }

  // Switch to another open bill WITHOUT losing the current one (it's stashed first).
  function resumeHeldBill(id: string) {
    const target = heldBills.find((entry) => entry.id === id);
    if (!target) return;
    const nextHeld = stashActiveBill(heldBills).filter((entry) => entry.id !== id);
    setHeldBills(nextHeld);
    saveSettingList(HELD_BILLS_KEY, nextHeld);
    loadBillIntoActive(target);
  }

  function clearCartWithConfirmation() {
    if (cart.length === 0) return;
    setClearConfirmOpen(true);
  }

  function executeClearCart() {
    setClearConfirmOpen(false);
    resetCurrentBill();
    clearBillingDraft();
    toast({ title: "Cart cleared", description: "Current bill was cleared." });
  }

  function printBillSnapshot(snapshot = lastPrintableBill ?? makePrintableBill(billType, effectivePaidAmount, creditAmount)) {
    const popup = window.open("", "_blank", "width=460,height=760");
    if (!popup) {
      toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
      return;
    }
    writeBillingReceiptWindow(popup, snapshot, { autoPrint: true });
  }

  function shareLastBillOnWhatsapp() {
    const snapshot = lastPrintableBill ?? makePrintableBill(billType, effectivePaidAmount, creditAmount);
    const shareInput: BillShareInput = {
      shopName: snapshot.shop?.name ?? "My Shop",
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
    };
    const { targetedCustomer } = shareBillOnWhatsapp(shareInput);
    toast({
      title: "Opening WhatsApp…",
      description: targetedCustomer ? "Ready to send to the customer's number." : "Pick a chat to send this bill.",
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
        holdCurrentBill();
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
    <div className="min-h-[calc(100dvh-var(--app-mobile-topbar-height)-var(--app-mobile-nav-height))] bg-white lg:h-[calc(100dvh-var(--app-desktop-topbar-height))] lg:min-h-0 lg:overflow-hidden">
      <div className="flex min-h-full flex-col gap-3 px-2.5 py-2.5 pb-24 sm:px-3 sm:py-3 sm:pb-24 lg:h-full lg:flex-row lg:gap-4 lg:px-4 lg:pb-3">
      {/* ── LEFT PANEL: product search + grid ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-visible lg:min-h-0 lg:overflow-hidden">
        {(heldBills.length > 0 || cart.length > 0) && (
          <OpenBillsBar
            bills={[
              { id: activeBillId, name: resolvedCustomerName || "Walk-in", itemCount: cart.length, active: true },
              ...heldBills.map((entry): OpenBillChip => ({ id: entry.id, name: entry.customerName?.trim() || "Walk-in", itemCount: entry.cart?.length ?? 0, active: false })),
            ]}
            onSwitch={resumeHeldBill}
            onNew={newBill}
          />
        )}
        <BillingOrderQrButton />
        <BillingSearch
          isOnline={isOnline}
          draftRestored={draftRestored}
          cartLength={cart.length}
          onHideDraftRestored={() => setDraftRestored(false)}
          search={search}
          onSearchChange={setSearch}
          searchInputRef={searchInputRef}
          productsLoading={products.isLoading || products.isFetching}
          filteredProducts={filteredProducts}
          onAddProduct={addToCart}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectedCategoryChange={setSelectedCategory}
          voiceVisible={voiceVisible}
          onToggleVoice={() => setVoiceVisible((v) => !v)}
          recentProducts={recentProducts}
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
        aria-label={mobileCheckoutOpen ? "Review and collect payment" : undefined}
      >
        <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-[#e1e8f2] bg-white px-4 lg:hidden">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#64748b]">Checkout</p>
            <h2 className="font-display text-[19px] font-black text-[#102347]">Review &amp; collect ₹{grandTotal.toLocaleString("en-IN")}</h2>
          </div>
          <button
            type="button"
            onClick={() => setMobileCheckoutOpen(false)}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#dce5f1] px-4 text-[13px] font-black text-[#42526e]"
            aria-label="Close checkout"
          >
            Back
          </button>
        </div>
        <div className="min-h-0 flex-1 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:p-0">
      <BillingSummary
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
        safeDiscount={safeDiscount}
        setDiscount={setDiscount}
        onCouponApplied={(offerId, discount) => { appliedOfferRef.current = offerId ? { id: offerId, discount } : null; }}
        gstAmount={gstBreakdown.gst}
        gstMode={gstBreakdown.mode}
        grandTotal={grandTotal}
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
        lastBillNo={lastBillNo}
        newBillingAllowed={newBillingFeature.allowed}
        newBillingReason={newBillingFeature.reason}
        createBillAllowed={createBillPermission.allowed}
        confirmBillPending={confirmBill.isPending}
        hasLastPrintableBill={Boolean(lastPrintableBill)}
        onConfirmBill={() => handleConfirm()}
        onSaveEstimate={() => handleConfirm(BillInputBillType.estimate)}
        onHoldBill={holdCurrentBill}
        onPrintBill={() => printBillSnapshot()}
        onSharePdf={() => shareLastBillOnWhatsapp()}
        onClearCart={clearCartWithConfirmation}
        onUpdateQty={updateQty}
        onUpdateRate={updateRate}
        onUpdateUnit={updateUnit}
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
      {cart.length > 0 && (
        <div
          className="fixed inset-x-0 z-40 border-t border-[#e6ecf4] bg-white px-3 py-2.5 shadow-[0_-6px_22px_rgba(15,35,80,0.10)] lg:hidden"
          style={{ bottom: "calc(var(--app-mobile-nav-height, 0px) + 1.5rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-[#64748b]">
                {cart.length} item{cart.length === 1 ? "" : "s"}
                {creditAmount > 0 ? " · udhar" : ""}
              </div>
              <div className="font-display text-[20px] font-black leading-tight text-[#0f1e3d]">
                ₹{grandTotal.toLocaleString("en-IN")}
              </div>
            </div>
            <button
              type="button"
              data-testid="mobile-save-bill"
              onClick={() => setMobileCheckoutOpen(true)}
              disabled={confirmBill.isPending || !newBillingFeature.allowed}
              className="inline-flex h-12 min-w-[150px] items-center justify-center rounded-xl bg-[#0057ff] px-5 text-[15px] font-black text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              {confirmBill.isPending
                ? "Saving…"
                : billType === BillInputBillType.estimate
                  ? `Review estimate · ₹${grandTotal.toLocaleString("en-IN")}`
                  : `Review & pay ₹${grandTotal.toLocaleString("en-IN")}`}
            </button>
          </div>
        </div>
      )}

      <OwnerPinModal
        open={sensitivePinOpen}
        onCancel={() => setSensitivePinOpen(false)}
        title="Owner approval required"
        description="Large discounts or selling below minimum price need owner PIN before the bill can be saved. The PIN and reason are passed into the local-first billing action and audit log."
        confirmLabel="Approve bill"
        reasonRequired
        onConfirm={async ({ ownerPin, reason }) => {
          const actions = requiredBillingSensitiveActions();
          setSensitiveApproval({ ownerPin, reason, actions });
          setSensitivePinOpen(false);
          const nextType = pendingSensitiveBillType ?? undefined;
          setPendingSensitiveBillType(null);
          window.setTimeout(() => handleConfirm(nextType), 0);
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear this bill?"
        description="All items in the current bill will be removed. This cannot be undone."
        confirmLabel="Clear bill"
        destructive
        onConfirm={executeClearCart}
        onCancel={() => setClearConfirmOpen(false)}
      />

      <ConfirmDialog
        open={printConfirmOpen}
        title="Print this bill after saving?"
        description="The bill will be saved either way. Choose print to open the configured receipt printer, or continue without printing."
        confirmLabel="Save & print"
        cancelLabel="Save without printing"
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
