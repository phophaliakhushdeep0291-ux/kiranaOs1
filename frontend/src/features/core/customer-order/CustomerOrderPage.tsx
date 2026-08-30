import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";
import { useParams } from "wouter";
import { guestWebsiteRedirect } from "./restaurant-website";
import {
  ArrowLeft,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  LayoutGrid,
  List,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { buildOrderQrPayloads } from "@/lib/qr/cart-codec";
import { ACTIVITY_EVENTS, sessionAgeMs, trackEvent, useOnlineProductImpression, useOnlineSession } from "@/lib/activity";
import {
  loadCustomerCatalog,
  readCachedCatalog,
  submitCustomerOrder,
  fetchOrderStatus,
  rememberMyOrder,
  readMyOrder,
  forgetMyOrder,
  CatalogUnavailableError,
  OrderNotFoundError,
  type CustomerCatalog,
  type CustomerCatalogProduct,
  type CustomerOrderStatus,
  type OrderStage,
  type SubmitOrderResult,
} from "./catalog";

const formatRs = (n: number) => `Rs ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const normalizeMobile = (value: string) => value.replace(/[\s-]/g, "");
const timeSlots = ["As soon as possible", "Within 2 hours", "Call me to confirm the time"];

function newOrderIdempotencyKey(shopCode: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `customer-order:${shopCode}:${random}`;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; catalog: CustomerCatalog; source: "network" | "cache" }
  | { kind: "error"; message: string; unavailable: boolean };

type FulfillmentMode = "delivery" | "pickup";
type ViewMode = "grid" | "list";
type CustomerStorefrontView = "shop" | "orders" | "lists" | "offers" | "wallet" | "addresses" | "payments" | "settings" | "support";

interface CartItem {
  product: CustomerCatalogProduct;
  qty: number;
  lineTotal: number;
}

export default function CustomerOrderPage() {
  const { t } = useAppLanguage();
  const params = useParams<{ shopCode: string }>();
  const shopCode = params.shopCode ?? "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeView, setActiveView] = useState<CustomerStorefrontView>("shop");
  const [fulfillment, setFulfillment] = useState<FulfillmentMode>("delivery");
  const [timeSlot, setTimeSlot] = useState(timeSlots[0]);
  const [sheet, setSheet] = useState<"none" | "checkout" | "qr">("none");
  const [form, setForm] = useState({ name: "", mobile: "", address: "", note: "" });
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<SubmitOrderResult | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState<{ key: string; fingerprint: string } | null>(null);
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
  const [showTracker, setShowTracker] = useState(false);
  const [switchingLocation, setSwitchingLocation] = useState(false);

  useEffect(() => {
    const mine = readMyOrder(shopCode);
    if (mine) setTrackedOrderId(mine.orderId);
  }, [shopCode]);

  useEffect(() => {
    let active = true;
    const cached = readCachedCatalog(shopCode);
    setState(cached ? { kind: "ready", catalog: cached, source: "cache" } : { kind: "loading" });
    loadCustomerCatalog(shopCode)
      .then((res) => {
        if (!active) return;
        const destination = res.source === "network" ? guestWebsiteRedirect(res.catalog, window.location.href, new URLSearchParams(window.location.search).get("table")) : null;
        if (destination) { window.location.replace(destination); return; }
        if (active) setState({ kind: "ready", catalog: res.catalog, source: res.source });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof CatalogUnavailableError) {
          setState({ kind: "error", unavailable: true, message: err.message });
          return;
        }
        if (!cached) {
          setState({
            kind: "error",
            unavailable: false,
            message: err instanceof Error ? err.message : t("storefront.loadFailed"),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [shopCode]);

  const products = state.kind === "ready" ? state.catalog.products : [];

  const categories = useMemo(() => {
    const byKey = new Map<string, { label: string; product?: CustomerCatalogProduct }>();
    for (const p of products) {
      const label = (p.category ?? "General").trim() || "General";
      const key = label.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { label, product: p });
      if (!byKey.get(key)?.product?.imageUrl && p.imageUrl) byKey.set(key, { label, product: p });
    }
    return [...byKey.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const categoryLabel = (p.category ?? "General").trim() || "General";
      if (category !== "all" && categoryLabel.toLowerCase() !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || categoryLabel.toLowerCase().includes(q);
    });
  }, [products, search, category]);

  const cartItems = useMemo<CartItem[]>(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([productId, q]) => {
        const product = byId.get(productId);
        return product ? { product, qty: q, lineTotal: q * product.price } : null;
      })
      .filter((item): item is CartItem => Boolean(item));
  }, [products, qty]);

  const submitItems = useMemo(
    () => cartItems.map((item) => ({ productId: item.product.id, qty: item.qty })),
    [cartItems],
  );

  const totals = useMemo(() => {
    const count = cartItems.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
    return { count, subtotal, promoDiscount: 0, deliveryCharge: 0, gst: 0, grandTotal: subtotal };
  }, [cartItems]);

  // §13 online session. The catalog carries the real shop id (the URL uses a
  // short shop code), so tracking only starts once the catalog has loaded.
  useOnlineSession(
    state.kind === "ready" ? state.catalog.shop.id : null,
    { itemCount: totals.count, total: totals.grandTotal, productIds: cartItems.map((item) => item.product.id) },
    placed !== null,
  );

  const orderQrUrls = useMemo(() => {
    if (submitItems.length === 0) return [];
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const origin = `${window.location.origin}${base}`;
    return buildOrderQrPayloads(origin, { shopCode, items: submitItems });
  }, [submitItems, shopCode]);

  function setItemQty(id: string, next: number) {
    const value = Math.max(0, Math.round(next * 1000) / 1000);
    // Only the 0 → n transition is an "add to cart"; bumping the quantity of
    // something already in the basket is the same intent, counted once.
    if (value > 0 && (qty[id] ?? 0) === 0) {
      const product = products.find((p) => p.id === id);
      trackEvent(ACTIVITY_EVENTS.ONLINE_CART_ADD, { productId: id, productName: product?.name });
    }
    setQty((prev) => {
      const copy = { ...prev };
      if (value <= 0) delete copy[id];
      else copy[id] = value;
      return copy;
    });
  }

  const mobileOk = /^[6-9]\d{9}$/.test(normalizeMobile(form.mobile));
  const canPlace =
    form.name.trim().length >= 2 &&
    mobileOk &&
    (fulfillment === "pickup" || form.address.trim().length >= 5) &&
    submitItems.length > 0;
  const submitFingerprint = useMemo(
    () =>
      JSON.stringify({
        name: form.name.trim(),
        mobile: normalizeMobile(form.mobile),
        address: form.address.trim(),
        note: form.note.trim(),
        fulfillment,
        timeSlot,
        locationId: state.kind === "ready" ? state.catalog.location.id : null,
        items: submitItems,
      }),
    [form.address, form.mobile, form.name, form.note, fulfillment, state, submitItems, timeSlot],
  );

  async function placeOrder() {
    if (!canPlace || placing) return;
    setPlacing(true);
    setSubmitError(null);
    const idempotencyKey =
      submitAttempt?.fingerprint === submitFingerprint ? submitAttempt.key : newOrderIdempotencyKey(shopCode);
    if (submitAttempt?.key !== idempotencyKey) setSubmitAttempt({ key: idempotencyKey, fingerprint: submitFingerprint });
    try {
      if (state.kind !== "ready") throw new Error(t("storefront.catalogNotReady"));
      const result = await submitCustomerOrder(
        shopCode,
        {
          customerName: form.name.trim(),
          customerMobile: normalizeMobile(form.mobile),
          customerAddress: form.address.trim(),
          note: form.note.trim(),
          locationId: state.catalog.location.id,
          fulfillmentType: fulfillment,
          promisedSlot: timeSlot,
        },
        submitItems,
        idempotencyKey,
      );
      setPlaced(result);
      trackEvent(
        ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED,
        { orderId: result.orderId, itemCount: submitItems.length, fulfillment },
        { durationMs: sessionAgeMs() },
      );
      rememberMyOrder(shopCode, result.orderId);
      setTrackedOrderId(result.orderId);
      setShowTracker(true);
      setSheet("none");
      setQty({});
      setSubmitAttempt(null);
    } catch (err) {
      // The storefront takes no money, so a failure here is the checkout itself
      // failing — which is the drop-off the owner most needs to see.
      trackEvent(ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED, { stage: "submit_order", itemCount: submitItems.length });
      setSubmitError(err instanceof Error ? err.message : t("storefront.placeFailed"));
    } finally {
      setPlacing(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <CenterScreen>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[var(--brand)]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">{t("storefront.loadingShop")}</p>
      </CenterScreen>
    );
  }

  if (state.kind === "error") {
    return (
      <CenterScreen>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff1f2] text-[#e11d48]">
          <Store size={26} />
        </div>
        <h1 className="mt-4 font-display text-lg font-black text-[var(--brand-ink)]">
          {state.unavailable ? "Shop not available" : "Could not load shop"}
        </h1>
        <p className="mt-1 max-w-xs text-center text-sm text-[#5b6b85]">{state.message}</p>
      </CenterScreen>
    );
  }

  if (showTracker && trackedOrderId) {
    return (
      <OrderTracker
        shopCode={shopCode}
        orderId={trackedOrderId}
        justPlaced={Boolean(placed)}
        onBackToMenu={() => {
          setShowTracker(false);
          setPlaced(null);
        }}
        onOrderAgain={() => {
          forgetMyOrder(shopCode);
          setTrackedOrderId(null);
          setShowTracker(false);
          setPlaced(null);
        }}
      />
    );
  }

  const { catalog, source } = state;
  async function changeStoreLocation(locationId: string) {
    if (locationId === catalog.location.id || switchingLocation) return;
    setSwitchingLocation(true);
    setSubmitError(null);
    try {
      const result = await loadCustomerCatalog(shopCode, {}, locationId);
      setQty({});
      setCategory("all");
      setState({ kind: "ready", catalog: result.catalog, source: result.source });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("storefront.switchFailed"));
    } finally {
      setSwitchingLocation(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-[#071432]">
      <div>
        <div className="min-w-0">
          <StorefrontHeader
            catalog={catalog}
            source={source}
            search={search}
            onSearch={setSearch}
            fulfillment={fulfillment}
            onFulfillment={setFulfillment}
            switchingLocation={switchingLocation}
            onLocationChange={(locationId) => void changeStoreLocation(locationId)}
          />
          <CustomerMobileNav activeView={activeView} onView={(view) => view === "orders" && trackedOrderId ? setShowTracker(true) : setActiveView(view)} />

          <main className={`mx-auto w-full max-w-[1380px] px-3 pb-32 pt-3 sm:px-6 sm:pt-5 lg:px-8 lg:pb-10 ${activeView === "shop" ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]" : ""}`}>
            {activeView === "shop" ? (
              <>
                <section className="min-w-0 space-y-4 sm:space-y-5">
                  <StorePromiseStrip source={source} fulfillment={fulfillment} />
                  <CategoryRail categories={categories} active={category} onSelect={setCategory} />

                  <ShopProductsSection
                    products={products}
                    filtered={filtered}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    qty={qty}
                    setItemQty={setItemQty}
                  />

                  <HowOrderingWorks />
                </section>

                <OrderSummaryPanel
                  cartItems={cartItems}
                  totals={totals}
                  form={form}
                  setForm={setForm}
                  mobileOk={mobileOk}
                  canPlace={canPlace}
                  placing={placing}
                  fulfillment={fulfillment}
                  setFulfillment={setFulfillment}
                  timeSlot={timeSlot}
                  setTimeSlot={setTimeSlot}
                  submitError={submitError}
                  onQtyChange={setItemQty}
                  onClear={() => setQty({})}
                  onPlace={() => void placeOrder()}
                  onQr={() => setSheet("qr")}
                />
              </>
            ) : (
              <CustomerPortalPage
                view={activeView}
                catalog={catalog}
                products={products}
                onView={setActiveView}
                onAddProduct={(productId) => setItemQty(productId, (qty[productId] ?? 0) + 1)}
              />
            )}
          </main>
        </div>
      </div>

      {activeView === "shop" && (
        <MobileCartBar
          count={totals.count}
          amount={totals.grandTotal}
          disabled={submitItems.length === 0}
          onOpen={() => {
            setSubmitError(null);
            trackEvent(ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED, { itemCount: submitItems.length });
            setSheet("checkout");
          }}
        />
      )}

      {sheet === "checkout" && (
        <CheckoutSheet
          cartItems={cartItems}
          totals={totals}
          form={form}
          setForm={setForm}
          mobileOk={mobileOk}
          canPlace={canPlace}
          placing={placing}
          fulfillment={fulfillment}
          setFulfillment={setFulfillment}
          timeSlot={timeSlot}
          setTimeSlot={setTimeSlot}
          submitError={submitError}
          onQtyChange={setItemQty}
          onPlace={() => void placeOrder()}
          onQr={() => setSheet("qr")}
          onClose={() => !placing && setSheet("none")}
        />
      )}

      {sheet === "qr" && (
        <OrderQrOverlay urls={orderQrUrls} count={totals.count} amount={totals.subtotal} onClose={() => setSheet("none")} />
      )}
    </div>
  );
}

function StorefrontHeader({
  catalog,
  source,
  search,
  onSearch,
  fulfillment,
  onFulfillment,
  switchingLocation,
  onLocationChange,
}: {
  catalog: CustomerCatalog;
  source: "network" | "cache";
  search: string;
  onSearch: (value: string) => void;
  fulfillment: FulfillmentMode;
  onFulfillment: (value: FulfillmentMode) => void;
  switchingLocation: boolean;
  onLocationChange: (locationId: string) => void;
}) {
  const { t } = useAppLanguage();
  return (
    <header className="sticky top-0 z-30 border-b border-[#e4ecf7] bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1380px] items-center gap-3 px-3 pb-2 pt-3 sm:px-6 lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_12px_30px_rgba(7,95,255,0.24)]">
              <Store size={21} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate font-display text-lg font-black tracking-[-0.03em] text-[#071432] sm:text-xl">
                {catalog.shop.name || "Artha"}
                </h1>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e8f9ee] px-2 py-1 text-[9px] font-black uppercase tracking-wide text-[#0f8f45]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" /> {t("storefront.open")}
                </span>
              </div>
              {catalog.locations.length > 1 ? (
                <select
                  aria-label={t("storefront.orderFromStore")}
                  value={catalog.location.id}
                  disabled={switchingLocation}
                  onChange={(event) => onLocationChange(event.target.value)}
                  className="block max-w-[190px] truncate bg-transparent text-xs font-bold text-[#66758f] outline-none"
                >
                  {catalog.locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.city ? ` · ${location.city}` : ""}</option>)}
                </select>
              ) : <p className="truncate text-xs font-semibold text-[#66758f]">{catalog.location.name}{catalog.location.city ? ` · ${catalog.location.city}` : ""}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1380px] items-center gap-3 px-3 pb-3 pt-1 sm:px-6 lg:px-8 lg:py-3">
        <div className="hidden min-w-0 items-center gap-3 lg:flex">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff7e8] text-[#f59e0b] shadow-[0_12px_30px_rgba(245,158,11,0.16)]">
            <Store size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-xl font-black tracking-[-0.02em] text-[#071432]">{catalog.shop.name}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f9ee] px-2 py-1 text-[11px] font-black text-[var(--success-ink)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" /> {t("storefront.acceptingOrders")}
              </span>
            </div>
            {catalog.locations.length > 1 ? (
              <label className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[#66758f]">
                <span className="sr-only">{t("storefront.orderFromStore")}</span>
                <select
                  aria-label={t("storefront.orderFromStore")}
                  value={catalog.location.id}
                  disabled={switchingLocation}
                  onChange={(event) => onLocationChange(event.target.value)}
                  className="max-w-52 bg-transparent font-bold text-[#52617a] outline-none"
                >
                  {catalog.locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.city ? ` · ${location.city}` : ""}</option>)}
                </select>
                {switchingLocation ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
              </label>
            ) : <p className="mt-0.5 truncate text-xs font-semibold text-[#66758f]">{catalog.location.name}{catalog.location.city ? ` · ${catalog.location.city}` : ""}</p>}
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:ml-auto lg:max-w-[520px]">
          <div className="flex items-center gap-2 rounded-2xl border border-[#dfe8f5] bg-white px-3 shadow-[0_8px_24px_rgba(20,40,90,0.04)]">
            <Search size={18} className="shrink-0 text-[#72819a]" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t("storefront.searchThisStore")}
              aria-label={t("storefront.searchProducts")}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm font-semibold outline-none placeholder:text-[#7d8ba4]"
            />
          </div>
        </div>

        <div className="hidden rounded-2xl border border-[#dfe8f5] bg-[var(--brand-softer)] p-1 md:flex">
          <button
            type="button"
            onClick={() => onFulfillment("delivery")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black ${fulfillment === "delivery" ? "bg-[#eaf2ff] text-[var(--brand)] shadow-sm" : "text-[#52617a]"}`}
          >
            <Truck size={16} /> {t("storefront.delivery")}
          </button>
          <button
            type="button"
            onClick={() => onFulfillment("pickup")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black ${fulfillment === "pickup" ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#52617a]"}`}
          >
            <ShoppingBag size={16} /> {t("storefront.selfPickup")}
          </button>
        </div>

        {source === "cache" && (
          <span className="hidden items-center gap-1 rounded-full bg-[#fff7ed] px-2 py-1 text-[10px] font-bold text-[#c2410c] sm:inline-flex">
            <WifiOff size={11} /> {t("storefront.offline")}
          </span>
        )}
      </div>
    </header>
  );
}

function ShopProductsSection({
  products,
  filtered,
  viewMode,
  setViewMode,
  qty,
  setItemQty,
}: {
  products: CustomerCatalogProduct[];
  filtered: CustomerCatalogProduct[];
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  qty: Record<string, number>;
  setItemQty: (id: string, next: number) => void;
}) {
  const { t } = useAppLanguage();
  return (
    <section className="rounded-[24px] border border-[#e4ecf7] bg-white p-3 shadow-[0_18px_60px_rgba(20,60,120,0.06)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-black tracking-[-0.01em] text-[#081332] sm:text-xl">{t("storefront.shopProducts")}</h2>
          <p className="mt-1 text-xs font-medium text-[#6d7890] sm:text-sm">{t(filtered.length === 1 ? "storefront.availableOne" : "storefront.availableMany", { count: filtered.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 text-xs font-semibold text-[#52617a] sm:flex">
            {t("storefront.sortBy")}
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-[#dfe8f5] bg-white px-3 py-2 font-bold text-[#172544]">
              {t("storefront.popularity")} <ChevronDown size={14} />
            </button>
          </div>
          <div className="flex rounded-xl border border-[#dfe8f5] bg-[var(--brand-softer)] p-1">
            <button
              type="button"
              aria-label={t("storefront.gridView")}
              onClick={() => setViewMode("grid")}
              className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === "grid" ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#70809c]"}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              aria-label={t("storefront.listView")}
              onClick={() => setViewMode("list")}
              className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === "list" ? "bg-white text-[var(--brand)] shadow-sm" : "text-[#70809c]"}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[#d8e3f2] bg-[#f9fbff] py-14 text-center text-sm font-semibold text-[#71809a]">
          {products.length === 0 ? "This shop has no items listed yet." : "No items match your search."}
        </div>
      ) : viewMode === "grid" ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} qty={qty[p.id] ?? 0} onChange={(n) => setItemQty(p.id, n)} />
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {filtered.map((p) => (
            <ProductListRow key={p.id} product={p} qty={qty[p.id] ?? 0} onChange={(n) => setItemQty(p.id, n)} />
          ))}
        </div>
      )}

    </section>
  );
}

// Module scope has no dictionary to read, so these carry keys and whoever
// renders them resolves the word.
const CUSTOMER_NAV: Array<{ view: CustomerStorefrontView; labelKey: TranslationKey; icon: typeof Home; badge?: string; sub?: string }> = [
  { view: "shop", labelKey: "storefront.navShop", icon: Home },
  { view: "orders", labelKey: "storefront.navOrders", icon: ShoppingBag },
];

function CustomerMobileNav({ activeView, onView }: { activeView: CustomerStorefrontView; onView: (view: CustomerStorefrontView) => void }) {
  const { t } = useAppLanguage();
  return (
    <div className="border-b border-[#e4ecf7] bg-white/95 px-3 py-2 lg:hidden">
      <div className="grid grid-cols-2 gap-2">
        {CUSTOMER_NAV.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.view;
          return (
            <button
              type="button"
              key={item.view}
              onClick={() => onView(item.view)}
              className={`inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black shadow-[0_8px_20px_rgba(20,40,90,0.04)] ${active ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[#dfe8f5] bg-white text-[#243653]"}`}
            >
              <Icon size={15} />
              {t(item.labelKey).replace(" & Credits", "")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryRail({
  categories,
  active,
  onSelect,
}: {
  categories: Array<{ key: string; label: string; product?: CustomerCatalogProduct }>;
  active: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useAppLanguage();
  const all = [{ key: "all", label: t("storefront.allCategories") }, ...categories];
  return (
    <nav aria-label={t("storefront.productCategories")} className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-2">
        {all.map((cat) => {
          const selected = active === cat.key;
          return (
            <button
              type="button"
              key={cat.key}
              onClick={() => onSelect(cat.key)}
              aria-current={selected ? "true" : undefined}
              className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border px-3.5 text-xs font-black transition sm:h-12 sm:px-4 ${
                selected
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-[0_10px_24px_rgba(7,95,255,0.2)]"
                  : "border-[#dfe8f5] bg-white text-[#243653] hover:border-[#bcd0f4]"
              }`}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-full text-[9px] ${selected ? "bg-white/15 text-white" : "bg-[#f4f7fc] text-[#405173]"}`}>
                {"product" in cat && cat.product?.imageUrl ? (
                  <img src={cat.product.imageUrl} alt="" className="h-6 w-6 object-contain" />
                ) : cat.key === "all" ? (
                  <LayoutGrid size={14} />
                ) : (
                  cat.label.slice(0, 2).toUpperCase()
                )}
              </span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StorePromiseStrip({ source, fulfillment }: { source: "network" | "cache"; fulfillment: FulfillmentMode }) {
  const { t } = useAppLanguage();
  const promises = [
    { Icon: source === "cache" ? WifiOff : ShieldCheck, label: source === "cache" ? "Saved catalog" : "Live catalog" },
    { Icon: fulfillment === "pickup" ? ShoppingBag : Truck, label: t(fulfillment === "pickup" ? "storefront.storePickup" : "storefront.delivery") },
    { Icon: CheckCircle2, label: t("storefront.storeConfirms") },
  ];
  return (
    <section aria-label={t("storefront.orderingInformation")} className="grid grid-cols-3 divide-x divide-[#e4ecf7] rounded-2xl border border-[#e4ecf7] bg-white px-1 py-3 shadow-[0_8px_28px_rgba(20,60,120,0.04)]">
      {promises.map(({ Icon, label }) => (
        <div key={label} className="flex min-w-0 flex-col items-center gap-1 px-1 text-center sm:flex-row sm:justify-center sm:gap-2">
          <Icon size={16} className={source === "cache" && label === "Saved catalog" ? "text-[#c2410c]" : "text-[var(--brand)]"} />
          <span className="truncate text-[10px] font-black text-[#52617a] sm:text-xs">{label}</span>
        </div>
      ))}
    </section>
  );
}

function ProductCard({ product, qty, onChange }: { product: CustomerCatalogProduct; qty: number; onChange: (next: number) => void }) {
  const { t } = useAppLanguage();
  // §13 ONLINE_PRODUCT_VIEW — counted when the card is genuinely on screen.
  const impressionRef = useOnlineProductImpression(product.id, product.name);
  return (
    <article ref={impressionRef} className="group flex min-w-0 flex-col rounded-2xl border border-[#e3ebf7] bg-white p-2.5 shadow-[0_8px_26px_rgba(20,60,120,0.05)] transition hover:-translate-y-0.5 hover:border-[#cbdcf8] hover:shadow-[0_20px_48px_rgba(20,60,120,0.1)] sm:p-3">
      <div className="relative grid aspect-[1.2/1] place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[var(--brand-softer)] via-white to-[var(--brand-soft)] sm:aspect-square sm:rounded-2xl">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-[76%] w-[76%] object-contain transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="grid place-items-center gap-1 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-[var(--brand)] shadow-[0_12px_30px_rgba(7,95,255,0.12)]">
              <PackageCheck size={24} />
            </span>
            <span className="font-display text-lg font-black text-[#b9c6dc]">{product.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex min-h-[88px] flex-1 flex-col sm:mt-3 sm:min-h-[96px]">
        <h3 className="line-clamp-2 text-[13px] font-black leading-snug text-[#0b1735] sm:text-sm">{product.name}</h3>
        <p className="mt-1 text-xs font-semibold text-[#4f5f7b]">{product.unit}</p>
        <p className="mt-auto pt-1.5 text-sm font-black text-[#071432] sm:text-base">
          {formatRs(product.price)}
          {product.mrp && product.mrp > product.price ? (
            <span className="ml-2 text-xs font-semibold text-[#95a3bb] line-through">{formatRs(product.mrp)}</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--success-ink)]">{t("storefront.available")}</p>
      </div>
      {qty > 0 ? (
        <QuantityStepper qty={qty} onChange={onChange} />
      ) : (
        <button
          type="button"
          onClick={() => onChange(1)}
          aria-label={`Add ${product.name} to order`}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-[var(--brand-border)] bg-[#f8fbff] text-sm font-black text-[var(--brand)] transition hover:bg-[#eaf2ff] sm:mt-3"
        >
          {t("storefront.add")}
        </button>
      )}
    </article>
  );
}

function ProductListRow({ product, qty, onChange }: { product: CustomerCatalogProduct; qty: number; onChange: (next: number) => void }) {
  const { t } = useAppLanguage();
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e3ebf7] bg-white p-3">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand-softer)] to-[var(--brand-soft)]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-14 w-14 object-contain" />
        ) : (
          <PackageCheck size={24} className="text-[var(--brand)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-[#0b1735]">{product.name}</p>
        <p className="text-xs font-semibold text-[#687892]">{product.unit}</p>
        <p className="mt-1 text-sm font-black text-[#071432]">{formatRs(product.price)}</p>
      </div>
      {qty > 0 ? (
        <div className="w-32">
          <QuantityStepper qty={qty} onChange={onChange} compact />
        </div>
      ) : (
        <button type="button" onClick={() => onChange(1)} className="rounded-xl border border-[var(--brand-border)] px-4 py-2 text-sm font-black text-[var(--brand)]">
          {t("storefront.add")}
        </button>
      )}
    </div>
  );
}

function QuantityStepper({ qty, onChange, compact = false }: { qty: number; onChange: (next: number) => void; compact?: boolean }) {
  const { t } = useAppLanguage();
  return (
    <div className={`mt-2 flex items-center overflow-hidden rounded-xl border border-[#d9e4f2] bg-[#f8fbff] sm:mt-3 ${compact ? "mt-0 sm:mt-0" : ""}`}>
      <button type="button" aria-label={t("storefront.decreaseQuantity")} onClick={() => onChange(qty - 1)} className="grid h-11 flex-1 place-items-center text-[var(--brand)]">
        <Minus size={16} />
      </button>
      <span className="grid h-11 min-w-10 place-items-center border-x border-[#d9e4f2] bg-white text-sm font-black tabular-nums">{qty}</span>
      <button type="button" aria-label={t("storefront.increaseQuantity")} onClick={() => onChange(qty + 1)} className="grid h-11 flex-1 place-items-center text-[var(--brand)]">
        <Plus size={16} />
      </button>
    </div>
  );
}

function OrderSummaryPanel({
  cartItems,
  totals,
  form,
  setForm,
  mobileOk,
  canPlace,
  placing,
  fulfillment,
  setFulfillment,
  timeSlot,
  setTimeSlot,
  submitError,
  onQtyChange,
  onClear,
  onPlace,
  onQr,
}: {
  cartItems: CartItem[];
  totals: ReturnType<typeof useOrderTotalsShape>;
  form: { name: string; mobile: string; address: string; note: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; mobile: string; address: string; note: string }>>;
  mobileOk: boolean;
  canPlace: boolean;
  placing: boolean;
  fulfillment: FulfillmentMode;
  setFulfillment: (mode: FulfillmentMode) => void;
  timeSlot: string;
  setTimeSlot: (slot: string) => void;
  submitError: string | null;
  onQtyChange: (id: string, next: number) => void;
  onClear: () => void;
  onPlace: () => void;
  onQr: () => void;
}) {
  const { t } = useAppLanguage();
  return (
    <aside className="sticky top-[92px] hidden max-h-[calc(100vh-112px)] min-h-0 overflow-y-auto rounded-[24px] border border-[#e3ebf7] bg-white p-4 shadow-[0_18px_60px_rgba(20,60,120,0.08)] lg:block">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-black tracking-[-0.01em]">{t("storefront.yourOrder")}</h2>
          <p className="text-xs font-semibold text-[#7a889f]">{t(cartItems.length === 1 ? "storefront.itemOne" : "storefront.itemMany", { count: cartItems.length })}</p>
        </div>
        <button type="button" onClick={onClear} disabled={cartItems.length === 0} className="inline-flex items-center gap-1 text-xs font-black text-[#ef4444] disabled:opacity-40">
          <Trash2 size={14} /> {t("storefront.clearCart")}
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {cartItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dce6f4] bg-[#f8fbff] py-10 text-center text-sm font-semibold text-[#71809a]">
            {t("storefront.addProductsToStartAnOrder")}
          </div>
        ) : (
          cartItems.map((item) => (
            <CartLine key={item.product.id} item={item} onQtyChange={onQtyChange} />
          ))
        )}
      </div>

      <PriceBreakdown totals={totals} />

      <div className="mt-4 rounded-2xl border border-[#e3ebf7] bg-[#fbfdff] p-3">
        <div className="flex rounded-xl border border-[#dfe8f5] bg-white p-1">
          <button
            type="button"
            onClick={() => setFulfillment("delivery")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "delivery" ? "bg-[#eaf2ff] text-[var(--brand)]" : "text-[#52617a]"}`}
          >
            {t("storefront.delivery")}
          </button>
          <button
            type="button"
            onClick={() => setFulfillment("pickup")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "pickup" ? "bg-[#eaf2ff] text-[var(--brand)]" : "text-[#52617a]"}`}
          >
            {t("storefront.selfPickup")}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <CustomerDetailsFields form={form} setForm={setForm} mobileOk={mobileOk} fulfillment={fulfillment} compact />
          <select aria-label={t("storefront.preferredFulfillmentTime")} value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-2.5 text-sm font-bold outline-none">
            {timeSlots.map((slot) => <option key={slot}>{slot}</option>)}
          </select>
        </div>
      </div>

      {submitError && <p className="mt-3 rounded-xl bg-[#fff1f2] px-3 py-2 text-xs font-bold text-[#e11d48]">{submitError}</p>}

      <button
        type="button"
        disabled={!canPlace || placing}
        onClick={onPlace}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] py-4 text-sm font-black text-white shadow-[0_18px_38px_rgba(7,95,255,0.24)] disabled:cursor-not-allowed disabled:bg-[#b8c6dc] disabled:shadow-none"
      >
        {placing ? <><Loader2 size={17} className="animate-spin" /> {t("storefront.placingOrder")}</> : <>Place Order <ChevronRight size={17} /></>}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onQr} disabled={cartItems.length === 0} className="rounded-xl border border-[#d8f5e2] bg-[#f1fbf5] py-2.5 text-xs font-black text-[var(--success-ink)] disabled:opacity-40">{t("storefront.qrFallback")}</button>
        <button type="button" onClick={onClear} disabled={cartItems.length === 0} className="rounded-xl border border-[#ffd6d6] bg-[#fff7f7] py-2.5 text-xs font-black text-[#ef4444] disabled:opacity-40">{t("storefront.clearCart2")}</button>
      </div>
    </aside>
  );
}

function useOrderTotalsShape() {
  return { count: 0, subtotal: 0, promoDiscount: 0, deliveryCharge: 0, gst: 0, grandTotal: 0 };
}

function CartLine({ item, onQtyChange }: { item: CartItem; onQtyChange: (id: string, next: number) => void }) {
  const { t } = useAppLanguage();
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[#edf2f8] bg-white p-2">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--brand-softer)]">
        {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-11 w-11 object-contain" /> : <ShoppingBag size={18} className="text-[#9ca9bd]" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-[var(--brand-ink)]">{item.product.name}</p>
        <p className="text-xs font-bold text-[#61718c]">{formatRs(item.product.price)}</p>
        <div className="mt-1 flex w-24 items-center overflow-hidden rounded-lg border border-[#d9e4f2]">
          <button type="button" aria-label={`Decrease ${item.product.name} quantity`} onClick={() => onQtyChange(item.product.id, item.qty - 1)} className="grid h-8 flex-1 place-items-center text-[var(--brand)]"><Minus size={13} /></button>
          <span className="grid h-7 w-8 place-items-center border-x border-[#d9e4f2] text-xs font-black">{item.qty}</span>
          <button type="button" aria-label={`Increase ${item.product.name} quantity`} onClick={() => onQtyChange(item.product.id, item.qty + 1)} className="grid h-8 flex-1 place-items-center text-[var(--brand)]"><Plus size={13} /></button>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-black text-[var(--brand-ink)]">{formatRs(item.lineTotal)}</p>
        <button type="button" aria-label={`Remove ${item.product.name}`} onClick={() => onQtyChange(item.product.id, 0)} className="mt-1 grid h-8 w-8 place-items-center rounded-lg text-[#71809a] hover:bg-[#f1f5f9]"><X size={15} /></button>
      </div>
    </div>
  );
}

function PriceBreakdown({ totals }: { totals: ReturnType<typeof useOrderTotalsShape> }) {
  const { t } = useAppLanguage();
  return (
    <div className="mt-4 space-y-2 border-t border-[#edf2f8] pt-4 text-sm">
      <Row label={t("storefront.subtotal")} value={formatRs(totals.subtotal)} />
      <div className="mt-3 flex items-center justify-between border-t border-[#edf2f8] pt-3">
        <span className="text-base font-black">{t("storefront.estimatedItemTotal")}</span>
        <span className="font-display text-2xl font-black text-[var(--brand)]">{formatRs(totals.grandTotal)}</span>
      </div>
      <p className="text-[11px] font-semibold leading-4 text-[#71809a]">{t("storefront.theStoreConfirmsTaxesDeliveryCharges")}</p>
    </div>
  );
}

function Row({ label, value, valueClass = "text-[var(--brand-ink)]" }: { label: string; value: string; valueClass?: string }) {
  const { t } = useAppLanguage();
  return (
    <div className="flex items-center justify-between">
      <span className="font-semibold text-[#60708b]">{label}</span>
      <span className={`font-black ${valueClass}`}>{value}</span>
    </div>
  );
}

function CustomerDetailsFields({
  form,
  setForm,
  mobileOk,
  fulfillment,
  compact = false,
}: {
  form: { name: string; mobile: string; address: string; note: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; mobile: string; address: string; note: string }>>;
  mobileOk: boolean;
  fulfillment: FulfillmentMode;
  compact?: boolean;
}) {
  const { t } = useAppLanguage();
  const input = "mt-1 w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-3 text-sm font-semibold outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[#eaf2ff]";
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <label className="block text-xs font-black text-[#405173]">
        {t("storefront.name")}
        <input autoComplete="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("storefront.yourFullName")} className={input} />
      </label>
      <label className="block text-xs font-black text-[#405173]">
        {t("storefront.mobileNumber")}
        <input autoComplete="tel" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} inputMode="numeric" maxLength={10} placeholder={t("storefront.10DigitMobileNumber")} className={input} aria-describedby="mobile-help" />
        {form.mobile && !mobileOk ? <p className="mt-1 text-[11px] font-bold text-[#e11d48]">{t("storefront.enterAValid10DigitMobile")}</p> : null}
        <span id="mobile-help" className="mt-1 block text-[10px] font-semibold text-[#7b89a0]">{t("storefront.usedOnlyForThisOrderAnd")}</span>
      </label>
      {fulfillment === "delivery" ? (
        <label className="block text-xs font-black text-[#405173]">
          {t("storefront.deliveryAddress")}
          <textarea autoComplete="street-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={compact ? 2 : 3} placeholder={t("storefront.houseStreetAreaAndLandmark")} className={`${input} resize-none`} />
        </label>
      ) : null}
      <label className="block text-xs font-black text-[#405173]">
        {t("storefront.note")} <span className="font-semibold text-[#8290a8]">{t("storefront.optional")}</span>
        <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder={t("storefront.substitutionsPackagingOrDirections")} className={input} />
      </label>
    </div>
  );
}

function MobileCartBar({ count, amount, disabled, onOpen }: { count: number; amount: number; disabled: boolean; onOpen: () => void }) {
  const { t } = useAppLanguage();
  if (disabled) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dce6f4] bg-white/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <button type="button" onClick={onOpen} className="mx-auto flex min-h-14 w-full max-w-xl items-center gap-3 rounded-2xl bg-[var(--brand)] px-4 py-2.5 text-white shadow-[0_18px_42px_rgba(7,95,255,0.28)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
          <ShoppingBag size={19} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-xs font-bold opacity-90">{t(count === 1 ? "storefront.itemOne" : "storefront.itemMany", { count })} · {formatRs(amount)}</span>
          <span className="block text-[11px] font-semibold opacity-80">{t("storefront.estimatedItemTotal")}</span>
        </span>
        <span className="text-sm font-black">{t("storefront.reviewOrder")}</span>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function CheckoutSheet({
  cartItems,
  totals,
  form,
  setForm,
  mobileOk,
  canPlace,
  placing,
  fulfillment,
  setFulfillment,
  timeSlot,
  setTimeSlot,
  submitError,
  onQtyChange,
  onPlace,
  onQr,
  onClose,
}: {
  cartItems: CartItem[];
  totals: ReturnType<typeof useOrderTotalsShape>;
  form: { name: string; mobile: string; address: string; note: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; mobile: string; address: string; note: string }>>;
  mobileOk: boolean;
  canPlace: boolean;
  placing: boolean;
  fulfillment: FulfillmentMode;
  setFulfillment: (mode: FulfillmentMode) => void;
  timeSlot: string;
  setTimeSlot: (slot: string) => void;
  submitError: string | null;
  onQtyChange: (id: string, next: number) => void;
  onPlace: () => void;
  onQr: () => void;
  onClose: () => void;
}) {
  const { t } = useAppLanguage();
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#0b1424]/60 backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" className="flex h-[96dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-[#f7f9fc] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e4ecf7] bg-white px-4 py-4 sm:px-5">
          <div>
            <h2 id="checkout-title" className="font-display text-xl font-black text-[var(--brand-ink)]">{t("storefront.reviewYourOrder")}</h2>
            <p className="text-xs font-semibold text-[#6b7a93]">{t("storefront.theStoreVerifiesAvailabilityAndFinal")}</p>
          </div>
          <button type="button" aria-label={t("storefront.closeCheckout")} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5fb]"><X size={19} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <section className="rounded-2xl border border-[#e3ebf7] bg-white p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-[var(--brand-ink)]">{t("storefront.1Items")}</h3>
              <span className="text-xs font-bold text-[#6b7a93]">{t("storefront.totalCount", { count: totals.count })}</span>
            </div>
            <div className="space-y-2">
              {cartItems.map((item) => <CartLine key={item.product.id} item={item} onQtyChange={onQtyChange} />)}
            </div>
            <PriceBreakdown totals={totals} />
          </section>

          <section className="rounded-2xl border border-[#e3ebf7] bg-white p-3.5">
            <h3 className="text-sm font-black text-[var(--brand-ink)]">{t("storefront.2Fulfillment")}</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFulfillment("delivery")} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black ${fulfillment === "delivery" ? "border-[var(--brand)] bg-[#eaf2ff] text-[var(--brand)]" : "border-[#dfe8f5] text-[#52617a]"}`}><Truck size={16} /> {t("storefront.delivery")}</button>
              <button type="button" onClick={() => setFulfillment("pickup")} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black ${fulfillment === "pickup" ? "border-[var(--brand)] bg-[#eaf2ff] text-[var(--brand)]" : "border-[#dfe8f5] text-[#52617a]"}`}><ShoppingBag size={16} /> {t("storefront.storePickup")}</button>
            </div>
            <label className="mt-3 block text-xs font-black text-[#405173]">
              {t("storefront.preferredTime")}
              <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="mt-1 w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-3 text-sm font-bold outline-none focus:border-[var(--brand)]">
                {timeSlots.map((slot) => <option key={slot}>{slot}</option>)}
              </select>
            </label>
          </section>

          <section className="rounded-2xl border border-[#e3ebf7] bg-white p-3.5">
            <h3 className="mb-3 text-sm font-black text-[var(--brand-ink)]">{t("storefront.3ContactDetails")}</h3>
            <CustomerDetailsFields form={form} setForm={setForm} mobileOk={mobileOk} fulfillment={fulfillment} />
          </section>

          {submitError && (
            <div role="alert" className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] px-3 py-2.5 text-[12px] font-semibold text-[#be123c]">
              {submitError}
              <button type="button" onClick={onQr} className="ml-1 font-black underline">{t("storefront.showCounterQrInstead")}</button>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4ecf7] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-5">
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-[#f4f8ff] px-3 py-2 text-[11px] font-semibold leading-4 text-[#52617a]">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--brand)]" />
            <span>{t("storefront.noPaymentIsTakenNowThe")}</span>
          </div>
          <button type="button" disabled={!canPlace || placing} onClick={onPlace} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-4 text-sm font-black text-white shadow-[0_16px_32px_rgba(7,95,255,0.22)] disabled:cursor-not-allowed disabled:bg-[#b8c6dc] disabled:shadow-none">
            {placing ? <><Loader2 size={17} className="animate-spin" /> {t("storefront.sendingOrder")}</> : <><Send size={17} /> {t("storefront.placeOrder", { total: formatRs(totals.grandTotal) })}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function HowOrderingWorks() {
  const { t } = useAppLanguage();
  const steps = [
    ["1", "Browse Items", "Explore products by category"],
    ["2", "Add to Cart", "Adjust quantity and review"],
    ["3", "Choose Delivery", "Confirm address and pickup option"],
    ["4", "Place Order", "Shop receives your order"],
    ["5", "Get Confirmation", "Track preparation status"],
  ];
  return (
    <section className="hidden rounded-[24px] border border-[#e4ecf7] bg-white p-5 shadow-[0_18px_60px_rgba(20,60,120,0.05)] lg:block">
      <h2 className="font-display text-lg font-black text-[#081332]">{t("storefront.howOrderingWorks")}</h2>
      <div className="mt-4 grid grid-cols-5 gap-3">
        {steps.map(([num, title, body], idx) => (
          <div key={num} className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eaf2ff] text-sm font-black text-[var(--brand)]">{num}</span>
            <div className="min-w-0">
              <p className="text-xs font-black text-[var(--brand-ink)]">{title}</p>
              <p className="text-[11px] font-semibold text-[#70809a]">{body}</p>
            </div>
            {idx < steps.length - 1 && <ChevronRight size={16} className="ml-auto text-[#9ba8bd]" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomerPortalPage({
  view,
  products,
  onView,
}: {
  view: CustomerStorefrontView;
  catalog: CustomerCatalog;
  products: CustomerCatalogProduct[];
  onView: (view: CustomerStorefrontView) => void;
  onAddProduct: (productId: string) => void;
}) {
  const { t } = useAppLanguage();
  // Only real, server-backed customer views are exposed. Historical visual mockups for wallet,
  // saved payments, offers and support are intentionally not routed until matching APIs exist.
  return <OrdersPortalPage products={products.slice(0, 6)} onView={onView} />;
}

function OrdersPortalPage({ onView }: { products: CustomerCatalogProduct[]; onView: (view: CustomerStorefrontView) => void }) {
  const { t } = useAppLanguage();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#eaf2ff] text-[var(--brand)]"><ShoppingBag size={28} /></span>
      <h1 className="mt-5 font-display text-2xl font-black text-[#071432]">{t("storefront.noOrderToTrackYet")}</h1>
      <p className="mt-2 text-sm font-semibold text-[#66758f]">{t("storefront.yourLatestOrderWillAppearHere")}</p>
      <button type="button" onClick={() => onView("shop")} className="mt-6 rounded-xl bg-[var(--brand)] px-6 py-3 text-sm font-black text-white">{t("storefront.startAnOrder")}</button>
    </div>
  );
}

function OrderQrOverlay({ urls, count, amount, onClose }: { urls: string[]; count: number; amount: number; onClose: () => void }) {
  const { t } = useAppLanguage();
  const [part, setPart] = useState(0);
  const total = urls.length;
  const multi = total > 1;
  const safePart = Math.min(part, Math.max(0, total - 1));
  const current = urls[safePart] ?? "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b1424]/70 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold text-white">
        <ArrowLeft size={16} /> {t("storefront.back")}
      </button>
      <div className="m-auto w-[min(92vw,380px)] rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-bold text-[var(--brand)]">
          <ShoppingBag size={14} /> {t(count === 1 ? "storefront.itemOne" : "storefront.itemMany", { count })} - {formatRs(amount)}
        </div>
        <div className="mx-auto grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
          <QrCodeView value={current} level="L" size={272} title={multi ? t("storefront.qrPartTitle", { part: safePart + 1, total }) : t("storefront.qrTitle")} />
        </div>
        {multi ? (
          <>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button type="button" disabled={safePart === 0} onClick={() => setPart((p) => Math.max(0, p - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[var(--brand)] disabled:opacity-40" aria-label={t("storefront.previousQr")}>
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-[92px] text-[13px] font-black text-[var(--brand-ink)]">{t("storefront.qrPart", { part: safePart + 1, total })}</span>
              <button type="button" disabled={safePart === total - 1} onClick={() => setPart((p) => Math.min(total - 1, p + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[var(--brand)] disabled:opacity-40" aria-label={t("storefront.nextQr")}>
                <ChevronRight size={18} />
              </button>
            </div>
            <h2 className="mt-3 font-display text-base font-black text-[var(--brand-ink)]">{t("storefront.bigOrderQrs", { total })}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">{t("storefront.theShopkeeperScansEachPartIn")}</p>
          </>
        ) : (
          <>
            <h2 className="mt-4 font-display text-base font-black text-[var(--brand-ink)]">{t("storefront.showThisAtTheCounter")}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">{t("storefront.theShopkeeperScansItToLoad")}</p>
          </>
        )}
      </div>
    </div>
  );
}

const STAGE_STEPS: Array<{ key: OrderStage; labelKey: TranslationKey; subKey: TranslationKey; Icon: typeof Clock }> = [
  { key: "received", labelKey: "storefront.stageReceived", subKey: "storefront.stageReceivedSub", Icon: Clock },
  { key: "preparing", labelKey: "storefront.stagePreparing", subKey: "storefront.stagePreparingSub", Icon: ChefHat },
  { key: "ready", labelKey: "storefront.stageReady", subKey: "storefront.stageReadySub", Icon: PackageCheck },
];

function orderTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function OrderTracker({
  shopCode,
  orderId,
  justPlaced,
  onBackToMenu,
  onOrderAgain,
}: {
  shopCode: string;
  orderId: string;
  justPlaced: boolean;
  onBackToMenu: () => void;
  onOrderAgain: () => void;
}) {
  const { t } = useAppLanguage();
  const [status, setStatus] = useState<CustomerOrderStatus | null>(null);
  const [gone, setGone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const next = await fetchOrderStatus(shopCode, orderId);
        setStatus(next);
        setGone(false);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          forgetMyOrder(shopCode);
          setGone(true);
        }
      } finally {
        setLoading(false);
        if (manual) setRefreshing(false);
      }
    },
    [shopCode, orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const stage = status?.stage;
  const terminal = gone || stage === "ready" || stage === "declined";

  useEffect(() => {
    if (terminal) return;
    const id = window.setInterval(() => void load(), 12000);
    return () => window.clearInterval(id);
  }, [terminal, load]);

  if (loading && !status && !gone) {
    return (
      <CenterScreen>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[var(--brand)]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">{t("storefront.loadingYourOrder")}</p>
      </CenterScreen>
    );
  }

  if (gone) {
    return (
      <CenterScreen>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f1f5f9] text-[#64748b]">
          <ShoppingBag size={26} />
        </div>
        <h1 className="mt-4 font-display text-lg font-black text-[var(--brand-ink)]">{t("storefront.orderNotFound")}</h1>
        <p className="mt-1 max-w-xs text-center text-sm text-[#5b6b85]">{t("storefront.thisOrderIsNoLongerAvailable")}</p>
        <button type="button" onClick={onOrderAgain} className="mt-6 rounded-xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white">{t("storefront.backToMenu")}</button>
      </CenterScreen>
    );
  }

  const declined = stage === "declined";
  const currentIndex = declined ? -1 : STAGE_STEPS.findIndex((s) => s.key === stage);

  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[var(--brand-ink)]">
      <header className="sticky top-0 z-20 border-b border-[#e4ecf7] bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <button type="button" onClick={onBackToMenu} aria-label={t("storefront.backToMenu")} className="grid h-9 w-9 place-items-center rounded-lg text-[#405273] hover:bg-[#f1f5fb]">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-black leading-tight">{status?.shopName ?? t("storefront.yourOrder2")}</h1>
            <p className="truncate text-[11px] font-semibold text-[#6b7a93]">{t("storefront.orderTracking")}</p>
          </div>
          <button type="button" onClick={() => void load(true)} aria-label={t("storefront.refresh")} className="grid h-9 w-9 place-items-center rounded-lg border border-[#dfe7f2] text-[#405273] hover:bg-[var(--brand-softer)]">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-5">
        {justPlaced && !declined && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-[#e9fbf0] px-4 py-3 text-[var(--success-ink)]">
            <CheckCircle2 size={20} />
            <p className="text-[13px] font-bold">{t("storefront.orderSentTheShopHasBeen")}</p>
          </div>
        )}

        {declined ? (
          <div className="rounded-2xl border border-[#f4d4d4] bg-[#fff5f5] p-5 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#e11d48]"><XCircle size={28} /></div>
            <h2 className="mt-3 font-display text-lg font-black text-[var(--brand-ink)]">{t("storefront.orderCouldNotBeTaken")}</h2>
            <p className="mt-1 text-[13px] text-[#5b6b85]">{t("storefront.theShopDeclinedThisOrderPlease")}</p>
          </div>
        ) : (
          <ol className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
            {STAGE_STEPS.map((step, i) => {
              const done = i < currentIndex;
              const active = i === currentIndex;
              const StepIcon = step.Icon;
              return (
                <li key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${done ? "bg-[#16a34a] text-white" : active ? "bg-[var(--brand)] text-white" : "bg-[#eef2f8] text-[#9aa7bd]"}`}>
                      {done ? <CheckCircle2 size={18} /> : <StepIcon size={17} />}
                    </span>
                    {i < STAGE_STEPS.length - 1 && <span className={`my-1 w-0.5 flex-1 ${i < currentIndex ? "bg-[#16a34a]" : "bg-[#e6ecf4]"}`} />}
                  </div>
                  <div className={i === STAGE_STEPS.length - 1 ? "pb-0" : "pb-6"}>
                    <p className={`text-[14px] font-black ${active || done ? "text-[var(--brand-ink)]" : "text-[#9aa7bd]"}`}>{t(step.labelKey)}</p>
                    <p className="mt-0.5 text-[12px] font-medium text-[#6b7a93]">{step.key === "ready" && status?.fulfillmentType === "delivery" ? t("storefront.readyForHandover") : t(step.subKey)}</p>
                    {active && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--brand)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand)]" /> {t("storefront.now")}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {status && (
          <div className="mt-4 rounded-2xl border border-[#e6ecf4] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-black text-[var(--brand-ink)]">{t("storefront.yourOrder2")}</p>
              <p className="text-[11px] font-semibold text-[#8290a8]">{orderTimeAgo(status.createdAt)}</p>
            </div>
            <div className="mt-2 space-y-1">
              {status.items.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-[13px]">
                  <span className="min-w-0 truncate text-[#334364]"><span className="font-bold">{it.qty}x</span> {it.name}</span>
                  <span className="shrink-0 font-semibold text-[#64748b]">{formatRs(it.qty * it.price)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 rounded-xl bg-[var(--brand-softer)] p-3 text-[12px] text-[#52617a] sm:grid-cols-2">
              <p><span className="font-black text-[var(--brand-ink)]">{t("storefront.method")}</span> {t(status.fulfillmentType === "pickup" ? "storefront.storePickup" : "storefront.delivery")}</p>
              {status.promisedSlot ? <p><span className="font-black text-[var(--brand-ink)]">{t("storefront.preferred")}</span> {status.promisedSlot}</p> : null}
              {status.location ? <p className="sm:col-span-2"><span className="font-black text-[var(--brand-ink)]">{t("storefront.store")}</span> {status.location.name}{status.location.city ? ` · ${status.location.city}` : ""}</p> : null}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[#eef2f8] pt-2 text-[14px] font-black text-[var(--brand-ink)]">
              <span>{t("storefront.estimatedTotal")}</span><span>{formatRs(status.estimatedTotal)}</span>
            </div>
            <p className="mt-1 text-[11px] text-[#8290a8]">{t("storefront.finalPriceIsSetByThe")}</p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onBackToMenu} className="flex-1 rounded-xl border border-[#dce5f1] py-3 text-sm font-bold text-[#405273]">{t("storefront.backToMenu")}</button>
          <button type="button" onClick={onOrderAgain} className="flex-1 rounded-xl bg-[var(--brand)] py-3 text-sm font-bold text-white">{t("storefront.orderAgain")}</button>
        </div>
      </main>
    </div>
  );
}

function CenterScreen({ children }: { children: ReactNode }) {
  const { t } = useAppLanguage();
  return <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f8fd] px-6">{children}</div>;
}
