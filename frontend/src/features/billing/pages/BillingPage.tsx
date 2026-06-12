import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BillInputBillType, BillPaymentMode, getListBillsQueryKey, useConfirmBill, useListCustomers, useListProducts, type Bill, type Customer, type Product } from "@/lib/api/client";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useAuth } from "@/features/auth/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { useFeature } from "@/features/subscription";
import { usePermission } from "@/features/staff/permissions";
import { useDebounce } from "@/hooks/use-debounce";
import { offlineDB } from "@/lib/offline/db";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BillingSearch } from "./components/BillingSearch";
import { BillingSummary } from "./components/BillingSummary";
import { BillingVoicePanel } from "./components/BillingVoicePanel";
import { clampAmount, normalizeSearchText, productMinSellingPrice, productSearchText, productSellingPrice, roundMoney } from "./billing-calculations";
import { writeBillingReceiptErrorWindow, writeBillingReceiptPendingWindow, writeBillingReceiptWindow } from "./billing-print";
import { getPrinterConfigSync, loadPrinterConfig } from "@/features/settings/printer-config";
import { redeemOffer } from "@/features/offers/api";
import { parseBillingVoiceCommand } from "./billing-voice-parser";
import { SPLIT_PAYMENT, type BillingDraft, type BillingSensitiveAction, type BillTypeSelection, type CartItem, type HeldBill, type PaymentSelection, type PrintableBill, type SpeechRecognitionConstructor, type SpeechRecognitionLike, type VoiceParsedDraft } from "./billing-types";

const BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";
const HELD_BILLS_KEY = "kirana-os:held-bills:v1";
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
  const [lastBillNo, setLastBillNo] = useState<string | null>(null);
  const [lastPrintableBill, setLastPrintableBill] = useState<PrintableBill | null>(null);
  const [summaryWidth, setSummaryWidth] = useState(() => readBillSummaryWidth());
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [sensitivePinOpen, setSensitivePinOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [sensitiveApproval, setSensitiveApproval] = useState<{ ownerPin: string; reason: string; actions: BillingSensitiveAction[] } | null>(null);
  const [pendingSensitiveBillType, setPendingSensitiveBillType] = useState<BillTypeSelection | null>(null);
  const [voiceCommand, setVoiceCommand] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<VoiceParsedDraft | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMicMessage, setVoiceMicMessage] = useState("Click mic and speak slowly. You can also type the same command.");
  const [voiceVisible, setVoiceVisible] = useState(false);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const debouncedSearch = useDebounce(search.trim(), 90);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const shouldSearchProducts = deferredSearch.length >= 1;

  const products = useListProducts({ limit: 350 }, {
    query: { staleTime: 2 * 60_000, placeholderData: (previousData: Product[] | undefined) => previousData ?? [] },
  });
  const customers = useListCustomers();

  const subtotal = useMemo(() => roundMoney(cart.reduce((sum, item) => sum + item.quantity * item.rate, 0)), [cart]);
  const safeDiscount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const grandTotal = roundMoney(Math.max(0, subtotal - safeDiscount));
  const totalGst = useMemo(() => cart.reduce((sum, item) => {
    const rate = item.product.gstRate ?? 0;
    if (rate <= 0) return sum;
    return sum + Math.round(item.quantity * item.rate * rate) / 100;
  }, 0), [cart]);
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
    : paymentMode === BillPaymentMode.credit || billType === BillInputBillType.udhar_entry || billType === BillInputBillType.estimate
      ? 0
      : plainPaidAmount;
  const advanceAmount = allowAdvancePayment && paymentMode !== SPLIT_PAYMENT ? roundMoney(Math.max(0, effectivePaidAmount - grandTotal)) : 0;
  const creditAmount = billType === BillInputBillType.estimate ? 0 : billType === BillInputBillType.udhar_entry ? grandTotal : roundMoney(Math.max(0, grandTotal - Math.min(effectivePaidAmount, grandTotal)));

  const allProducts = useMemo(() => (products.data ?? []).filter((product) => product.deletedAt == null && (product as { deleted_at?: unknown }).deleted_at == null), [products.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    allProducts.forEach((product) => {
      const category = product.category?.trim();
      if (category) set.add(category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 14);
  }, [allProducts]);

  const productById = useMemo(() => new Map(allProducts.map((product) => [product.id, product])), [allProducts]);

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
    writeBillingDraft({ cart, discount: safeDiscount, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment });
  }, [draftHydrated, cart, safeDiscount, paymentMode, billType, selectedCustomerId, customerName, customerMobile, paidAmount, splitCashAmount, splitUpiAmount, allowAdvancePayment]);

  useEffect(() => {
    if (discount !== safeDiscount) setDiscount(safeDiscount);
  }, [discount, safeDiscount]);

  // Hydrate the printer config cache so receipts honour the saved paper size,
  // copies, footer and auto-print toggle from Settings.
  useEffect(() => {
    void loadPrinterConfig();
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
        setSensitiveApproval(null);
        resetCurrentBill();
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
    setCart([]);
    setDiscount(0);
    setPaidAmount("");
    setSplitCashAmount("");
    setSplitUpiAmount("");
    setCustomerName("");
    setCustomerMobile("");
    setSelectedCustomerId("walk_in");
    setBillType(BillInputBillType.normal_sale);
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

  function addToCart(product: Product, options?: { custom?: boolean }) {
    setCart((previous) => {
      const existing = previous.find((item) => item.product.id === product.id && !item.isCustom);
      if (existing && !options?.custom) {
        const quantity = roundMoney(existing.quantity + 1);
        return previous.map((item) => item.product.id === product.id ? { ...item, quantity, rate: item.manualRate ? item.rate : productSellingPrice(product, quantity) } : item);
      }
      const quantity = 1;
      return [...previous, { product, quantity, rate: options?.custom ? product.defaultPricePerRateUnit : productSellingPrice(product, quantity), unit: product.rateUnit ?? product.displayUnit ?? "piece", isCustom: options?.custom, manualRate: options?.custom }];
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
        const existing = next.find((item) => item.product.id === line.product.id && !item.isCustom);
        if (existing) {
          next = next.map((item) => item.product.id === line.product.id ? { ...item, quantity: roundMoney(item.quantity + line.quantity), rate: line.rate, unit: line.unit, manualRate: true } : item);
        } else {
          next.push({ product: line.product, quantity: line.quantity, rate: line.rate, unit: line.unit, manualRate: true });
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

  function updateQty(productId: string, nextQuantity: number) {
    setCart((previous) => previous
      .map((item) => {
        if (item.product.id !== productId) return item;
        const quantity = Math.max(0, roundMoney(nextQuantity));
        return { ...item, quantity, rate: item.manualRate || item.isCustom ? item.rate : productSellingPrice(item.product, quantity) };
      })
      .filter((item) => item.quantity > 0));
  }

  function updateRate(productId: string, nextRate: number) {
    setCart((previous) => previous.map((item) => item.product.id === productId ? { ...item, rate: Math.max(0, roundMoney(nextRate)), manualRate: true } : item));
  }

  function updateUnit(productId: string, unit: string) {
    setCart((previous) => previous.map((item) => item.product.id === productId ? { ...item, unit } : item));
  }

  function removeItem(productId: string) {
    setCart((previous) => previous.filter((item) => item.product.id !== productId));
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
    const needsCustomer = nextBillType === BillInputBillType.udhar_entry || creditAmount > 0 || paymentMode === BillPaymentMode.credit || splitUdharAmount > 0;
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
    return {
      billNo: nextBillType === BillInputBillType.estimate ? `ESTIMATE-${Date.now()}` : `LOCAL-${Date.now()}`,
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
    const hasBelowMinimumRate = cart.some((item) => !item.isCustom && item.rate < productMinSellingPrice(item.product));
    if (hasBelowMinimumRate) actions.push("selling_below_minimum_price");
    return actions;
  }

  function handleConfirm(overrideBillType?: BillTypeSelection) {
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
    const isEstimate = nextBillType === BillInputBillType.estimate;
    const isUdharEntry = nextBillType === BillInputBillType.udhar_entry;

    if (!validateBeforeConfirm(nextBillType)) return;

    const sensitiveActions = requiredBillingSensitiveActions();
    if (sensitiveActions.length > 0 && !billingSensitiveApprovalCovers(sensitiveActions)) {
      setPendingSensitiveBillType(nextBillType);
      setSensitivePinOpen(true);
      return;
    }

    const paid = isEstimate || isUdharEntry ? 0 : effectivePaidAmount;
    const cappedPaidForCredit = Math.min(paid, grandTotal);
    const remainingCredit = isEstimate ? 0 : isUdharEntry ? grandTotal : roundMoney(Math.max(0, grandTotal - cappedPaidForCredit));

    const payments = isEstimate
      ? []
      : paymentMode === SPLIT_PAYMENT
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

    if (!isEstimate && overrideBillType === undefined && getPrinterConfigSync().autoPrint) {
      const popup = window.open("", "_blank", "width=460,height=760");
      if (popup) {
        pendingAutoPrintRef.current = { popup, printable };
        writeBillingReceiptPendingWindow(popup, printable);
      } else {
        toast({ title: "Print blocked", description: "Bill will save. Use Print after saving or allow pop-ups.", variant: "destructive" });
      }
    }

    confirmBill.mutate({
      data: {
        billType: nextBillType,
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
          name: item.product.name,
          quantity: item.quantity,
          enteredUnit: item.unit,
          ratePerRateUnit: item.rate,
          gstRate: item.product.gstRate ?? 0,
        })),
        payments,
        ownerPin: sensitiveActions.length > 0 ? sensitiveApproval?.ownerPin : undefined,
        reason: sensitiveActions.length > 0 ? sensitiveApproval?.reason : undefined,
        sensitiveActions,
      },
    });
  }

  function holdCurrentBill() {
    if (cart.length === 0) {
      toast({ title: "Nothing to hold", description: "Add items before holding a bill." });
      return;
    }
    const held: HeldBill = {
      id: `held-${Date.now()}`,
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
    const nextHeld = [held, ...heldBills].slice(0, 10);
    setHeldBills(nextHeld);
    saveSettingList(HELD_BILLS_KEY, nextHeld);
    resetCurrentBill();
    clearBillingDraft();
    toast({ title: "Bill held", description: "You can resume it from held bills." });
  }

  function resumeHeldBill(id: string) {
    const held = heldBills.find((entry) => entry.id === id);
    if (!held) return;
    setCart(held.cart ?? []);
    setDiscount(held.discount ?? 0);
    setPaymentMode(held.paymentMode ?? BillPaymentMode.cash);
    setBillType(held.billType ?? BillInputBillType.normal_sale);
    setSelectedCustomerId(held.selectedCustomerId ?? "walk_in");
    setCustomerName(held.customerName ?? "");
    setCustomerMobile(held.customerMobile ?? "");
    setPaidAmount(held.paidAmount ?? "");
    setSplitCashAmount(held.splitCashAmount ?? "");
    setSplitUpiAmount(held.splitUpiAmount ?? "");
    setAllowAdvancePayment(held.allowAdvancePayment ?? false);
    const nextHeld = heldBills.filter((entry) => entry.id !== id);
    setHeldBills(nextHeld);
    saveSettingList(HELD_BILLS_KEY, nextHeld);
    toast({ title: "Held bill resumed", description: held.label });
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

  async function sharePdfArchitecture() {
    const snapshot = lastPrintableBill ?? makePrintableBill(billType, effectivePaidAmount, creditAmount);
    const shareText = `${snapshot.billNo}\nTotal ₹${snapshot.total.toLocaleString("en-IN")}\nPaid ₹${snapshot.paid.toLocaleString("en-IN")}\nUdhar ₹${snapshot.credit.toLocaleString("en-IN")}`;
    if (navigator.share) {
      await navigator.share({ title: snapshot.billNo, text: shareText }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(shareText).catch(() => undefined);
    toast({ title: "PDF/share ready architecture", description: "Use Print → Save as PDF now. The same printable bill snapshot can be connected to a PDF blob/share service later." });
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && search) {
        event.preventDefault();
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [search]);

  return (
    <div className="h-[calc(100dvh-76px)] overflow-hidden bg-[#f7f9fd]">
      <div className="flex h-full flex-col gap-3 px-2.5 py-2.5 lg:flex-row">
      {/* ── LEFT PANEL: product search + grid ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
      <BillingSummary
        summaryWidth={summaryWidth}
        onStartSummaryResize={startSummaryResize}
        isOnline={isOnline}
        heldBills={heldBills}
        onResumeHeldBill={resumeHeldBill}
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
        onSharePdf={() => void sharePdfArchitecture()}
        onClearCart={clearCartWithConfirmation}
        onUpdateQty={updateQty}
        onUpdateRate={updateRate}
        onUpdateUnit={updateUnit}
        onRemoveItem={removeItem}
      />
      </div>

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
    </div>
  );
}
