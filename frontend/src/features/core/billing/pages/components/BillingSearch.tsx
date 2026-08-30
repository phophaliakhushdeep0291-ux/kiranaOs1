import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Mic,
  PauseCircle,
  ReceiptText,
  ScanLine,
  Search,
  Ticket,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { resolveBillPaymentMode } from "@/features/core/bills/payment-mode";
import { toast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useListBills } from "@/features/core/bills/queries";
import type { Bill, Product, ProductSellingUnit } from "@/lib/api/client";
import { applyBindSheetPick, normalizeSearchText, productSearchText, productSellingPrice, resolveScanOutcome } from "../billing-calculations";
import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { ACTIVITY_EVENTS, trackEvent, useSearchTracking } from "@/lib/activity";
import { lookupKnownProduct, type KnownProductDetails } from "@/features/core/products/product-knowledge";

/* ─── deterministic product placeholder colour ─── */
const PLACEHOLDER_COLORS = [
  "bg-orange-100 text-orange-700",
  "bg-green-100 text-green-700",
  "bg-yellow-100 text-yellow-700",
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-red-100 text-red-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
];

export function productPlaceholderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
}

export function getProductEmoji(name: string, category?: string | null): string {
  const t = ((category ?? "") + " " + name).toLowerCase();
  if (t.match(/atta|flour|wheat|aashirvaad|pillsbury/)) return "🌾";
  if (t.match(/rice|basmati|india gate/)) return "🍚";
  if (t.match(/oil|ghee|dalda|vanaspati|sunlite|fortune/)) return "🫙";
  if (t.match(/salt|namak|iodiz/)) return "🧂";
  if (t.match(/sugar|chini/)) return "🍬";
  if (t.match(/dal|pulse|lentil|chana|moong|toor|masoor/)) return "🫘";
  if (t.match(/tea|chai|brooke|red label/)) return "🍵";
  if (t.match(/coffee|nescafe|bru/)) return "☕";
  if (t.match(/milk|doodh|butter|cream|curd|dahi|cheese|paneer|lassi|dairy/)) return "🥛";
  if (t.match(/biscuit|parle|marie|bourbon|cookie|hide.seek/)) return "🍪";
  if (t.match(/chips|lays|kurkure|namkeen|snack|bhuja|wafer|bingo/)) return "🍟";
  if (t.match(/chocolate|cadbury|kitkat|five star|dairy milk/)) return "🍫";
  if (t.match(/juice|frooti|maaza|slice|tropicana|real juice/)) return "🥤";
  if (t.match(/water|bisleri|kinley|aquafina/)) return "💧";
  if (t.match(/cola|pepsi|coke|sprite|7up|soda|soft drink/)) return "🥤";
  if (t.match(/masala|spice|jeera|turmeric|haldi|chilli|mirch|garam|cardamom|coriander/)) return "🌶️";
  if (t.match(/soap|dove|lux|lifebuoy|dettol|bath bar/)) return "🧼";
  if (t.match(/shampoo|pantene|head.shoulders|sunsilk/)) return "🧴";
  if (t.match(/toothpaste|colgate|pepsodent|closeup|oral/)) return "🪥";
  if (t.match(/detergent|washing|surf|ariel|tide|rin powder|nirma/)) return "🫧";
  if (t.match(/floor|phenyl|lizol|colin|wiper|mop/)) return "🧹";
  if (t.match(/bread|roti|pav|bun|toast/)) return "🍞";
  if (t.match(/egg|anda/)) return "🥚";
  if (t.match(/noodle|maggi|yippee/)) return "🍜";
  if (t.match(/sauce|ketchup/)) return "🍅";
  if (t.match(/honey|jam|jelly|spread/)) return "🍯";
  if (t.match(/horlicks|bournvita|complan|health drink/)) return "💪";
  if (t.match(/sanitizer|handwash|hand wash/)) return "🤲";
  if (t.match(/candle|agarbatti|incense/)) return "🕯️";
  if (t.match(/match|lighter/)) return "🔥";
  return "📦";
}

const CATEGORY_LIMIT = 8;

type NativeBarcodeDetector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

function barcodeDetectorConstructor(): (new (options?: { formats?: string[] }) => NativeBarcodeDetector) | null {
  const detector = (globalThis as typeof globalThis & {
    BarcodeDetector?: new (options?: { formats?: string[] }) => NativeBarcodeDetector;
  }).BarcodeDetector;
  return typeof detector === "function" ? detector : null;
}

/* ─── props ─── */
interface BillingSearchProps {
  isOnline: boolean;
  draftRestored: boolean;
  cartLength: number;
  onHideDraftRestored: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  productsLoading: boolean;
  filteredProducts: Product[];
  /** Whole catalogue — the bind sheet searches this, not the category-filtered grid. */
  allProducts: Product[];
  onAddProduct: (product: Product, sellingUnit?: ProductSellingUnit) => void;
  /**
   * The multiplier the cashier typed (`3*rice`), or null. Display only — the
   * page applies it when the item is added, so this component never has to
   * know the difference between an untyped default and an explicit one.
   */
  typedQuantity?: number | null;
  /**
   * Capture-on-first-scan: bind the scanned code to this product, then add it to the cart.
   * Rejects when the code is already owned; the sheet shows the reason and stays open.
   */
  onBindBarcode: (product: Product, code: string) => Promise<void>;
  /** Open the product form pre-filled with the scanned code. */
  onCreateProductWithBarcode: (code: string, knownProduct?: KnownProductDetails) => void;
  categories: string[];
  selectedCategory: string;
  onSelectedCategoryChange: (category: string) => void;
  recentProducts: Product[];
  /** §13 suggestions for the next line: time-of-day prediction, or basket pairs. */
  suggestedProducts?: Product[];
  suggestionReason?: "predicted" | "combo" | null;
  /** Past searches offered as auto-complete. */
  searchSuggestions?: string[];
  /** Products trending in online sessions, marked on their card. */
  trendingProductIds?: ReadonlySet<string>;
  voiceVisible: boolean;
  onToggleVoice: () => void;
  /**
   * A secondary control parked at the end of the category rail. Screen-level
   * shortcuts that would otherwise claim a row of their own go here — the rail
   * already scrolls, so one more chip costs the product grid nothing.
   */
  railAction?: ReactNode;
  onHoldBill: () => void;
  cartItemCount: number;
  cartSubtotal: number;
  cartTax: number;
  cartDiscount: number;
  cartGrandTotal: number;
  onApplyDiscount: () => void;
  onApplyCoupon: () => void;
  onChooseCustomer: () => void;
}

/* ─── main component ─── */
export function BillingSearch({
  isOnline,
  draftRestored,
  cartLength,
  onHideDraftRestored,
  search,
  onSearchChange,
  searchInputRef,
  productsLoading,
  filteredProducts,
  allProducts,
  onAddProduct,
  typedQuantity = null,
  onBindBarcode,
  onCreateProductWithBarcode,
  categories,
  selectedCategory,
  onSelectedCategoryChange,
  recentProducts,
  suggestedProducts = [],
  suggestionReason = null,
  searchSuggestions = [],
  trendingProductIds,
  voiceVisible,
  onToggleVoice,
  railAction,
  onHoldBill,
  cartItemCount,
  cartSubtotal,
  cartTax,
  cartDiscount,
  cartGrandTotal,
  onApplyDiscount,
  onApplyCoupon,
  onChooseCustomer,
}: BillingSearchProps) {
  const { t } = useAppLanguage();
  const [showAll, setShowAll] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  // The search field shares its row with the scan and voice buttons, so on a
  // phone it has roughly 190px for a placeholder written for 400.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState(t("billing.search.pointCamera"));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // How many the grid shows before "View all products" is offered.
  const COLLAPSED_PRODUCT_COUNT = 10;
  const displayedProducts = showAll ? filteredProducts : filteredProducts.slice(0, COLLAPSED_PRODUCT_COUNT);
  // Offering it with nothing behind it is why it read as broken: the counter
  // taps "View all products", the same ten stay on screen, and the only thing
  // that ever changed anything was reloading the page.
  const canExpandProducts = filteredProducts.length > COLLAPSED_PRODUCT_COUNT;

  /* ── Capture-on-first-scan ──
     An unknown code opens a sheet asking which item it is. Every field below is set
     synchronously from the scan handler — nothing is fetched and nothing is awaited to
     open the sheet, so it paints on the frame after the scan. */
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [bindQuery, setBindQuery] = useState("");
  const [bindError, setBindError] = useState<string | null>(null);
  const [bindingProductId, setBindingProductId] = useState<string | null>(null);
  const [knowledgeLookupCode, setKnowledgeLookupCode] = useState<string | null>(null);
  const knowledgeRequestRef = useRef(0);
  // "Skip" — the queue is moving and this cashier does not want to teach the catalog
  // anything right now. Picking an item then adds it and binds nothing.
  const [skipBinding, setSkipBinding] = useState(false);
  const bindSearchRef = useRef<HTMLInputElement | null>(null);

  // The camera loop is started once per scanner session; adding the product lists to its
  // effect deps would tear the camera down every time the catalogue re-renders. A ref
  // keeps the resolver reading today's products without restarting the stream.
  const scanPoolRef = useRef({ filteredProducts, allProducts });
  scanPoolRef.current = { filteredProducts, allProducts };

  // §13. One search event per settled query, attributed to whatever the user
  // picked — that pairing is what the search auto-complete learns from.
  const { notifySelection } = useSearchTracking(search, filteredProducts.length, { screen: "/billing" });
  const addProduct = (product: Product, sellingUnit?: ProductSellingUnit) => {
    notifySelection(product.id, product.name);
    onAddProduct(product, sellingUnit);
  };
  const visibleCategories = showAllCategories ? categories : categories.slice(0, CATEGORY_LIMIT);
  const hasMoreCategories = categories.length > CATEGORY_LIMIT;

  function openBindSheet(code: string) {
    setBindCode(code);
    setBindQuery("");
    setBindError(null);
    setSkipBinding(false);
    setBindingProductId(null);
  }

  function closeBindSheet() {
    knowledgeRequestRef.current += 1;
    setKnowledgeLookupCode(null);
    setBindCode(null);
    setBindQuery("");
    setBindError(null);
    setSkipBinding(false);
    setBindingProductId(null);
  }

  function lookupSharedProduct(code: string) {
    const requestId = ++knowledgeRequestRef.current;
    setKnowledgeLookupCode(code);
    void lookupKnownProduct(code).then((knownProduct) => {
      if (knowledgeRequestRef.current !== requestId) return;
      setKnowledgeLookupCode(null);
      if (!knownProduct) return;
      closeBindSheet();
      onSearchChange("");
      toast({
        title: t("billing.search.knowledgeFound", { name: knownProduct.name }),
        description: t("billing.search.knowledgeFoundDetail", {
          detail: knownProduct.brand || knownProduct.category,
          source: knownProduct.source,
        }),
      });
      onCreateProductWithBarcode(code, knownProduct);
    });
  }

  /** Dismiss without binding: the code leaves the search box so the next scan is clean. */
  function dismissBindSheet() {
    closeBindSheet();
    onSearchChange("");
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  // Search text is derived once per catalogue, not once per keystroke.
  //
  // `productSearchText` runs four regex passes including a Unicode-property one,
  // and the bind sheet re-filtered the WHOLE catalogue through it on every letter
  // typed — which is the moment a scanner has just met an unknown barcode and the
  // counter is waiting. The main search box already works off a precomputed index
  // (BillingPage's `productSearchIndex`); this is the same idea, kept local so the
  // sheet does not need a new prop threaded through.
  const bindSearchIndex = useMemo(
    () => allProducts.map((product) => ({ product, searchText: productSearchText(product) })),
    [allProducts],
  );

  const bindCandidates = useMemo(() => {
    const query = normalizeSearchText(bindQuery);
    if (!query) return allProducts.slice(0, 8);
    const matches: Product[] = [];
    for (const entry of bindSearchIndex) {
      if (!entry.searchText.includes(query)) continue;
      matches.push(entry.product);
      // The sheet only ever shows eight; scanning the rest of a large catalogue
      // to throw the results away is the other half of the same waste.
      if (matches.length === 8) break;
    }
    return matches;
  }, [bindQuery, allProducts, bindSearchIndex]);

  async function pickForBind(product: Product) {
    const code = bindCode;
    if (!code || bindingProductId) return;

    setBindingProductId(product.id);
    setBindError(null);
    const outcome = await applyBindSheetPick({
      product,
      code,
      skip: skipBinding,
      bind: onBindBarcode,
      add: addProduct,
    });

    if (outcome.error) {
      setBindError(outcome.error || t("billing.search.bindFailed"));
      setBindingProductId(null);
      return;
    }
    dismissBindSheet();
    if (outcome.bound) {
      toast({ title: t("billing.search.bindSuccess"), description: `${code} → ${product.name}` });
    }
  }

  /** Open the sheet if this code belongs to nothing. Returns true when it did. */
  function openBindSheetIfUnknown(code: string): boolean {
    const { filteredProducts: onScreen, allProducts: catalogue } = scanPoolRef.current;
    const outcome = resolveScanOutcome(code, onScreen, catalogue);
    if (outcome.kind !== "unknown-code") return false;
    openBindSheet(outcome.code);
    lookupSharedProduct(outcome.code);
    return true;
  }
  // Held in a ref because the camera loop below is created once per scanner session and
  // would otherwise call whichever copy of this function the first render produced.
  const openBindSheetIfUnknownRef = useRef(openBindSheetIfUnknown);
  openBindSheetIfUnknownRef.current = openBindSheetIfUnknown;

  /** Enter in the search box, or a camera read. Returns true when it consumed the code. */
  function handleScannedTerm(term: string, source: "usb" | "camera"): boolean {
    const { filteredProducts: onScreen, allProducts: catalogue } = scanPoolRef.current;
    const outcome = resolveScanOutcome(term, onScreen, catalogue);
    if (outcome.kind === "match") {
      trackEvent(ACTIVITY_EVENTS.BARCODE_SCANNED, {
        source,
        matched: true,
        productId: outcome.product.id,
        sellingUnitId: outcome.sellingUnit?.id,
      });
      addProduct(outcome.product, outcome.sellingUnit);
      onSearchChange("");
      return true;
    }
    if (outcome.kind === "unknown-code") {
      trackEvent(ACTIVITY_EVENTS.BARCODE_SCANNED, { source, matched: false });
      openBindSheet(outcome.code);
      lookupSharedProduct(outcome.code);
      return true;
    }
    return false;
  }

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    const Detector = barcodeDetectorConstructor();

    if (!Detector) {
      setScannerOpen(false);
      searchInputRef.current?.focus();
      toast({
        title: t("billing.search.scannerNotSupported"),
        description: t("billing.search.scannerFallback"),
        variant: "destructive",
      });
      return;
    }
    const BarcodeDetectorImpl = Detector;

    async function startScanner() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(t("billing.search.cameraUnavailable"));
        }

        setScannerMessage(t("billing.search.startingCamera"));
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const detector = new BarcodeDetectorImpl({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
        });

        setScannerMessage(t("billing.search.scanning"));

        const scan = async () => {
          if (cancelled || !videoRef.current) return;

          try {
            if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              const codes = await detector.detect(videoRef.current);
              const value = codes.find((code) => typeof code.rawValue === "string" && code.rawValue.trim())?.rawValue?.trim();

              if (value) {
                trackEvent(ACTIVITY_EVENTS.BARCODE_SCANNED, { source: "camera" });
                onSearchChange(value);
                setScannerOpen(false);
                // A code the catalogue has never seen used to dead-end on "no results".
                // Ask which item it is instead; otherwise hand focus back to search.
                if (!openBindSheetIfUnknownRef.current(value)) {
                  window.setTimeout(() => searchInputRef.current?.focus(), 0);
                }
                toast({ title: t("billing.search.barcodeScanned"), description: value });
                return;
              }
            }
          } catch {
            setScannerMessage(t("billing.search.stillScanning"));
          }

          scanFrameRef.current = window.requestAnimationFrame(scan);
        };

        scanFrameRef.current = window.requestAnimationFrame(scan);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("billing.search.cameraBlocked");
        setScannerOpen(false);
        searchInputRef.current?.focus();
        toast({
          title: t("billing.search.scannerFailed"),
          description: `${message} You can still type or USB-scan into search.`,
          variant: "destructive",
        });
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (scanFrameRef.current !== null) {
        window.cancelAnimationFrame(scanFrameRef.current);
        scanFrameRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [scannerOpen, onSearchChange, searchInputRef]);

  // Escape leaves the bind sheet. Together with the close button and the tap-away area
  // that is three ways out — a cashier with a queue must never feel trapped by it.
  useEffect(() => {
    if (!bindCode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissBindSheet();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissBindSheet only closes over setters
  }, [bindCode]);

  const openBarcodeScanner = () => {
    setScannerMessage(t("billing.search.pointCamera"));
    setScannerOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">

      {/* ── Offline / draft banners ── */}
      {!isOnline && (
        <div className="shrink-0 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
          {t("billing.search.offlineBanner")}
        </div>
      )}
      {draftRestored && (
        <div className="shrink-0 rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
            <span>{t(cartLength === 1 ? "billing.search.draftRestored" : "billing.search.draftRestoredPlural", { count: cartLength })}</span>
            <button type="button" onClick={onHideDraftRestored} className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-blue-600 hover:underline">
              {t("billing.search.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* ── 1. Product Browser Card ── */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">

        {/* Top section: search + recent products */}
        <div className="shrink-0 px-4 pt-4">
          <div className="flex flex-col items-stretch gap-3 xl:flex-row xl:items-start xl:gap-4">

            {/* Search box */}
            <div className="min-w-0 flex-1">
              <div className="relative flex h-12 items-center gap-3 rounded-[10px] border border-[#e3eaf3] bg-white px-4 shadow-[0_3px_12px_rgba(30,55,90,0.035)] transition-colors focus-within:border-[var(--brand)] sm:h-[50px]">
                <Search size={18} className="shrink-0 text-[#6b7a9a]" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  data-testid="input-product-search"
                  aria-label={isNarrow ? t("billing.search.placeholderShort") : t("billing.search.placeholder")}
                  className="h-full flex-1 border-0 bg-transparent p-0 text-[14px] font-semibold text-[var(--brand-ink)] placeholder:font-medium placeholder:text-[#6b7a9a] focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder={isNarrow ? t("billing.search.placeholderShort") : t("billing.search.placeholder")}
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => {
                    // Scan-to-cart: a USB scanner types the barcode + Enter. A matched
                    // code adds the product and clears so the next scan is ready; a code
                    // that matches nothing opens the bind sheet instead of dead-ending on
                    // "no results". A typed word that matches nothing still does nothing.
                    if (e.key !== "Enter") return;
                    if (handleScannedTerm(search, "usb")) e.preventDefault();
                  }}
                />
                <kbd className="ml-auto hidden shrink-0 items-center gap-1 rounded-[7px] border border-[#E5DFD1] bg-[#f4f7fb] px-2 py-1 text-[11px] font-bold text-[#5E5748] sm:flex">
                  ⌘ K
                </kbd>
                {/* Scan and voice are how a counter enters a line without typing,
                    so they belong to the search field, not to a row of their own
                    below it. That row was 54px of a 812px phone spent on two
                    buttons with an empty half-screen beside them — on the one
                    screen where the product grid is the whole job. */}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-2">
                  <button
                    type="button"
                    title={t("billing.search.scanBarcode")}
                    aria-label={t("billing.search.scanBarcode")}
                    onClick={openBarcodeScanner}
                    className="grid h-11 w-11 place-items-center rounded-full border border-[#e4ebf5] bg-white text-[#5E5748] transition-colors hover:border-[#bcd0ff] hover:text-[var(--brand)] active:scale-95 lg:mouse:h-9 lg:mouse:w-9"
                  >
                    <ScanLine size={17} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title={t("billing.search.voiceBilling")}
                    aria-label={t("billing.search.openVoiceBilling")}
                    onClick={onToggleVoice}
                    className={`grid h-11 w-11 place-items-center rounded-full border transition-colors hover:border-[#bcd0ff] hover:text-[var(--brand)] active:scale-95 lg:mouse:h-9 lg:mouse:w-9 ${voiceVisible ? "border-[#bcd0ff] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[#e4ebf5] bg-white text-[#5E5748]"}`}
                  >
                    <Mic size={17} aria-hidden="true" />
                  </button>
                </span>
              </div>
            </div>

            {/* Recent products — its own bordered box */}
            {recentProducts.length > 0 && !search && (
              <div className="hidden shrink-0 px-1 py-1 xl:block">
                <p className="mb-1.5 text-[11px] font-semibold text-[#6B6455]">{t("billing.search.recentProducts")}</p>
                <div className="flex items-center gap-2.5">
                  {recentProducts.slice(0, 3).map((p) => {
                    const sellingUnit = (p.sellingUnits ?? []).filter((unit) => unit.isActive !== false).find((unit) => unit.isDefault)
                      ?? (p.sellingUnits ?? []).find((unit) => unit.isActive !== false);
                    const price = sellingUnit?.defaultPrice ?? productSellingPrice(p, 1);
                    const color = productPlaceholderColor(p.name);
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="flex min-w-[104px] items-center gap-2 rounded-lg border border-transparent bg-white px-2 py-1.5 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition-all hover:border-[var(--brand-border)]"
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[7px] text-lg ${color}`}>
                          {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-contain" /> : getProductEmoji(p.name, p.category)}
                        </span>
                        <div className="min-w-0 text-left">
                          <p className="max-w-[120px] truncate text-[11px] font-extrabold leading-[1.15] text-[#1C2146]">
                            {p.name}
                          </p>
                          <p className="mt-0.5 text-[11px] font-black text-[#1C2146]">₹{price}</p>
                        </div>
                      </button>
                    );
                  })}
                  {recentProducts.length > 3 && (
                    <button onClick={() => setShowAll(true)} title={t("billing.search.showAllProducts")} className="tap-target flex h-8 w-8 items-center justify-center rounded-full border border-[#e7edf5] bg-white shadow-[0_5px_12px_rgba(15,23,42,0.05)] transition-colors hover:bg-[#FAF7F0]">
                      <ChevronRight size={13} className="text-[#6B6455]" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* §13 auto-complete: past searches, offered only while typing so the
              empty counter screen stays quiet. */}
          {search.trim().length > 0 && searchSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#98917F]">{t("billing.search.searchedBefore")}</span>
              {searchSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    onSearchChange(suggestion);
                    searchInputRef.current?.focus();
                  }}
                  className="rounded-full border border-[#E5DFD1] bg-white px-2.5 py-1 text-[11px] font-bold text-[#5E5748] transition-colors hover:border-[var(--brand-border)] hover:text-[var(--brand)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {/* §13 next-line suggestions. An empty cart gets this user's usual
              products for this hour; a filled one gets what pairs with it. */}
          {!search && suggestedProducts.length > 0 && (
            <div className="mt-2.5">
              <p className="mb-1.5 text-[11px] font-semibold text-[#6B6455]">
                {suggestionReason === "combo" ? "Often added together" : "You usually bill now"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {suggestedProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex items-center gap-1.5 rounded-full border border-[#dce6f6] bg-[var(--brand-softer)] px-3 py-1.5 text-[11px] font-bold text-[#1C2146] transition-colors hover:border-[var(--brand-border)] hover:bg-[var(--brand-soft)]"
                  >
                    <span aria-hidden="true">{getProductEmoji(p.name, p.category)}</span>
                    <span className="max-w-[140px] truncate">{p.name}</span>
                    <span className="text-[#6B6455]">+</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category chips beside a pinned action.
              The action deliberately sits OUTSIDE the rail, for two reasons that
              both bit when it was briefly inside one:
                • the rail scrolls, and a shop with more than three categories
                  pushed the action hundreds of pixels past the right edge, so it
                  could not be found at all;
                • `.scroll-rail` carries a `mask-image`, and a mask makes its
                  element the containing block for `position: fixed` descendants —
                  so the action's dialog stopped covering the viewport and
                  collapsed into the 44px rail, clipped by the very same mask.
              Anything with a popover or dialog belongs on this side of the line. */}
          <div className="mt-3 flex items-stretch gap-2 lg:mt-[18px]">
            <div className="scroll-rail flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] lg:pb-4">
              <CategoryChip
                label={t("billing.search.allCategories")}
                active={selectedCategory === "all"}
                onClick={() => onSelectedCategoryChange("all")}
              />
              {visibleCategories.map((cat) => (
                <CategoryChip
                  key={cat}
                  label={cat}
                  active={selectedCategory === cat}
                  onClick={() => onSelectedCategoryChange(cat)}
                />
              ))}
              {hasMoreCategories && (
                <button onClick={() => setShowAllCategories((value) => !value)} className="h-11 shrink-0 rounded-[8px] border border-[#EAE4D8] bg-white px-5 text-[12.5px] font-semibold text-[#3a4a6b] transition-colors hover:bg-[#FAF7F0] lg:mouse:h-9">
                  {showAllCategories ? t("billing.search.categoriesLess") : t("billing.search.categoriesMore")} ▾
                </button>
              )}
            </div>
            {railAction ? <div className="shrink-0 pb-3 lg:pb-4">{railAction}</div> : null}
          </div>
        </div>

        {/* Product grid — scrollable */}
        {scannerOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#06142c]/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-[460px] overflow-hidden rounded-[14px] border border-white/20 bg-white shadow-[0_24px_70px_rgba(3,12,30,0.32)]">
              <div className="flex items-center justify-between border-b border-[#EAE4D8] px-4 py-3">
                <div>
                  <p className="text-[14px] font-black text-[#1B2145]">{t("billing.search.scanBarcode")}</p>
                  <p className="text-[12px] font-semibold text-[#837C6D]">{scannerMessage}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-full border border-[#e4ebf5] text-[#5E5748] hover:bg-[#FAF7F0] sm:mouse:h-9 sm:mouse:w-9"
                  aria-label={t("billing.search.closeScanner")}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="relative bg-black">
                <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-x-[14%] top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[var(--brand)] shadow-[0_0_18px_rgba(0,87,255,0.9)]" />
                <div className="pointer-events-none absolute inset-[12%] rounded-[14px] border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" />
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="text-[11px] font-semibold text-[#837C6D]">
                  {t("billing.search.scannerTip")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setScannerOpen(false);
                    searchInputRef.current?.focus();
                  }}
                  className="h-11 rounded-[8px] border border-[#dfe8f5] px-3 text-[12px] font-extrabold text-[var(--brand)] hover:bg-[#f5f9ff] sm:mouse:h-9"
                >
                  {t("billing.search.typeInstead")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Capture-on-first-scan sheet ──
            A code nothing answers to. Rather than "not found", ask which item it is:
            picking one binds the code and adds it to the cart in the same tap. Skip
            keeps a queue moving without teaching the catalogue anything. */}
        {bindCode && (
          <div className="absolute inset-0 z-40 flex flex-col justify-end bg-[#06142c]/50">
            {/* Tap anywhere above the sheet to dismiss — one tap, always available. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("billing.search.bindDismiss")}
              onClick={dismissBindSheet}
              className="min-h-[56px] flex-1 cursor-default"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("billing.search.bindQuestion")}
              data-testid="barcode-bind-sheet"
              className="max-h-[86%] overflow-y-auto rounded-t-[16px] border-t border-[#EAE4D8] bg-white shadow-[0_-18px_50px_rgba(3,12,30,0.28)]"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#F1ECE2] px-4 pb-3 pt-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-black text-[#1B2145]">
                    {t("billing.search.bindTitle", { code: bindCode })}
                  </p>
                  <p className="mt-0.5 text-[12px] font-semibold text-[#837C6D]">
                    {knowledgeLookupCode === bindCode ? t("billing.search.knowledgeLooking") : skipBinding ? t("billing.search.bindSkipActive") : t("billing.search.bindQuestion")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissBindSheet}
                  aria-label={t("billing.search.bindDismiss")}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#e4ebf5] text-[#5E5748] hover:bg-[#FAF7F0] sm:mouse:h-9 sm:mouse:w-9"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-4 pt-3">
                <div className="flex h-12 items-center gap-3 rounded-[10px] border border-[#e3eaf3] bg-white px-4 focus-within:border-[var(--brand)] sm:h-[46px]">
                  <Search size={17} className="shrink-0 text-[#6b7a9a]" aria-hidden="true" />
                  <Input
                    ref={bindSearchRef}
                    data-testid="barcode-bind-search"
                    autoFocus
                    className="h-full flex-1 border-0 bg-transparent p-0 text-[14px] font-semibold text-[var(--brand-ink)] placeholder:font-medium placeholder:text-[#6b7a9a] focus-visible:ring-0 focus-visible:ring-offset-0"
                    placeholder={t("billing.search.bindSearchPlaceholder")}
                    value={bindQuery}
                    disabled={knowledgeLookupCode === bindCode}
                    onChange={(e) => setBindQuery(e.target.value)}
                  />
                </div>
              </div>

              {bindError && (
                <p className="mx-4 mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
                  {bindError}
                </p>
              )}

              <div className="px-2 py-2">
                {knowledgeLookupCode === bindCode ? (
                  <div className="flex items-center justify-center gap-2 px-2 py-8 text-[12px] font-bold text-[var(--brand)]" data-testid="barcode-knowledge-loading">
                    <Search size={17} className="animate-pulse" /> {t("billing.search.knowledgeLoading")}
                  </div>
                ) : bindCandidates.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[12px] font-semibold text-[#837C6D]">
                    {t("billing.search.bindNoMatch")}
                  </p>
                ) : (
                  bindCandidates.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      data-testid={`barcode-bind-option-${product.id}`}
                      disabled={bindingProductId != null}
                      onClick={() => void pickForBind(product)}
                      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-[#f5f9ff] disabled:opacity-60"
                    >
                      <span className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[8px] text-lg ${productPlaceholderColor(product.name)}`}>
                        {product.imageUrl
                          ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain" />
                          : getProductEmoji(product.name, product.category)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-extrabold text-[#1C2146]">{product.name}</span>
                        <span className="block truncate text-[11px] font-semibold text-[#837C6D]">
                          {product.barcode
                            ? t("billing.search.bindHasCode", { code: String(product.barcode) })
                            : product.category ?? ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] font-black text-[var(--brand)]">
                        {bindingProductId === product.id ? t("billing.search.bindSaving") : "+"}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-[#F1ECE2] px-4 py-3">
                <button
                  type="button"
                  data-testid="barcode-bind-create"
                  disabled={knowledgeLookupCode === bindCode}
                  onClick={() => {
                    const code = bindCode;
                    closeBindSheet();
                    onSearchChange("");
                    onCreateProductWithBarcode(code);
                  }}
                  className="h-11 flex-1 rounded-[8px] border border-[#dfe8f5] px-3 text-[12px] font-extrabold text-[var(--brand)] hover:bg-[#f5f9ff] sm:mouse:h-10"
                >
                  {t("billing.search.bindCreateNew")}
                </button>
                <button
                  type="button"
                  data-testid="barcode-bind-skip"
                  disabled={knowledgeLookupCode === bindCode}
                  onClick={() => {
                    // Never block the counter. From here a pick just adds the item.
                    setSkipBinding(true);
                    setBindError(null);
                    bindSearchRef.current?.focus();
                  }}
                  className="h-11 rounded-[8px] border border-[#EAE4D8] px-4 text-[12px] font-extrabold text-[#5E5748] hover:bg-[#FAF7F0] sm:mouse:h-10"
                >
                  {t("billing.search.bindSkip")}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {productsLoading && filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#6B6455]">
              <Search size={22} className="animate-pulse text-[var(--brand)]/60" />
              <p className="text-sm">{t("billing.search.loadingProducts")}</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#FAF7F0] text-2xl text-[#6B6455]">?</span>
              <div>
                <p className="text-sm font-bold text-[#1B2145]">
                  {search ? t("billing.search.noResultsFor", { term: search }) : t("billing.search.noProductsYet")}
                </p>
                <p className="mt-1 text-xs text-[#6B6455]">
                  {search ? t("billing.search.noMatch") : t("billing.search.addFromProductsPage")}
                </p>
              </div>
            </div>
          ) : (
            <>
              {search && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#6B6455]">
                    {filteredProducts.length === 1 ? t("billing.search.resultCount", { count: filteredProducts.length }) : t("billing.search.resultCountPlural", { count: filteredProducts.length })}
                  </p>
                  {/* A typed multiplier changes what tapping a card does, so it
                      has to be on screen. Silent quantity is how a cashier
                      bills three of something and finds out at the total. */}
                  {typedQuantity != null && (
                    <span
                      data-testid="typed-quantity-badge"
                      className="rounded-full bg-[#E7E9F5] px-2.5 py-1 text-xs font-semibold tabular-nums text-[#2E3A8C]"
                    >
                      {t("billing.search.addingQuantity", { count: typedQuantity })}
                    </span>
                  )}
                </div>
              )}

              {/* Keep cards comfortably scannable at counter-sized laptop widths. */}
              <div className="grid grid-cols-2 gap-3 min-[520px]:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {displayedProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAdd={() => addProduct(product)}
                    trending={trendingProductIds?.has(product.id) ?? false}
                    t={t}
                  />
                ))}
              </div>

              {/* View all products — only when there is more to reveal. */}
              {canExpandProducts && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#dfe8f5] bg-white px-7 text-[12px] font-semibold text-[var(--brand)] shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition-colors hover:bg-[#f5f9ff] lg:mouse:h-[38px]"
                >
                  {showAll ? (
                    <>{t("billing.search.showLess")} <ChevronUp size={13} /></>
                  ) : (
                    <>{t("billing.search.viewAllProducts")} <ChevronDown size={13} /></>
                  )}
                </button>
              </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Secondary context belongs below the selling workflow and only appears on
          genuinely wide counters. At common 1280px laptop widths these panels
          compressed into unreadable, overlapping columns. */}
      {!search && (
        <div className="hidden shrink-0 grid-cols-[1.45fr_1fr_1.15fr] gap-3 2xl:grid" style={{ height: "236px" }}>
          <RecentBillsPanel />
          <QuickActionsPanel onHoldBill={onHoldBill} onApplyDiscount={onApplyDiscount} onApplyCoupon={onApplyCoupon} onChooseCustomer={onChooseCustomer} />
          <BillingTipsPanel />
        </div>
      )}

      {/* ── 3. Order Summary Card ── */}
      {cartItemCount > 0 && (
        <div className="flex shrink-0 flex-col gap-3 rounded-[13px] border border-[#EAE4D8] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:px-[22px] lg:hidden">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[12px] font-bold text-[#5b6b89]">{t("billing.search.orderSummary")}</p>
            <div className="flex flex-wrap items-center gap-3 sm:gap-[30px]">
              {/* Items */}
              <div className="flex items-center gap-2.5">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-blue-50">
                  <ReceiptText size={14} className="text-[var(--brand)]" />
                </span>
                <div>
                  <p className="text-[13px] font-black text-[#1B2145]">
                    {cartItemCount} {cartItemCount === 1 ? t("billing.search.itemSingular") : t("billing.search.items")}
                  </p>
                  <p className="text-[10px] text-[#7a89a3]">{t("billing.search.products")}</p>
                </div>
              </div>
              {/* Subtotal */}
              <div className="flex items-center gap-2.5">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-emerald-50 text-[13px] font-black text-emerald-600">
                  ₹
                </span>
                <div>
                  <p className="text-[13px] font-black text-[#1B2145]">
                    ₹{cartSubtotal.toLocaleString("en-IN")}
                  </p>
                  <p className="text-[10px] text-[#7a89a3]">{t("billing.search.subtotal")}</p>
                </div>
              </div>
              {/* Tax */}
              {cartTax > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-purple-50 text-xs font-black text-purple-600">
                    %
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-[#1B2145]">
                      ₹{(Math.round(cartTax * 100) / 100).toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] text-[#7a89a3]">{t("billing.search.gst")}</p>
                  </div>
                </div>
              )}
              {/* Discount */}
              {cartDiscount > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-amber-50 text-xs font-black text-amber-600">
                    −
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-emerald-600">
                      −₹{cartDiscount.toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] text-[#7a89a3]">{t("billing.search.discount")}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Grand total — right aligned */}
          <div className="shrink-0 text-left sm:ml-auto sm:text-right">
            <p className="font-display text-[22px] font-black tracking-tight text-[var(--brand-ink)]">
              ₹{cartGrandTotal.toLocaleString("en-IN")}
            </p>
            <p className="mt-1 text-[12px] font-semibold text-[#6B6455]">{t("billing.search.grandTotal")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Product card — spec: 176px height, absolute price + add button ─── */
// `t` arrives as a prop rather than from the context: this renders once per tile in the
// product grid, and the page above it already holds the translator.
function ProductCard({ product, onAdd, trending = false, t }: { product: Product; onAdd: () => void; trending?: boolean; t: Translate }) {
  const sellingUnits = (product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
  const defaultUnit = sellingUnits.find((unit) => unit.isDefault) ?? sellingUnits[0];
  const price = defaultUnit?.defaultPrice ?? productSellingPrice(product, 1);
  const unit = defaultUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "pc";
  const stock = product.stockBaseQty ?? 0;
  const emoji = getProductEmoji(product.name, product.category);

  const priceLabel = price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subtitle = unit;

  return (
    <button
      data-testid={`product-card-${product.id}`}
      onClick={onAdd}
      className="group relative h-[176px] overflow-hidden rounded-[10px] border border-[#e3e9f2] bg-white p-3 pb-[44px] text-left transition-all duration-150 hover:-translate-y-px hover:border-[#bcd0ff] hover:shadow-[0_9px_22px_rgba(15,23,42,0.065)]"
    >
      {/* Image area — neutral photo placeholder */}
      <div className="relative mb-2.5 flex h-[76px] items-center justify-center overflow-hidden rounded-[7px] bg-[#FAF8F2]">
        {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain p-1" /> : <span className="text-[40px] leading-none" aria-hidden="true">{emoji}</span>}
        {stock <= 0 ? (
          <span className="absolute bottom-1 right-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">{t("billing.search.stockOut")}</span>
        ) : stock <= 5 ? (
          <span className="absolute bottom-1 right-1 rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">{t("billing.search.stockLow")}</span>
        ) : null}
        {sellingUnits.length > 1 ? (
          <span className="absolute left-1.5 top-1.5 rounded-md border border-[var(--brand-border)] bg-white/95 px-1.5 py-0.5 text-[8.5px] font-black text-[var(--brand)] shadow-sm">
            {t("billing.search.packSizes", { count: sellingUnits.length })}
          </span>
        ) : trending ? (
          /* §13: this product is being viewed a lot in online sessions right
             now. A marker, not a reordering — the grid stays predictable. */
          <span title={t("chrome.trendingOnline")} className="absolute left-1.5 top-1.5 rounded-md border border-[#f6d9a8] bg-[#fff8ec]/95 px-1.5 py-0.5 text-[8.5px] font-black text-[#b45309] shadow-sm">
            Trending
          </span>
        ) : null}
      </div>

      {/* Name + size/category */}
      <p className="line-clamp-1 text-[13px] font-extrabold leading-[1.2] text-[#1C2146]">
        {product.name}
      </p>
      <p className="mt-1 truncate text-[12px] font-medium text-[#687895]">{subtitle}</p>

      {/* Price — absolute bottom-left, ₹X.00 */}
      <span className="absolute bottom-3 left-3 text-[15px] font-black text-[var(--brand-ink)]">
        ₹{priceLabel}
      </span>

      {/* Add button — bottom-right, white with border, blue + */}
      <span className="absolute bottom-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-[10px] border border-[#dfe8f5] bg-white text-lg font-bold text-[var(--brand)] transition-all group-hover:border-[var(--brand)] group-hover:bg-[#f5f9ff]">
        +
      </span>
    </button>
  );
}

/* ─── Category chip — rounded-[8px] per spec ─── */
function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 shrink-0 rounded-[8px] border px-5 text-[12px] font-semibold capitalize transition-all lg:mouse:h-9 ${
        active
          ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-[0_8px_16px_rgba(0,87,255,0.2)]"
          : "border-[#EAE4D8] bg-white text-[#3a4a6b] hover:bg-[#FAF7F0]"
      }`}
    >
      {label}
    </button>
  );
}

/* ─── Recent Bills panel ─── */
function RecentBillsPanel() {
  const { t } = useAppLanguage();
  const today = new Date().toISOString().slice(0, 10);
  const { data: result } = useListBills(
    { from: today, to: today, limit: 6 },
    { query: { staleTime: 30_000 } },
  );
  const bills: Bill[] = Array.isArray(result)
    ? result
    : (result as { bills?: Bill[]; entries?: Bill[] } | undefined)?.bills ?? (result as { entries?: Bill[] } | undefined)?.entries ?? [];

  function paymentLabel(bill: Bill): string {
    // Reads the outstanding amount first, so a credit bill — which has no
    // payment rows at all, because nothing was tendered — is not reported as cash.
    const mode = resolveBillPaymentMode(bill as unknown as Record<string, unknown>);
    if (mode === "upi") return t("billing.pay.upi");
    if (mode === "udhar" || mode === "credit") return t("billing.search.udhar");
    if (mode === "bank") return t("billing.pay.bank");
    if (mode === "split") return t("billing.pay.split");
    if (mode === "card") return "Card";
    if (mode === "cash") return t("billing.pay.cash");
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  function badgeClass(label: string): string {
    if (label === "UPI") return "bg-[#eef4ff] text-[var(--brand)]";
    if (label === "Udhar") return "bg-amber-50 text-amber-700";
    if (label === "Bank") return "bg-blue-50 text-blue-700";
    if (label === "Card") return "bg-[#f3e8ff] text-[#7c3aed]";
    return "bg-[#e9fff0] text-[#16a34a]";
  }

  return (
    <div className="h-full overflow-hidden rounded-[13px] border border-[#EAE4D8] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-[14px] flex items-center justify-between">
        <h3 className="font-display text-[14px] font-black tracking-tight text-[#1B2145]">{t("billing.search.recentBills")}</h3>
        <Link
          to="/bills"
          className="flex items-center gap-0.5 text-[12px] font-extrabold text-[var(--brand)] hover:underline"
        >
          {t("dashboard.viewAll")} <ChevronRight size={12} />
        </Link>
      </div>

      {bills.length === 0 ? (
        <p className="py-4 text-center text-xs text-[#6B6455]">{t("billing.search.noBillsToday")}</p>
      ) : (
        <div className="space-y-0">
          {bills.map((bill, i) => {
            const fullBillNo = bill.billNo ?? bill.billNumber ?? `#${i + 1}`;
            const suffix = String(fullBillNo).match(/(\d+)$/)?.[1];
            const billNo = suffix ? `#${Number(suffix)}` : String(fullBillNo);
            const time = bill.createdAt
              ? new Date(bill.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
              : "";
            const amount = bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0;
            const customer =
              bill.customerName && bill.customerName !== "Walk-in" ? bill.customerName : t("billing.search.walkIn");
            const pmtLabel = paymentLabel(bill);

            return (
              // The key was `billNo + i`, and concatenating two variable-length
              // numbers collides: bill #11 at index 5 and bill #1 at index 15
              // both spell "#115", which is exactly what today's list produced.
              // React then reused one row's DOM for the other. The bill's own id
              // is unique by construction; the index is only a last resort for a
              // record that somehow has neither id nor number.
              <div
                key={bill.id ?? `${fullBillNo}-${i}`}
                className="flex h-[38px] items-center gap-2 text-[11px]"
              >
                <span className="w-[70px] shrink-0 truncate font-extrabold text-[#1B2145]">{billNo}</span>
                <span className="w-[60px] shrink-0 font-semibold text-[#837C6D]">{time}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-[#837C6D]">{customer}</span>
                <span className="shrink-0 text-right font-black text-[#1B2145] tabular-nums">
                  ₹{amount.toLocaleString("en-IN")}
                </span>
                <span className={`shrink-0 inline-flex h-[22px] items-center justify-center rounded-[7px] px-2 text-[10px] font-extrabold ${badgeClass(pmtLabel)}`}>
                  {pmtLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Quick Actions panel ─── */
function QuickActionsPanel({ onHoldBill, onApplyDiscount, onApplyCoupon, onChooseCustomer }: { onHoldBill: () => void; onApplyDiscount: () => void; onApplyCoupon: () => void; onChooseCustomer: () => void }) {
  const { t } = useAppLanguage();
  const actions = [
    {
      iconEl: <Zap size={15} />,
      iconBg: "bg-[#e9fff0] text-[#16a34a]",
      title: t("billing.search.actionDiscount"),
      description: t("billing.search.actionDiscountHint"),
      hint: "F4",
      onClick: onApplyDiscount,
    },
    {
      iconEl: <Ticket size={15} />,
      iconBg: "bg-[#f3e8ff] text-[#7c3aed]",
      title: t("billing.search.actionCoupons"),
      description: t("billing.search.actionCouponsHint"),
      hint: null as string | null,
      onClick: onApplyCoupon,
    },
    {
      iconEl: <Users size={15} />,
      iconBg: "bg-[#fff3e4] text-[#f97316]",
      title: t("billing.search.actionCustomers"),
      description: t("billing.search.actionCustomersHint"),
      hint: null as string | null,
      onClick: onChooseCustomer,
    },
    {
      iconEl: <PauseCircle size={15} />,
      iconBg: "bg-[#eef4ff] text-[var(--brand)]",
      title: t("billing.search.actionHold"),
      description: t("billing.search.actionHoldHint"),
      hint: "F9",
      onClick: onHoldBill,
    },
  ];

  return (
    <div className="h-full overflow-hidden rounded-[13px] border border-[#EAE4D8] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <h3 className="mb-[14px] font-display text-[14px] font-black tracking-tight text-[#1B2145]">{t("billing.search.quickActions")}</h3>
      <div className="space-y-0">
        {actions.map((action) => (
          <button
            key={action.title}
            onClick={action.onClick}
            className="flex h-[48px] w-full items-center gap-3 rounded-lg px-1 text-left transition-colors hover:bg-[#FAF7F0]"
          >
            <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] ${action.iconBg}`}>
              {action.iconEl}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-extrabold text-[#1B2145]">{action.title}</p>
              <p className="text-[10.5px] text-[#837C6D]">{action.description}</p>
            </div>
            {action.hint && (
              <kbd className="shrink-0 inline-flex h-[22px] min-w-[28px] items-center justify-center rounded-[7px] border border-[#E5DFD1] bg-[#f4f7fb] px-2 text-[10px] font-extrabold text-[#6B6455]">
                {action.hint}
              </kbd>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Billing Tips panel ─── */
function BillingTipsPanel() {
  const { t } = useAppLanguage();
  const tips = [
    { action: t("billing.search.tipScan"), key: "F2", detail: t("billing.search.tipScanDetail") },
    { action: t("billing.search.tipUse"), key: "F4", detail: t("billing.search.tipDiscountDetail") },
    { action: t("billing.search.tipUse"), key: "F6", detail: t("billing.search.tipCustomerDetail") },
    { action: t("billing.search.tipUse"), key: "F9", detail: t("billing.search.tipHoldDetail") },
    { action: t("billing.search.tipPress"), key: "Ctrl + S", detail: t("billing.search.tipSaveDetail") },
  ];

  return (
    <div className="h-full overflow-hidden rounded-[13px] border border-[#EAE4D8] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-[14px] flex items-center gap-2">
        <h3 className="font-display text-[14px] font-black tracking-tight text-[#1B2145]">{t("billing.search.tipsTitle")}</h3>
        <Clock size={13} className="text-[#6B6455]" />
      </div>
      <div className="space-y-0">
        {tips.map((tip) => (
          <div key={tip.key} className="flex min-h-[32px] items-center gap-2 text-[11px] font-semibold text-[#5d6f8d]">
            <span className="h-[13px] w-[13px] shrink-0 text-[#16a34a]">✓</span>
            <span>
              {tip.action}{" "}
              <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-[5px] bg-[var(--brand-soft)] px-1.5 text-[10px] font-black text-[var(--brand)]">
                {tip.key}
              </span>{" "}
              {tip.detail}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[18px] flex justify-center">
        <button className="flex items-center gap-1.5 text-[12px] font-extrabold text-[var(--brand)] hover:underline">
          {t("billing.search.viewAllShortcuts")} <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
