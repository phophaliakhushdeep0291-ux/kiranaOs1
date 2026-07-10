import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "wouter";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Home,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
  User,
  WalletCards,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { buildOrderQrPayloads } from "@/lib/qr/cart-codec";
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
const timeSlots = ["Today, 6:00 PM - 8:00 PM", "Today, 8:00 PM - 10:00 PM", "Tomorrow, 9:00 AM - 11:00 AM"];

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

interface CartItem {
  product: CustomerCatalogProduct;
  qty: number;
  lineTotal: number;
}

export default function CustomerOrderPage() {
  const params = useParams<{ shopCode: string }>();
  const shopCode = params.shopCode ?? "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
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
            message: err instanceof Error ? err.message : "Something went wrong loading this shop.",
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
    const promoDiscount = subtotal >= 500 ? 20 : 0;
    const deliveryCharge = subtotal <= 0 || fulfillment === "pickup" || subtotal >= 500 ? 0 : 30;
    const taxable = Math.max(0, subtotal - promoDiscount + deliveryCharge);
    const gst = Math.round(taxable * 5) / 100;
    const grandTotal = taxable + gst;
    return { count, subtotal, promoDiscount, deliveryCharge, gst, grandTotal };
  }, [cartItems, fulfillment]);

  const orderQrUrls = useMemo(() => {
    if (submitItems.length === 0) return [];
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const origin = `${window.location.origin}${base}`;
    return buildOrderQrPayloads(origin, { shopCode, items: submitItems });
  }, [submitItems, shopCode]);

  function setItemQty(id: string, next: number) {
    setQty((prev) => {
      const value = Math.max(0, Math.round(next * 1000) / 1000);
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
    form.address.trim().length >= 5 &&
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
        items: submitItems,
      }),
    [form.address, form.mobile, form.name, form.note, fulfillment, submitItems, timeSlot],
  );

  async function placeOrder() {
    if (!canPlace || placing) return;
    setPlacing(true);
    setSubmitError(null);
    const idempotencyKey =
      submitAttempt?.fingerprint === submitFingerprint ? submitAttempt.key : newOrderIdempotencyKey(shopCode);
    if (submitAttempt?.key !== idempotencyKey) setSubmitAttempt({ key: idempotencyKey, fingerprint: submitFingerprint });
    try {
      const noteParts = [
        form.note.trim(),
        `Order mode: ${fulfillment === "delivery" ? "Delivery" : "Self pickup"}`,
        `Preferred slot: ${timeSlot}`,
      ].filter(Boolean);
      const result = await submitCustomerOrder(
        shopCode,
        {
          customerName: form.name.trim(),
          customerMobile: normalizeMobile(form.mobile),
          customerAddress: form.address.trim(),
          note: noteParts.join(" | "),
        },
        submitItems,
        idempotencyKey,
      );
      setPlaced(result);
      rememberMyOrder(shopCode, result.orderId);
      setTrackedOrderId(result.orderId);
      setShowTracker(true);
      setSheet("none");
      setQty({});
      setSubmitAttempt(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not place the order.");
    } finally {
      setPlacing(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <CenterScreen>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[#075fff]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">Loading shop...</p>
      </CenterScreen>
    );
  }

  if (state.kind === "error") {
    return (
      <CenterScreen>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff1f2] text-[#e11d48]">
          <Store size={26} />
        </div>
        <h1 className="mt-4 font-display text-lg font-black text-[#102347]">
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
  const shopLocation = catalog.shop.city ? `${catalog.shop.city}, India` : "Local store";
  const deliveryShortfall = Math.max(0, 500 - totals.subtotal);

  return (
    <div className="min-h-screen bg-[#f7faff] text-[#071432] lg:bg-[#f4f8ff]">
      <div className="lg:flex">
        <CustomerSidebar
          shopName={catalog.shop.name}
          shopLocation={shopLocation}
          trackedOrderId={trackedOrderId}
          onTrack={() => setShowTracker(true)}
        />

        <div className="min-w-0 flex-1 lg:pl-[264px] xl:pl-[280px]">
          <StorefrontHeader
            catalog={catalog}
            source={source}
            search={search}
            onSearch={setSearch}
            fulfillment={fulfillment}
            onFulfillment={setFulfillment}
          />

          <main className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 pb-32 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8 lg:pb-8 2xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="min-w-0 space-y-5">
              <CategoryRail categories={categories} active={category} onSelect={setCategory} />

              <div className="grid gap-3 md:grid-cols-3">
                <PromoCard tone="green" title="Free delivery above Rs 500" body={deliveryShortfall > 0 ? `Shop for ${formatRs(deliveryShortfall)} more to get free delivery` : "Your order gets free delivery"} />
                <PromoCard tone="blue" title="Express delivery in 60 mins" body="Fresh items from the store to your doorstep" />
                <PromoCard tone="orange" title="Pickup in 20 mins" body="Order online and pick up from store" />
              </div>

              <section className="rounded-[24px] border border-[#e4ecf7] bg-white p-4 shadow-[0_18px_60px_rgba(20,60,120,0.06)] sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-xl font-black tracking-[-0.01em] text-[#081332]">Popular Products</h2>
                    <p className="mt-1 text-sm font-medium text-[#6d7890]">Select items and send your order directly to the shop.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="hidden items-center gap-2 text-xs font-semibold text-[#52617a] sm:flex">
                      Sort by:
                      <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-[#dfe8f5] bg-white px-3 py-2 font-bold text-[#172544]">
                        Popularity <ChevronDown size={14} />
                      </button>
                    </div>
                    <div className="flex rounded-xl border border-[#dfe8f5] bg-[#f7faff] p-1">
                      <button
                        type="button"
                        aria-label="Grid view"
                        onClick={() => setViewMode("grid")}
                        className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === "grid" ? "bg-white text-[#075fff] shadow-sm" : "text-[#70809c]"}`}
                      >
                        <LayoutGrid size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="List view"
                        onClick={() => setViewMode("list")}
                        className={`grid h-8 w-8 place-items-center rounded-lg ${viewMode === "list" ? "bg-white text-[#075fff] shadow-sm" : "text-[#70809c]"}`}
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
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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

                {filtered.length > 8 && (
                  <button type="button" className="mx-auto mt-5 flex items-center gap-2 rounded-xl border border-[#dbe6f5] bg-white px-6 py-3 text-sm font-black text-[#075fff]">
                    View More Products <ChevronRight size={16} />
                  </button>
                )}
              </section>

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
          </main>
        </div>
      </div>

      <MobileCartBar
        count={totals.count}
        amount={totals.grandTotal}
        disabled={submitItems.length === 0}
        onOpen={() => {
          setSubmitError(null);
          setSheet("checkout");
        }}
      />

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
}: {
  catalog: CustomerCatalog;
  source: "network" | "cache";
  search: string;
  onSearch: (value: string) => void;
  fulfillment: FulfillmentMode;
  onFulfillment: (value: FulfillmentMode) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#e4ecf7] bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 pb-2 pt-4 sm:px-6 lg:hidden">
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dce6f4] bg-white text-[#075fff] shadow-[0_8px_24px_rgba(20,40,90,0.06)]">
          <Menu size={21} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#075fff] text-white shadow-[0_12px_30px_rgba(7,95,255,0.26)]">
              <ShoppingCart size={21} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-2xl font-black tracking-[-0.03em] text-[#071432]">
                {catalog.shop.name || "KiranaOS"}
              </h1>
              <p className="truncate text-xs font-semibold text-[#66758f]">{catalog.shop.city || "Smart POS for Modern Stores"}</p>
            </div>
          </div>
        </div>
        <button type="button" className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dfe8f5] bg-white text-[#0d1a3a] shadow-[0_8px_24px_rgba(20,40,90,0.04)]">
          <Bell size={19} />
          <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#075fff] text-[10px] font-black text-white">7</span>
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 pb-3 pt-1 sm:px-6 lg:px-8 lg:py-3">
        <button type="button" className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dce6f4] bg-white text-[#405173] shadow-[0_8px_24px_rgba(20,40,90,0.06)] lg:hidden">
          <Menu size={21} />
        </button>
        <div className="hidden min-w-0 items-center gap-3 lg:flex">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff7e8] text-[#f59e0b] shadow-[0_12px_30px_rgba(245,158,11,0.16)]">
            <Store size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-xl font-black tracking-[-0.02em] text-[#071432]">{catalog.shop.name}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f9ee] px-2 py-1 text-[11px] font-black text-[#0f9f4a]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" /> Open
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-[#66758f]">{catalog.shop.city || "Local store"} - 4.8 (512)</p>
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:max-w-[520px]">
          <div className="flex items-center gap-2 rounded-2xl border border-[#dfe8f5] bg-white px-3 shadow-[0_8px_24px_rgba(20,40,90,0.04)]">
            <Search size={18} className="shrink-0 text-[#72819a]" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search for atta, dal, oil, biscuits..."
              className="min-w-0 flex-1 bg-transparent py-3 text-sm font-semibold outline-none placeholder:text-[#7d8ba4]"
            />
            <span className="hidden rounded-md border border-[#d7e1ef] px-2 py-0.5 text-[10px] font-black text-[#52617a] sm:inline">Ctrl K</span>
          </div>
        </div>

        <div className="hidden rounded-2xl border border-[#dfe8f5] bg-[#f7faff] p-1 md:flex">
          <button
            type="button"
            onClick={() => onFulfillment("delivery")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black ${fulfillment === "delivery" ? "bg-[#eaf2ff] text-[#075fff] shadow-sm" : "text-[#52617a]"}`}
          >
            <Truck size={16} /> Delivery
          </button>
          <button
            type="button"
            onClick={() => onFulfillment("pickup")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black ${fulfillment === "pickup" ? "bg-white text-[#075fff] shadow-sm" : "text-[#52617a]"}`}
          >
            <ShoppingBag size={16} /> Self Pickup
          </button>
        </div>

        <div className="hidden items-center gap-2 rounded-2xl border border-[#dfe8f5] bg-white px-3 py-2 shadow-[0_8px_24px_rgba(20,40,90,0.04)] md:flex">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#eaf2ff] text-sm font-black text-[#075fff]">RS</span>
          <div>
            <p className="text-xs font-black text-[#14213d]">Customer</p>
            <p className="text-[11px] font-semibold text-[#7d8ba4]">Guest order</p>
          </div>
          <ChevronDown size={15} className="text-[#73819a]" />
        </div>

        <button type="button" className="relative hidden h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#dfe8f5] bg-white text-[#0d1a3a] shadow-[0_8px_24px_rgba(20,40,90,0.04)] lg:grid">
          <Bell size={19} />
          <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#075fff] text-[10px] font-black text-white">7</span>
        </button>
        {source === "cache" && (
          <span className="hidden items-center gap-1 rounded-full bg-[#fff7ed] px-2 py-1 text-[10px] font-bold text-[#c2410c] sm:inline-flex">
            <WifiOff size={11} /> Offline
          </span>
        )}
      </div>
    </header>
  );
}

function CustomerSidebar({
  shopName,
  shopLocation,
  trackedOrderId,
  onTrack,
}: {
  shopName: string;
  shopLocation: string;
  trackedOrderId: string | null;
  onTrack: () => void;
}) {
  const nav = [
    { label: "Shop Now", icon: Home, active: true },
    { label: "My Orders", icon: ShoppingBag, onClick: trackedOrderId ? onTrack : undefined },
    { label: "My Lists", icon: Heart, badge: "3" },
    { label: "Wallet & Credits", icon: WalletCards, sub: "Rs 250.00" },
    { label: "Addresses", icon: MapPin },
    { label: "Payments", icon: WalletCards },
    { label: "Help & Support", icon: Bell },
  ];
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col overflow-y-auto bg-[#061a39] px-4 py-6 text-white lg:flex xl:w-[280px]">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#075fff] text-white shadow-[0_16px_36px_rgba(7,95,255,0.35)]">
          <ShoppingCart size={25} />
        </div>
        <div>
          <p className="font-display text-2xl font-black tracking-[-0.03em]">Kirana<span className="text-[#0b77ff]">OS</span></p>
          <p className="text-[11px] font-semibold text-[#b5c4df]">Smart POS for Modern Stores</p>
        </div>
      </div>

      <nav className="mt-8 space-y-2">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.label}
              onClick={item.onClick}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black transition ${item.active ? "bg-[#075fff] text-white shadow-[0_12px_30px_rgba(7,95,255,0.32)]" : "text-[#dbe7fb] hover:bg-white/8"}`}
            >
              <Icon size={19} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.badge ? <span className="rounded-lg bg-[#075fff] px-2 py-0.5 text-xs">{item.badge}</span> : null}
              {item.sub ? <span className="text-[11px] text-[#2be07e]">{item.sub}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-4 pt-8">
        <div className="rounded-2xl bg-white p-4 text-[#071432] shadow-[0_16px_50px_rgba(0,0,0,0.24)]">
          <p className="text-sm font-black">Free delivery above</p>
          <p className="mt-1 font-display text-3xl font-black text-[#075fff]">Rs 500</p>
          <p className="mt-2 text-xs font-semibold text-[#5f6e88]">Fast and reliable delivery at your doorstep.</p>
        </div>
        <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
          <p className="text-sm font-black">{shopName}</p>
          <p className="mt-1 text-xs text-[#b5c4df]">{shopLocation}</p>
          <p className="mt-3 inline-flex items-center gap-1 text-xs font-black text-[#2be07e]">
            <span className="h-2 w-2 rounded-full bg-[#2be07e]" /> Open
          </p>
          <p className="mt-3 text-xs text-[#b5c4df]">Mon - Sun: 7:00 AM - 10:00 PM</p>
        </div>
        <p className="text-center text-[11px] text-[#8092b3]">Powered by KiranaOS</p>
      </div>
    </aside>
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
  const all = [{ key: "all", label: "All" }, ...categories];
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max gap-3">
        {all.map((cat) => {
          const selected = active === cat.key;
          return (
            <button
              type="button"
              key={cat.key}
              onClick={() => onSelect(cat.key)}
              className={`flex h-[82px] w-[84px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border bg-white text-center text-[11px] font-black transition sm:w-[92px] ${
                selected
                  ? "border-[#075fff] text-[#075fff] shadow-[0_14px_34px_rgba(7,95,255,0.16)]"
                  : "border-[#dfe8f5] text-[#172544] hover:border-[#bcd0f4]"
              }`}
            >
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${selected ? "bg-[#eaf2ff]" : "bg-[#f4f7fc]"}`}>
                {"product" in cat && cat.product?.imageUrl ? (
                  <img src={cat.product.imageUrl} alt="" className="h-8 w-8 object-contain" />
                ) : cat.key === "all" ? (
                  <ShoppingBag size={18} />
                ) : (
                  cat.label.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="line-clamp-1 px-1">{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PromoCard({ tone, title, body }: { tone: "green" | "blue" | "orange"; title: string; body: string }) {
  const styles = {
    green: "border-[#d8f5e2] bg-[#f1fbf5] text-[#0f9f4a]",
    blue: "border-[#dce8ff] bg-[#f4f8ff] text-[#075fff]",
    orange: "border-[#ffe4be] bg-[#fff8ed] text-[#f97316]",
  }[tone];
  const Icon = tone === "green" ? Truck : tone === "blue" ? Clock : Store;
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 ${styles}`}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/80">
        <Icon size={22} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-black">{title}</p>
        <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#3f4f70]">{body}</p>
      </div>
    </div>
  );
}

function ProductCard({ product, qty, onChange }: { product: CustomerCatalogProduct; qty: number; onChange: (next: number) => void }) {
  return (
    <article className="group rounded-2xl border border-[#e3ebf7] bg-white p-3 shadow-[0_12px_35px_rgba(20,60,120,0.05)] transition hover:-translate-y-0.5 hover:border-[#cbdcf8] hover:shadow-[0_20px_48px_rgba(20,60,120,0.1)]">
      <div className="relative grid aspect-square place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#f8fbff] via-[#f3f7ff] to-[#eef5ff]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-[76%] w-[76%] object-contain transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="grid place-items-center gap-1 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-[#075fff] shadow-[0_12px_30px_rgba(7,95,255,0.12)]">
              <PackageCheck size={24} />
            </span>
            <span className="font-display text-lg font-black text-[#b9c6dc]">{product.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <button type="button" aria-label={`Save ${product.name}`} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white text-[#7b8aa5] shadow-sm">
          <Heart size={16} />
        </button>
      </div>
      <div className="mt-3 min-h-[86px]">
        <h3 className="line-clamp-2 text-sm font-black leading-snug text-[#0b1735]">{product.name}</h3>
        <p className="mt-1 text-xs font-semibold text-[#4f5f7b]">{product.unit}</p>
        <p className="mt-2 text-base font-black text-[#071432]">
          {formatRs(product.price)}
          {product.mrp && product.mrp > product.price ? (
            <span className="ml-2 text-xs font-semibold text-[#95a3bb] line-through">{formatRs(product.mrp)}</span>
          ) : null}
        </p>
        <p className="mt-1 text-xs font-black text-[#0f9f4a]">In Stock</p>
      </div>
      {qty > 0 ? (
        <QuantityStepper qty={qty} onChange={onChange} />
      ) : (
        <button
          type="button"
          onClick={() => onChange(1)}
          className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-[#cfe0ff] bg-[#f8fbff] text-sm font-black text-[#075fff] transition hover:bg-[#eaf2ff]"
        >
          Add
        </button>
      )}
    </article>
  );
}

function ProductListRow({ product, qty, onChange }: { product: CustomerCatalogProduct; qty: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e3ebf7] bg-white p-3">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#f8fbff] to-[#eef5ff]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-14 w-14 object-contain" />
        ) : (
          <PackageCheck size={24} className="text-[#075fff]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-[#0b1735]">{product.name}</p>
        <p className="text-xs font-semibold text-[#687892]">{product.unit} - In Stock</p>
        <p className="mt-1 text-sm font-black text-[#071432]">{formatRs(product.price)}</p>
      </div>
      {qty > 0 ? (
        <div className="w-32">
          <QuantityStepper qty={qty} onChange={onChange} compact />
        </div>
      ) : (
        <button type="button" onClick={() => onChange(1)} className="rounded-xl border border-[#cfe0ff] px-4 py-2 text-sm font-black text-[#075fff]">
          Add
        </button>
      )}
    </div>
  );
}

function QuantityStepper({ qty, onChange, compact = false }: { qty: number; onChange: (next: number) => void; compact?: boolean }) {
  return (
    <div className={`mt-3 flex items-center overflow-hidden rounded-xl border border-[#d9e4f2] bg-[#f8fbff] ${compact ? "mt-0" : ""}`}>
      <button type="button" aria-label="Decrease quantity" onClick={() => onChange(qty - 1)} className="grid h-10 flex-1 place-items-center text-[#075fff]">
        <Minus size={16} />
      </button>
      <span className="grid h-10 min-w-10 place-items-center border-x border-[#d9e4f2] bg-white text-sm font-black tabular-nums">{qty}</span>
      <button type="button" aria-label="Increase quantity" onClick={() => onChange(qty + 1)} className="grid h-10 flex-1 place-items-center text-[#075fff]">
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
  return (
    <aside className="sticky top-[92px] hidden max-h-[calc(100vh-112px)] min-h-0 overflow-y-auto rounded-[24px] border border-[#e3ebf7] bg-white p-4 shadow-[0_18px_60px_rgba(20,60,120,0.08)] lg:block">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-black tracking-[-0.01em]">Your Order</h2>
          <p className="text-xs font-semibold text-[#7a889f]">{cartItems.length} item{cartItems.length === 1 ? "" : "s"}</p>
        </div>
        <button type="button" onClick={onClear} disabled={cartItems.length === 0} className="inline-flex items-center gap-1 text-xs font-black text-[#ef4444] disabled:opacity-40">
          <Trash2 size={14} /> Clear Cart
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {cartItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dce6f4] bg-[#f8fbff] py-10 text-center text-sm font-semibold text-[#71809a]">
            Add products to start an order.
          </div>
        ) : (
          cartItems.map((item) => (
            <CartLine key={item.product.id} item={item} onQtyChange={onQtyChange} />
          ))
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input placeholder="Apply Promo Code" className="min-w-0 flex-1 rounded-xl border border-[#dce6f4] px-3 py-2.5 text-sm font-semibold outline-none placeholder:text-[#8b98ad]" />
        <button type="button" className="rounded-xl border border-[#dce6f4] px-4 text-sm font-black text-[#075fff]">Apply</button>
      </div>

      <PriceBreakdown totals={totals} />

      <div className="mt-4 rounded-2xl border border-[#e3ebf7] bg-[#fbfdff] p-3">
        <div className="flex rounded-xl border border-[#dfe8f5] bg-white p-1">
          <button
            type="button"
            onClick={() => setFulfillment("delivery")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "delivery" ? "bg-[#eaf2ff] text-[#075fff]" : "text-[#52617a]"}`}
          >
            Delivery
          </button>
          <button
            type="button"
            onClick={() => setFulfillment("pickup")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "pickup" ? "bg-[#eaf2ff] text-[#075fff]" : "text-[#52617a]"}`}
          >
            Self Pickup
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <CustomerDetailsFields form={form} setForm={setForm} mobileOk={mobileOk} compact />
          <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-2.5 text-sm font-bold outline-none">
            {timeSlots.map((slot) => <option key={slot}>{slot}</option>)}
          </select>
        </div>
      </div>

      {submitError && <p className="mt-3 rounded-xl bg-[#fff1f2] px-3 py-2 text-xs font-bold text-[#e11d48]">{submitError}</p>}

      <button
        type="button"
        disabled={!canPlace || placing}
        onClick={onPlace}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#075fff] py-4 text-sm font-black text-white shadow-[0_18px_38px_rgba(7,95,255,0.24)] disabled:cursor-not-allowed disabled:bg-[#b8c6dc] disabled:shadow-none"
      >
        {placing ? <><Loader2 size={17} className="animate-spin" /> Placing order...</> : <>Place Order <ChevronRight size={17} /></>}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onQr} disabled={cartItems.length === 0} className="rounded-xl border border-[#d8f5e2] bg-[#f1fbf5] py-2.5 text-xs font-black text-[#0f9f4a] disabled:opacity-40">QR fallback</button>
        <button type="button" onClick={onClear} disabled={cartItems.length === 0} className="rounded-xl border border-[#ffd6d6] bg-[#fff7f7] py-2.5 text-xs font-black text-[#ef4444] disabled:opacity-40">Clear cart</button>
      </div>
    </aside>
  );
}

function useOrderTotalsShape() {
  return { count: 0, subtotal: 0, promoDiscount: 0, deliveryCharge: 0, gst: 0, grandTotal: 0 };
}

function CartLine({ item, onQtyChange }: { item: CartItem; onQtyChange: (id: string, next: number) => void }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[#edf2f8] bg-white p-2">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#f7faff]">
        {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-11 w-11 object-contain" /> : <ShoppingBag size={18} className="text-[#9ca9bd]" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-[#102347]">{item.product.name}</p>
        <p className="text-xs font-bold text-[#61718c]">{formatRs(item.product.price)}</p>
        <div className="mt-1 flex w-24 items-center overflow-hidden rounded-lg border border-[#d9e4f2]">
          <button type="button" onClick={() => onQtyChange(item.product.id, item.qty - 1)} className="grid h-7 flex-1 place-items-center text-[#075fff]"><Minus size={13} /></button>
          <span className="grid h-7 w-8 place-items-center border-x border-[#d9e4f2] text-xs font-black">{item.qty}</span>
          <button type="button" onClick={() => onQtyChange(item.product.id, item.qty + 1)} className="grid h-7 flex-1 place-items-center text-[#075fff]"><Plus size={13} /></button>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-black text-[#102347]">{formatRs(item.lineTotal)}</p>
        <button type="button" onClick={() => onQtyChange(item.product.id, 0)} className="mt-1 text-[#71809a]"><X size={15} /></button>
      </div>
    </div>
  );
}

function PriceBreakdown({ totals }: { totals: ReturnType<typeof useOrderTotalsShape> }) {
  return (
    <div className="mt-4 space-y-2 border-t border-[#edf2f8] pt-4 text-sm">
      <Row label="Subtotal" value={formatRs(totals.subtotal)} />
      <Row label="Discount" value={`- ${formatRs(totals.promoDiscount)}`} valueClass="text-[#0f9f4a]" />
      <Row label="Delivery Charge" value={formatRs(totals.deliveryCharge)} />
      <Row label="GST (5%)" value={formatRs(totals.gst)} />
      <div className="mt-3 flex items-center justify-between border-t border-[#edf2f8] pt-3">
        <span className="text-base font-black">Grand Total</span>
        <span className="font-display text-2xl font-black text-[#075fff]">{formatRs(totals.grandTotal)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = "text-[#102347]" }: { label: string; value: string; valueClass?: string }) {
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
  compact = false,
}: {
  form: { name: string; mobile: string; address: string; note: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; mobile: string; address: string; note: string }>>;
  mobileOk: boolean;
  compact?: boolean;
}) {
  const input = "w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#075fff]";
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Customer name" className={input} />
      <div>
        <input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" className={input} />
        {form.mobile && !mobileOk ? <p className="mt-1 text-[11px] font-bold text-[#e11d48]">Enter a valid 10-digit mobile number.</p> : null}
      </div>
      <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={compact ? 2 : 3} placeholder="Delivery address / landmark" className={`${input} resize-none`} />
      <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Order notes (optional)" className={input} />
    </div>
  );
}

function MobileCartBar({ count, amount, disabled, onOpen }: { count: number; amount: number; disabled: boolean; onOpen: () => void }) {
  if (disabled) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e4ecf7] bg-white/95 p-3 backdrop-blur lg:hidden">
      <button type="button" onClick={onOpen} className="mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl bg-[#075fff] px-4 py-3 text-white shadow-[0_18px_42px_rgba(7,95,255,0.28)]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
          <ShoppingCart size={20} />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-xs font-bold opacity-90">{count} item{count === 1 ? "" : "s"}</span>
          <span className="block font-display text-lg font-black">{formatRs(amount)}</span>
        </span>
        <span className="text-sm font-black">Checkout</span>
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
  onPlace: () => void;
  onQr: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#0b1424]/60 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-black text-[#102347]">Confirm order</h2>
            <p className="text-xs font-semibold text-[#6b7a93]">{cartItems.length} product{cartItems.length === 1 ? "" : "s"} selected</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-[#64748b] hover:bg-[#f1f5fb]"><X size={18} /></button>
        </div>

        <div className="mt-4 rounded-2xl bg-[#f8fbff] p-3">
          <PriceBreakdown totals={totals} />
        </div>

        <div className="mt-4 flex rounded-xl border border-[#dfe8f5] bg-[#f7faff] p-1">
          <button type="button" onClick={() => setFulfillment("delivery")} className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "delivery" ? "bg-white text-[#075fff] shadow-sm" : "text-[#52617a]"}`}>Delivery</button>
          <button type="button" onClick={() => setFulfillment("pickup")} className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${fulfillment === "pickup" ? "bg-white text-[#075fff] shadow-sm" : "text-[#52617a]"}`}>Self Pickup</button>
        </div>

        <div className="mt-4">
          <CustomerDetailsFields form={form} setForm={setForm} mobileOk={mobileOk} />
          <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="mt-3 w-full rounded-xl border border-[#dce6f4] bg-white px-3 py-2.5 text-sm font-bold outline-none">
            {timeSlots.map((slot) => <option key={slot}>{slot}</option>)}
          </select>
        </div>

        {submitError && (
          <div className="mt-3 rounded-xl bg-[#fff1f2] px-3 py-2 text-[12px] font-semibold text-[#e11d48]">
            {submitError}
            <button type="button" onClick={onQr} className="ml-1 underline">Show QR instead</button>
          </div>
        )}

        <button type="button" disabled={!canPlace || placing} onClick={onPlace} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#075fff] py-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-[#b8c6dc]">
          {placing ? <><Loader2 size={17} className="animate-spin" /> Sending...</> : <><Send size={17} /> Place order</>}
        </button>
        <button type="button" onClick={onQr} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#dce5f1] py-2.5 text-[12px] font-bold text-[#5b6b85]">
          <QrCode size={14} /> No internet? Show QR at the counter
        </button>
      </div>
    </div>
  );
}

function HowOrderingWorks() {
  const steps = [
    ["1", "Browse Items", "Explore products by category"],
    ["2", "Add to Cart", "Adjust quantity and review"],
    ["3", "Choose Delivery", "Confirm address and pickup option"],
    ["4", "Place Order", "Shop receives your order"],
    ["5", "Get Confirmation", "Track preparation status"],
  ];
  return (
    <section className="hidden rounded-[24px] border border-[#e4ecf7] bg-white p-5 shadow-[0_18px_60px_rgba(20,60,120,0.05)] lg:block">
      <h2 className="font-display text-lg font-black text-[#081332]">How Ordering Works</h2>
      <div className="mt-4 grid grid-cols-5 gap-3">
        {steps.map(([num, title, body], idx) => (
          <div key={num} className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eaf2ff] text-sm font-black text-[#075fff]">{num}</span>
            <div className="min-w-0">
              <p className="text-xs font-black text-[#102347]">{title}</p>
              <p className="text-[11px] font-semibold text-[#70809a]">{body}</p>
            </div>
            {idx < steps.length - 1 && <ChevronRight size={16} className="ml-auto text-[#9ba8bd]" />}
          </div>
        ))}
      </div>
    </section>
  );
}

function OrderQrOverlay({ urls, count, amount, onClose }: { urls: string[]; count: number; amount: number; onClose: () => void }) {
  const [part, setPart] = useState(0);
  const total = urls.length;
  const multi = total > 1;
  const safePart = Math.min(part, Math.max(0, total - 1));
  const current = urls[safePart] ?? "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b1424]/70 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold text-white">
        <ArrowLeft size={16} /> Back
      </button>
      <div className="m-auto w-[min(92vw,380px)] rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-bold text-[#075fff]">
          <ShoppingBag size={14} /> {count} item{count === 1 ? "" : "s"} - {formatRs(amount)}
        </div>
        <div className="mx-auto grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
          <QrCodeView value={current} level="L" size={272} title={multi ? `Order QR part ${safePart + 1} of ${total}` : "Your order QR"} />
        </div>
        {multi ? (
          <>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button type="button" disabled={safePart === 0} onClick={() => setPart((p) => Math.max(0, p - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[#075fff] disabled:opacity-40" aria-label="Previous QR">
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-[92px] text-[13px] font-black text-[#102347]">Part {safePart + 1} of {total}</span>
              <button type="button" disabled={safePart === total - 1} onClick={() => setPart((p) => Math.min(total - 1, p + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[#075fff] disabled:opacity-40" aria-label="Next QR">
                <ChevronRight size={18} />
              </button>
            </div>
            <h2 className="mt-3 font-display text-base font-black text-[#102347]">Big order - show all {total} QRs</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">The shopkeeper scans each part in order. Final price is set by the shop.</p>
          </>
        ) : (
          <>
            <h2 className="mt-4 font-display text-base font-black text-[#102347]">Show this at the counter</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">The shopkeeper scans it to load your order. Final price is set by the shop.</p>
          </>
        )}
      </div>
    </div>
  );
}

const STAGE_STEPS: Array<{ key: OrderStage; label: string; sub: string; Icon: typeof Clock }> = [
  { key: "received", label: "Order received", sub: "Waiting for the shop to accept", Icon: Clock },
  { key: "preparing", label: "Preparing your order", sub: "The shop accepted and is getting it ready", Icon: ChefHat },
  { key: "ready", label: "Ready", sub: "Your order is ready - please collect it", Icon: PackageCheck },
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
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[#075fff]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">Loading your order...</p>
      </CenterScreen>
    );
  }

  if (gone) {
    return (
      <CenterScreen>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f1f5f9] text-[#64748b]">
          <ShoppingBag size={26} />
        </div>
        <h1 className="mt-4 font-display text-lg font-black text-[#102347]">Order not found</h1>
        <p className="mt-1 max-w-xs text-center text-sm text-[#5b6b85]">This order is no longer available. You can place a new one.</p>
        <button type="button" onClick={onOrderAgain} className="mt-6 rounded-xl bg-[#075fff] px-5 py-3 text-sm font-bold text-white">Back to menu</button>
      </CenterScreen>
    );
  }

  const declined = stage === "declined";
  const currentIndex = declined ? -1 : STAGE_STEPS.findIndex((s) => s.key === stage);

  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[#102347]">
      <header className="sticky top-0 z-20 border-b border-[#e4ecf7] bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <button type="button" onClick={onBackToMenu} aria-label="Back to menu" className="grid h-9 w-9 place-items-center rounded-lg text-[#405273] hover:bg-[#f1f5fb]">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-black leading-tight">{status?.shopName ?? "Your order"}</h1>
            <p className="truncate text-[11px] font-semibold text-[#6b7a93]">Order tracking</p>
          </div>
          <button type="button" onClick={() => void load(true)} aria-label="Refresh" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dfe7f2] text-[#405273] hover:bg-[#f7faff]">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-5">
        {justPlaced && !declined && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-[#e9fbf0] px-4 py-3 text-[#16a34a]">
            <CheckCircle2 size={20} />
            <p className="text-[13px] font-bold">Order sent! The shop has been notified.</p>
          </div>
        )}

        {declined ? (
          <div className="rounded-2xl border border-[#f4d4d4] bg-[#fff5f5] p-5 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#e11d48]"><XCircle size={28} /></div>
            <h2 className="mt-3 font-display text-lg font-black text-[#102347]">Order could not be taken</h2>
            <p className="mt-1 text-[13px] text-[#5b6b85]">The shop declined this order. Please call them or place a new one.</p>
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
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${done ? "bg-[#16a34a] text-white" : active ? "bg-[#075fff] text-white" : "bg-[#eef2f8] text-[#9aa7bd]"}`}>
                      {done ? <CheckCircle2 size={18} /> : <StepIcon size={17} />}
                    </span>
                    {i < STAGE_STEPS.length - 1 && <span className={`my-1 w-0.5 flex-1 ${i < currentIndex ? "bg-[#16a34a]" : "bg-[#e6ecf4]"}`} />}
                  </div>
                  <div className={i === STAGE_STEPS.length - 1 ? "pb-0" : "pb-6"}>
                    <p className={`text-[14px] font-black ${active || done ? "text-[#102347]" : "text-[#9aa7bd]"}`}>{step.label}</p>
                    <p className="mt-0.5 text-[12px] font-medium text-[#6b7a93]">{step.sub}</p>
                    {active && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#075fff]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#075fff]" /> Now
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
              <p className="text-[13px] font-black text-[#102347]">Your order</p>
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
            <div className="mt-2 flex items-center justify-between border-t border-[#eef2f8] pt-2 text-[14px] font-black text-[#0f1e3d]">
              <span>Estimated total</span><span>{formatRs(status.estimatedTotal)}</span>
            </div>
            <p className="mt-1 text-[11px] text-[#8290a8]">Final price is set by the shop.</p>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onBackToMenu} className="flex-1 rounded-xl border border-[#dce5f1] py-3 text-sm font-bold text-[#405273]">Back to menu</button>
          <button type="button" onClick={onOrderAgain} className="flex-1 rounded-xl bg-[#075fff] py-3 text-sm font-bold text-white">Order again</button>
        </div>
      </main>
    </div>
  );
}

function CenterScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f8fd] px-6">{children}</div>;
}
