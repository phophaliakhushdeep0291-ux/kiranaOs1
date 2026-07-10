import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "wouter";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Edit3,
  FileText,
  Gift,
  Heart,
  Home,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  MoreVertical,
  PackageCheck,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
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
type CustomerStorefrontView = "shop" | "orders" | "lists" | "offers" | "wallet" | "addresses" | "payments" | "settings" | "support";

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
          activeView={activeView}
          onView={setActiveView}
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
          <CustomerMobileNav activeView={activeView} onView={setActiveView} />

          <main className={`mx-auto w-full max-w-[1500px] px-4 pb-32 pt-4 sm:px-6 lg:px-8 lg:pb-8 ${activeView === "shop" ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]" : ""}`}>
            {activeView === "shop" ? (
              <>
                <section className="min-w-0 space-y-5">
                  <CategoryRail categories={categories} active={category} onSelect={setCategory} />

                  <div className="grid gap-3 md:grid-cols-3">
                    <PromoCard tone="green" title="Free delivery above Rs 500" body={deliveryShortfall > 0 ? `Shop for ${formatRs(deliveryShortfall)} more to get free delivery` : "Your order gets free delivery"} />
                    <PromoCard tone="blue" title="Express delivery in 60 mins" body="Fresh items from the store to your doorstep" />
                    <PromoCard tone="orange" title="Pickup in 20 mins" body="Order online and pick up from store" />
                  </div>

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
  return (
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
  );
}

const CUSTOMER_NAV: Array<{ view: CustomerStorefrontView; label: string; icon: typeof Home; badge?: string; sub?: string }> = [
  { view: "shop", label: "Shop Now", icon: Home },
  { view: "orders", label: "My Orders", icon: ShoppingBag },
  { view: "lists", label: "My Lists", icon: Heart, badge: "3" },
  { view: "offers", label: "Offers & Deals", icon: Gift },
  { view: "wallet", label: "Wallet & Credits", icon: WalletCards, sub: "Rs 250.00" },
  { view: "addresses", label: "Addresses", icon: MapPin },
  { view: "payments", label: "Payments", icon: CreditCard },
  { view: "settings", label: "Settings", icon: Settings },
  { view: "support", label: "Help & Support", icon: Bell },
];

function CustomerMobileNav({ activeView, onView }: { activeView: CustomerStorefrontView; onView: (view: CustomerStorefrontView) => void }) {
  return (
    <div className="border-b border-[#e4ecf7] bg-white/95 px-4 py-2 lg:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CUSTOMER_NAV.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.view;
          return (
            <button
              type="button"
              key={item.view}
              onClick={() => onView(item.view)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black ${active ? "border-[#075fff] bg-[#075fff] text-white" : "border-[#dfe8f5] bg-white text-[#243653]"}`}
            >
              <Icon size={15} />
              {item.label.replace(" & Credits", "")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomerSidebar({
  shopName,
  shopLocation,
  trackedOrderId,
  activeView,
  onView,
}: {
  shopName: string;
  shopLocation: string;
  trackedOrderId: string | null;
  activeView: CustomerStorefrontView;
  onView: (view: CustomerStorefrontView) => void;
}) {
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
        {CUSTOMER_NAV.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.view;
          return (
            <button
              type="button"
              key={item.view}
              onClick={() => onView(item.view)}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black transition ${active ? "bg-[#075fff] text-white shadow-[0_12px_30px_rgba(7,95,255,0.32)]" : "text-[#dbe7fb] hover:bg-white/8"}`}
            >
              <Icon size={19} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.view === "orders" && trackedOrderId ? <span className="rounded-lg bg-[#075fff] px-2 py-0.5 text-xs">1</span> : item.badge ? <span className="rounded-lg bg-[#075fff] px-2 py-0.5 text-xs">{item.badge}</span> : null}
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

function CustomerPortalPage({
  view,
  catalog,
  products,
  onView,
  onAddProduct,
}: {
  view: CustomerStorefrontView;
  catalog: CustomerCatalog;
  products: CustomerCatalogProduct[];
  onView: (view: CustomerStorefrontView) => void;
  onAddProduct: (productId: string) => void;
}) {
  const featured = products.slice(0, 6);
  if (view === "orders") return <OrdersPortalPage products={featured} onView={onView} />;
  if (view === "lists") return <ListsPortalPage products={featured} onView={onView} onAddProduct={onAddProduct} />;
  if (view === "offers") return <OffersPortalPage products={featured} onView={onView} onAddProduct={onAddProduct} />;
  if (view === "wallet") return <WalletPortalPage onView={onView} />;
  if (view === "addresses") return <AddressesPortalPage catalog={catalog} onView={onView} />;
  if (view === "payments") return <PaymentsPortalPage onView={onView} />;
  if (view === "settings") return <CustomerSettingsPortalPage catalog={catalog} onView={onView} />;
  return <SupportPortalPage catalog={catalog} onView={onView} />;
}

function PortalHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-black tracking-[-0.02em] text-[#071432]">{title}</h1>
        <p className="mt-1 text-sm font-semibold text-[#66758f]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function PortalCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[22px] border border-[#e3ebf7] bg-white p-4 shadow-[0_18px_60px_rgba(20,60,120,0.055)] ${className}`}>
      {children}
    </section>
  );
}

function IconBubble({ icon: Icon, tone = "blue" }: { icon: typeof Home; tone?: "blue" | "green" | "orange" | "red" | "purple" | "slate" }) {
  const styles = {
    blue: "bg-[#eaf2ff] text-[#075fff]",
    green: "bg-[#e9fbf0] text-[#0f9f4a]",
    orange: "bg-[#fff4e5] text-[#f97316]",
    red: "bg-[#fff1f2] text-[#ef4444]",
    purple: "bg-[#f4eaff] text-[#7c3aed]",
    slate: "bg-[#f1f5f9] text-[#405173]",
  }[tone];
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${styles}`}>
      <Icon size={21} />
    </span>
  );
}

function ProductThumb({ product, size = "h-12 w-12" }: { product?: CustomerCatalogProduct; size?: string }) {
  return (
    <div className={`grid ${size} shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#f8fbff] to-[#eef5ff]`}>
      {product?.imageUrl ? (
        <img src={product.imageUrl} alt="" className="h-[82%] w-[82%] object-contain" />
      ) : (
        <PackageCheck size={20} className="text-[#075fff]" />
      )}
    </div>
  );
}

function OrdersPortalPage({ products, onView }: { products: CustomerCatalogProduct[]; onView: (view: CustomerStorefrontView) => void }) {
  const orderItems = products.slice(0, 4);
  const orders = [
    { id: "KOS12345678", date: "Today, 10:32 AM", total: 847.3, status: "Out for Delivery", method: "Delivery" },
    { id: "KOS12345677", date: "9 May 2025, 08:45 PM", total: 1235.6, status: "Delivered", method: "Delivery" },
    { id: "KOS12345676", date: "8 May 2025, 07:15 PM", total: 635, status: "Delivered", method: "Self Pickup" },
    { id: "KOS12345675", date: "7 May 2025, 06:20 PM", total: 892.4, status: "Returned", method: "Delivery" },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PortalHeader title="My Orders" subtitle="Track, manage, and reorder your purchases" />
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchBox placeholder="Search by order ID or item..." />
          <div className="flex gap-2 overflow-x-auto">
            {["All", "Processing", "Packed", "Out for Delivery", "Delivered", "Cancelled"].map((tab, index) => (
              <button key={tab} type="button" className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-black ${index === 0 ? "border-[#075fff] bg-[#eaf2ff] text-[#075fff]" : "border-[#dfe8f5] bg-white text-[#52617a]"}`}>{tab}</button>
            ))}
          </div>
        </div>
        <PortalCard className="mb-5 border-[#89b5ff] bg-[#f8fbff]">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_120px] lg:items-center">
            <div>
              <span className="rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-black text-[#075fff]">Active Order</span>
              <h2 className="mt-4 text-lg font-black">Order #KOS12345678</h2>
              <p className="text-sm font-semibold text-[#66758f]">8 items - {formatRs(847.3)}</p>
              <p className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#eaf2ff] px-3 py-2 text-xs font-black text-[#075fff]"><Truck size={15} /> Out for Delivery</p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {["Placed", "Confirmed", "Packed", "Out", "Delivered"].map((step, index) => (
                <div key={step} className="text-center">
                  <span className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${index < 4 ? "bg-[#075fff] text-white" : "bg-white text-[#8aa0bd]"}`}>
                    {index < 4 ? <CheckCircle2 size={18} /> : <PackageCheck size={18} />}
                  </span>
                  <p className="mt-2 text-[11px] font-black text-[#172544]">{step}</p>
                </div>
              ))}
            </div>
            <button type="button" className="rounded-xl bg-[#075fff] px-4 py-3 text-sm font-black text-white">Track Order</button>
          </div>
        </PortalCard>
        <PortalCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#f8fbff] text-xs font-black uppercase tracking-wide text-[#70809a]">
                <tr><th className="px-4 py-3">Order</th><th>Date & Time</th><th>Items</th><th>Total</th><th>Status</th><th>Method</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-[#edf2f8]">
                    <td className="px-4 py-4 font-black">#{order.id}</td>
                    <td className="font-semibold text-[#52617a]">{order.date}</td>
                    <td className="font-semibold">{Math.max(4, products.length)} items</td>
                    <td className="font-black">{formatRs(order.total)}</td>
                    <td><StatusPill status={order.status} /></td>
                    <td className="font-semibold text-[#52617a]">{order.method}</td>
                    <td><button type="button" className="rounded-xl border border-[#dfe8f5] px-3 py-2 text-xs font-black text-[#075fff]">View Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-black">Order #KOS12345678</h2>
            <button type="button" className="text-[#71809a]"><X size={18} /></button>
          </div>
          <p className="mt-2 rounded-xl bg-[#eaf2ff] px-3 py-2 text-sm font-black text-[#075fff]">Out for Delivery - Today, 12:15 PM</p>
          <h3 className="mt-5 text-sm font-black">Items ({orderItems.length || 1})</h3>
          <div className="mt-3 space-y-3">
            {(orderItems.length ? orderItems : [undefined]).map((product, index) => (
              <div key={product?.id ?? index} className="flex items-center gap-3">
                <ProductThumb product={product} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black">{product?.name ?? "Store item"}</p>
                  <p className="text-xs font-semibold text-[#66758f]">{formatRs(product?.price ?? 120)}</p>
                </div>
                <span className="text-xs font-black">x1</span>
              </div>
            ))}
          </div>
          <PriceSummaryLine label="Grand Total" value={formatRs(847.3)} strong />
          <button type="button" onClick={() => onView("shop")} className="mt-4 w-full rounded-xl border border-[#cfe0ff] py-3 text-sm font-black text-[#075fff]">Reorder</button>
        </PortalCard>
        <PortalCard className="bg-[#f1fbf5]">
          <p className="font-black text-[#0f9f4a]">Need help?</p>
          <p className="mt-1 text-sm font-semibold text-[#52617a]">Contact the store for order help.</p>
          <button type="button" onClick={() => onView("support")} className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-black text-[#075fff]">Chat with Support</button>
        </PortalCard>
      </aside>
    </div>
  );
}

function ListsPortalPage({ products, onView, onAddProduct }: { products: CustomerCatalogProduct[]; onView: (view: CustomerStorefrontView) => void; onAddProduct: (id: string) => void }) {
  const [selected, setSelected] = useState(() => new Set(products.slice(0, 3).map((p) => p.id)));
  const total = products.reduce((sum, p) => sum + p.price, 0);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PortalHeader
          title="My Lists"
          subtitle="Save time by creating and managing your shopping lists."
          action={<button type="button" className="rounded-xl bg-[#075fff] px-5 py-3 text-sm font-black text-white"><Plus size={16} className="inline" /> Create New List</button>}
        />
        <div className="mb-5 grid gap-3 md:grid-cols-4">
          {["Monthly Grocery", "Breakfast Items", "Cleaning Supplies", "Festival Shopping"].map((list, index) => (
            <PortalCard key={list} className={index === 0 ? "border-[#075fff] bg-[#f8fbff]" : ""}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-black text-[#075fff]">{list}</p>
                  <p className="mt-2 text-xs font-semibold text-[#66758f]">{24 - index * 4} items</p>
                  <p className="mt-3 text-sm font-black">Est. {formatRs(1847 - index * 320)}</p>
                </div>
                {index === 0 ? <Star size={17} className="fill-[#facc15] text-[#facc15]" /> : null}
              </div>
            </PortalCard>
          ))}
        </div>
        <PortalCard className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-[#edf2f8] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-black">Monthly Grocery</h2>
              <p className="text-xs font-semibold text-[#66758f]">{products.length || 8} items - Updated 2 hrs ago</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="rounded-xl border border-[#dfe8f5] px-4 py-2 text-xs font-black text-[#405173]"><Edit3 size={14} className="inline" /> Rename</button>
              <button type="button" className="rounded-xl bg-[#075fff] px-4 py-2 text-xs font-black text-white" onClick={() => products.forEach((p) => selected.has(p.id) && onAddProduct(p.id))}>Move to Cart</button>
            </div>
          </div>
          <div className="overflow-x-auto">
          <div className="min-w-[720px] divide-y divide-[#edf2f8]">
            {(products.length ? products : []).map((product) => {
              const checked = selected.has(product.id);
              return (
                <div key={product.id} className="grid grid-cols-[28px_52px_minmax(0,1fr)_120px_110px_40px] items-center gap-3 px-4 py-3 text-sm">
                  <input type="checkbox" checked={checked} onChange={(e) => setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(product.id);
                    else next.delete(product.id);
                    return next;
                  })} />
                  <ProductThumb product={product} />
                  <div className="min-w-0"><p className="truncate font-black">{product.name}</p><p className="text-xs font-semibold text-[#66758f]">{product.unit}</p></div>
                  <p className="font-black">{formatRs(product.price)}</p>
                  <p className="font-black text-[#0f9f4a]">In Stock</p>
                  <button type="button" className="text-[#ef4444]"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
          </div>
          {products.length === 0 ? <EmptyPortal label="No list items yet" /> : null}
        </PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard>
          <h2 className="font-display text-lg font-black">Smart Suggestions</h2>
          <div className="mt-3 space-y-3">
            {products.slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <ProductThumb product={p} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{p.name}</p><p className="text-xs text-[#66758f]">Frequently bought</p></div>
                <button type="button" onClick={() => onAddProduct(p.id)} className="grid h-8 w-8 place-items-center rounded-lg border border-[#cfe0ff] text-[#075fff]"><Plus size={15} /></button>
              </div>
            ))}
          </div>
        </PortalCard>
        <PortalCard>
          <h2 className="font-display text-lg font-black">List Summary</h2>
          <PriceSummaryLine label="Items in list" value={`${products.length}`} />
          <PriceSummaryLine label="Items selected" value={`${selected.size}`} />
          <PriceSummaryLine label="Estimated total" value={formatRs(total)} strong />
          <button type="button" onClick={() => onView("shop")} className="mt-4 w-full rounded-xl bg-[#075fff] py-3 text-sm font-black text-white">Continue Shopping</button>
        </PortalCard>
      </aside>
    </div>
  );
}

function OffersPortalPage({ products, onView, onAddProduct }: { products: CustomerCatalogProduct[]; onView: (view: CustomerStorefrontView) => void; onAddProduct: (id: string) => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <PortalHeader title="Offers & Deals" subtitle="Best offers, biggest savings. Shop more, save more!" />
        <section className="overflow-hidden rounded-[24px] bg-[#061a5f] p-6 text-white shadow-[0_24px_70px_rgba(7,95,255,0.22)]">
          <h2 className="font-display text-3xl font-black">Weekend Super Saver!</h2>
          <p className="mt-2 text-xl font-black text-[#ffc247]">Up to 50% OFF <span className="text-white">on daily essentials</span></p>
          <button type="button" onClick={() => onView("shop")} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-black text-[#075fff]">Shop Now</button>
        </section>
        <div className="grid gap-3 md:grid-cols-4">
          {["FLAT Rs 50 OFF", "10% OFF", "FREE DELIVERY", "Rs 75 CASHBACK"].map((offer, index) => (
            <PortalCard key={offer} className={["border-dashed border-[#82e6b0] bg-[#f5fff8]", "border-dashed border-[#bcd0ff] bg-[#f7faff]", "border-dashed border-[#ffd08a] bg-[#fff8ed]", "border-dashed border-[#ddb7ff] bg-[#fbf6ff]"][index]}>
              <IconBubble icon={index === 2 ? Truck : index === 3 ? WalletCards : Gift} tone={index === 2 ? "orange" : index === 3 ? "purple" : "green"} />
              <p className="mt-3 font-black">{offer}</p>
              <p className="mt-1 text-xs font-semibold text-[#66758f]">Valid on selected orders</p>
              <button type="button" className="mt-4 w-full rounded-xl bg-[#075fff] py-2 text-xs font-black text-white">Claim Offer</button>
            </PortalCard>
          ))}
        </div>
        <PortalCard>
          <div className="flex items-center justify-between"><h2 className="font-display text-lg font-black">Limited Time Deals</h2><button className="text-sm font-black text-[#075fff]" type="button">View All</button></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product, index) => (
              <div key={product.id} className="flex items-center gap-3 rounded-2xl border border-[#edf2f8] p-3">
                <ProductThumb product={product} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{product.name}</p><p className="text-xs text-[#ef4444]">{20 + index * 2}% OFF</p><p className="font-black">{formatRs(product.price * 0.9)}</p></div>
                <button type="button" onClick={() => onAddProduct(product.id)} className="rounded-lg border border-[#cfe0ff] px-3 py-2 text-xs font-black text-[#075fff]">Add</button>
              </div>
            ))}
          </div>
        </PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard><h2 className="font-display text-lg font-black">Your Savings Summary</h2><PriceSummaryLine label="Coupons Available" value="7" /><PriceSummaryLine label="Wallet Cashback" value="Rs 350.00" /><PriceSummaryLine label="Total Savings" value="Rs 326.00" strong /></PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Applied Promotions</h2><p className="mt-4 rounded-xl bg-[#f1fbf5] p-3 text-sm font-black text-[#0f9f4a]">GROCERY10 - saved Rs 82.50</p><p className="mt-2 rounded-xl bg-[#f7faff] p-3 text-sm font-black text-[#075fff]">FREEDEL - free delivery</p></PortalCard>
      </aside>
    </div>
  );
}

function WalletPortalPage({ onView }: { onView: (view: CustomerStorefrontView) => void }) {
  const rows = [
    ["23 May 2025", "Order #ORD12345", "Payment", "-Rs 796.00", "Success"],
    ["21 May 2025", "Added Money", "Add Money", "+Rs 500.00", "Success"],
    ["20 May 2025", "Cashback - Offer", "Cashback", "+Rs 35.00", "Success"],
    ["19 May 2025", "Refund - Order #ORD12210", "Refund", "+Rs 65.00", "Pending"],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <PortalHeader title="Wallet & Credits" subtitle="Manage your balance, credits and transactions" action={<span className="inline-flex items-center gap-2 text-sm font-black text-[#0f9f4a]"><ShieldCheck size={18} /> 100% Secure Payments</span>} />
        <div className="grid gap-4 md:grid-cols-4">
          <PortalCard className="bg-[#075fff] text-white md:col-span-2"><p className="text-sm font-bold opacity-90">Main Wallet Balance</p><p className="mt-5 font-display text-4xl font-black">Rs 250.00</p><button type="button" className="mt-5 w-full rounded-xl bg-white py-3 text-sm font-black text-[#075fff]"><Plus size={15} className="inline" /> Add Money</button></PortalCard>
          <PortalCard className="bg-[#f1fbf5]"><p className="font-black text-[#0f9f4a]">Store Credit</p><p className="mt-8 font-display text-2xl font-black">Rs 120.00</p><p className="text-xs text-[#66758f]">Available to use</p></PortalCard>
          <PortalCard className="bg-[#fff8ed]"><p className="font-black text-[#f97316]">Cashback Earned</p><p className="mt-8 font-display text-2xl font-black">Rs 85.00</p><p className="text-xs text-[#66758f]">Earned from offers</p></PortalCard>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {[["Add Money", WalletCards], ["Use Credit", Gift], ["Refer & Earn", UsersFallbackIcon], ["View Offers", Gift]].map(([label, Icon]) => (
            <PortalCard key={String(label)}><div className="flex items-center gap-3"><IconBubble icon={Icon as typeof Home} /><div><p className="font-black">{String(label)}</p><p className="text-xs text-[#66758f]">Quick wallet action</p></div><ChevronRight size={16} className="ml-auto" /></div></PortalCard>
          ))}
        </div>
        <PortalCard className="overflow-hidden p-0">
          <div className="flex items-center justify-between p-4"><h2 className="font-display text-lg font-black">Recent Wallet Transactions</h2><button type="button" className="text-sm font-black text-[#075fff]">View All Transactions</button></div>
          <div className="divide-y divide-[#edf2f8]">
            {rows.map(([date, ref, type, amount, status]) => <TransactionRow key={ref} left={date} title={ref} sub={type} amount={amount} status={status} />)}
          </div>
        </PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard><h2 className="font-display text-lg font-black">How to use Credits</h2>{["Store Credit can reduce your order amount.", "Cashback is added after delivery.", "Refunds arrive within 24-48 hours."].map((text) => <InfoLine key={text} text={text} />)}</PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Credit Expiry</h2><p className="mt-4 rounded-xl bg-[#fff8ed] p-3 text-sm font-black">Store Credit Rs 45.00 expires on 30 May 2025</p></PortalCard>
        <PortalCard className="bg-[#061a39] text-white"><h2 className="font-display text-lg font-black">Loyalty Tier</h2><p className="mt-4 text-xl font-black">Gold Member</p><button type="button" onClick={() => onView("offers")} className="mt-4 text-sm font-black text-[#6fb0ff]">Explore All Benefits <ChevronRight size={15} className="inline" /></button></PortalCard>
      </aside>
    </div>
  );
}

function AddressesPortalPage({ catalog }: { catalog: CustomerCatalog; onView: (view: CustomerStorefrontView) => void }) {
  const [addresses, setAddresses] = useState([
    { label: "Home", detail: "21, Gandhi Market, Jaipur, Rajasthan - 302001", phone: "+91 98290 12345", default: true },
    { label: "Work", detail: "2nd Floor, C-56, Patrika Gate, Malviya Nagar, Jaipur - 302017", phone: "+91 98765 43210", default: false },
    { label: "Parents' House", detail: "14/102, Vaishali Nagar, Jaipur, Rajasthan - 302021", phone: "+91 99887 77665", default: false },
  ]);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PortalHeader title="Addresses" subtitle="Manage your delivery and pickup addresses" action={<button type="button" className="rounded-xl bg-[#075fff] px-5 py-3 text-sm font-black text-white"><Plus size={15} className="inline" /> Add New Address</button>} />
        <div className="mb-5 flex gap-2 overflow-x-auto">{["All Addresses (3)", "Delivery Addresses (3)", "Pickup Addresses (0)"].map((tab, index) => <button key={tab} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black ${index === 0 ? "bg-[#eaf2ff] text-[#075fff]" : "text-[#52617a]"}`} type="button">{tab}</button>)}</div>
        <div className="space-y-4">
          {addresses.map((address) => (
            <PortalCard key={address.label}>
              <div className="flex gap-4">
                <IconBubble icon={address.label === "Home" ? Home : address.label === "Work" ? ShoppingBag : User} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-black">{address.label}</h2>{address.default ? <span className="rounded-full bg-[#e9fbf0] px-2 py-1 text-xs font-black text-[#0f9f4a]">Default</span> : null}</div>
                  <p className="mt-2 text-sm font-semibold text-[#283957]">{address.detail}</p>
                  <p className="mt-2 text-sm text-[#66758f]">{address.phone}</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button type="button" className="rounded-xl border border-[#dfe8f5] py-2 text-sm font-black text-[#075fff]"><Edit3 size={14} className="inline" /> Edit</button>
                    <button type="button" onClick={() => setAddresses((rows) => rows.filter((row) => row.label !== address.label))} className="rounded-xl border border-[#ffd6d6] py-2 text-sm font-black text-[#ef4444]"><Trash2 size={14} className="inline" /> Delete</button>
                    <button type="button" onClick={() => setAddresses((rows) => rows.map((row) => ({ ...row, default: row.label === address.label })))} className="rounded-xl border border-[#dfe8f5] py-2 text-sm font-black text-[#405173]"><Star size={14} className="inline" /> Set as Default</button>
                  </div>
                </div>
              </div>
            </PortalCard>
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <PortalCard><h2 className="font-display text-lg font-black">Serviceability Check</h2><div className="mt-4 grid h-56 place-items-center rounded-2xl bg-[#eef5ff] text-[#075fff]"><MapPin size={46} /></div><p className="mt-3 text-sm font-black text-[#0f9f4a]">We deliver to this location</p></PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Pickup from Store</h2><p className="mt-3 font-black">{catalog.shop.name}</p><p className="text-sm text-[#66758f]">{catalog.shop.city || "Local store"}</p><p className="mt-4 rounded-xl bg-[#f1fbf5] p-3 text-sm font-black text-[#0f9f4a]">Pickup in 20 mins</p></PortalCard>
      </aside>
    </div>
  );
}

function PaymentsPortalPage({ onView }: { onView: (view: CustomerStorefrontView) => void }) {
  const methods = ["ramesh@okicici", "Visa **** 4242", "Mastercard **** 8567", "HDFC Bank", "Cash on Delivery", "KiranaOS Wallet"];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <PortalHeader title="Payments" subtitle="Manage your payment methods, preferences and transaction history" action={<button type="button" className="rounded-xl border border-[#cfe0ff] px-4 py-2 text-sm font-black text-[#075fff]"><Plus size={15} className="inline" /> Add Payment Method</button>} />
        <PortalCard>
          <h2 className="font-display text-lg font-black">Saved Payment Methods</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {methods.map((method, index) => <div key={method} className={`rounded-2xl border p-4 ${index === 0 ? "border-[#075fff] bg-[#f8fbff]" : "border-[#e3ebf7]"}`}><div className="flex justify-between"><IconBubble icon={index < 3 ? CreditCard : index === 3 ? Store : WalletCards} tone={index === 0 ? "green" : "blue"} /><MoreVertical size={18} /></div><p className="mt-5 font-black">{method}</p><button className="mt-4 rounded-lg bg-[#eaf2ff] px-3 py-1.5 text-xs font-black text-[#075fff]" type="button">{index === 0 ? "Default" : "Set as Default"}</button></div>)}
          </div>
        </PortalCard>
        <PortalCard className="overflow-hidden p-0">
          <div className="flex items-center justify-between p-4"><h2 className="font-display text-lg font-black">Transaction History</h2><button type="button" className="rounded-xl border border-[#dfe8f5] px-3 py-2 text-xs font-black">Filter</button></div>
          {["ORD-84521", "ORD-84520", "ORD-84519", "ORD-84518", "ORD-84517"].map((id, index) => <TransactionRow key={id} left={`#${id}`} title={`${12 - index} May 2025`} sub={methods[index % methods.length]} amount={formatRs([265, 120, 560, 200, 160][index])} status={index === 4 ? "Pending" : "Paid"} />)}
        </PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard><IconBubble icon={ShieldCheck} /><h2 className="mt-3 font-display text-lg font-black">Payment Security</h2>{["PCI DSS compliant", "Bank-level encryption", "Secure UPI & card processing", "Your data is never stored"].map((text) => <InfoLine key={text} text={text} />)}</PortalCard>
        <PortalCard><IconBubble icon={RefreshCw} /><h2 className="mt-3 font-display text-lg font-black">Refunds & Returns</h2><p className="mt-2 text-sm text-[#66758f]">Refunds are initiated to your original payment method within 3-5 business days.</p><button type="button" onClick={() => onView("support")} className="mt-4 text-sm font-black text-[#075fff]">View Refund Policy <ChevronRight size={15} className="inline" /></button></PortalCard>
      </aside>
    </div>
  );
}

function CustomerSettingsPortalPage({ catalog, onView }: { catalog: CustomerCatalog; onView: (view: CustomerStorefrontView) => void }) {
  const [toggles, setToggles] = useState({ offers: true, arrivals: true, discounts: true, delivered: true, whatsapp: true, sms: true, analytics: true });
  const toggle = (key: keyof typeof toggles) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <PortalHeader title="Settings" subtitle="Manage your account, preferences and privacy settings" />
        <div className="mb-5 flex max-w-xl rounded-2xl border border-[#dfe8f5] bg-white p-1">
          {["Account", "Preferences", "Notifications", "Privacy & Security"].map((tab, index) => <button key={tab} className={`flex-1 rounded-xl px-3 py-2 text-xs font-black ${index === 0 ? "bg-[#eaf2ff] text-[#075fff]" : "text-[#52617a]"}`} type="button">{tab}</button>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PortalCard><SectionTitle icon={User} title="Profile Information" sub="Update your personal details and profile information." /><SettingsInput label="Full Name" value="Ramesh Sharma" /><SettingsInput label="Email Address" value="ramesh.sharma91@gmail.com" verified /><SettingsInput label="Date of Birth" value="12 March 1991" /><button type="button" className="mt-4 rounded-xl border border-[#cfe0ff] px-4 py-2 text-sm font-black text-[#075fff]">Edit Profile</button></PortalCard>
          <PortalCard><SectionTitle icon={Phone} title="Mobile Number" sub="Used for order updates and notifications." /><SettingsInput label="Mobile Number" value="+91 98920 12345" verified /><div className="mt-4 rounded-2xl bg-[#f1fbf5] p-4 text-sm font-black text-[#0f9f4a]">Your account is secure</div></PortalCard>
          <PortalCard><SectionTitle icon={Bell} title="Notification Preferences" sub="Choose how you want to receive updates." />{[["Promotions & Offers", "offers"], ["New Arrivals & Updates", "arrivals"], ["Exclusive Discounts", "discounts"]].map(([label, key]) => <ToggleRow key={key} label={label} checked={toggles[key as keyof typeof toggles]} onClick={() => toggle(key as keyof typeof toggles)} />)}</PortalCard>
          <PortalCard><SectionTitle icon={Truck} title="Order Updates" sub="Get real-time updates for your orders." />{[["Order Delivered", "delivered"], ["WhatsApp Notifications", "whatsapp"], ["SMS Notifications", "sms"]].map(([label, key]) => <ToggleRow key={key} label={label} checked={toggles[key as keyof typeof toggles]} onClick={() => toggle(key as keyof typeof toggles)} />)}</PortalCard>
          <PortalCard><SectionTitle icon={Settings} title="Theme Appearance" sub="Choose your preferred theme." /><div className="grid grid-cols-2 gap-3"><button type="button" className="rounded-xl border border-[#075fff] bg-[#f8fbff] py-3 font-black text-[#075fff]">Light</button><button type="button" className="rounded-xl border border-[#dfe8f5] py-3 font-black text-[#405173]">Dark</button></div></PortalCard>
          <PortalCard><SectionTitle icon={ShieldCheck} title="Privacy Controls" sub="Manage your data and privacy preferences." /><ToggleRow label="Share data for recommendations" checked={toggles.analytics} onClick={() => toggle("analytics")} /><button type="button" className="mt-4 text-sm font-black text-[#ef4444]">Logout from All Devices</button></PortalCard>
        </div>
      </div>
      <aside className="space-y-4">
        <PortalCard><h2 className="font-display text-lg font-black">Account Summary</h2><div className="mt-4 flex items-center gap-3"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#eaf2ff] font-black text-[#075fff]">RS</span><div><p className="font-black">Ramesh Sharma</p><p className="text-xs text-[#66758f]">Customer</p></div></div><PriceSummaryLine label="Wallet Balance" value="Rs 250.00" /><PriceSummaryLine label="Preferred Store" value={catalog.shop.name} /></PortalCard>
        <PortalCard className="bg-[#061a39] text-white"><h2 className="font-display text-lg font-black">KiranaOS Plus</h2><p className="mt-3 text-sm text-[#b5c4df]">You are Rs 56 away from Gold membership</p><div className="mt-4 h-2 rounded-full bg-white/15"><div className="h-full w-2/3 rounded-full bg-[#ffc247]" /></div></PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Quick Actions</h2>{[["Manage Addresses", "addresses"], ["Payment Methods", "payments"], ["My Lists", "lists"], ["Help & Support", "support"]].map(([label, target]) => <button key={label} type="button" onClick={() => onView(target as CustomerStorefrontView)} className="flex w-full items-center justify-between border-b border-[#edf2f8] py-3 text-sm font-black"><span>{label}</span><ChevronRight size={15} /></button>)}</PortalCard>
      </aside>
    </div>
  );
}

function SupportPortalPage({ catalog }: { catalog: CustomerCatalog; onView: (view: CustomerStorefrontView) => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <PortalHeader title="Help & Support" subtitle="We're here to help! Find answers or connect with support." />
        <PortalCard>
          <h2 className="font-display text-lg font-black">How can we help you today?</h2>
          <div className="mt-4 flex gap-3"><SearchBox placeholder="Search help articles, FAQs or issues..." /><button type="button" className="rounded-xl bg-[#075fff] px-6 text-sm font-black text-white">Search</button></div>
          <div className="mt-3 flex flex-wrap gap-2">{["Track Order", "Refund Status", "Cancel Order", "Payment Issues", "Wrong Item"].map((tag) => <button key={tag} type="button" className="rounded-full border border-[#dfe8f5] px-3 py-1.5 text-xs font-black text-[#52617a]">{tag}</button>)}</div>
        </PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Browse Help Topics</h2><div className="mt-4 grid gap-3 md:grid-cols-5">{[["Late Delivery", Clock, "Track delivery issues"], ["Wrong Item", PackageCheck, "Received wrong item"], ["Refund & Returns", RefreshCw, "Refund status"], ["Payment Issue", CreditCard, "Failed payments"], ["App & Technical", Settings, "Technical glitches"]].map(([title, Icon, sub], index) => <div key={String(title)} className="rounded-2xl border border-[#e3ebf7] p-4 text-center"><IconBubble icon={Icon as typeof Home} tone={["blue", "green", "purple", "orange", "red"][index] as "blue"} /><p className="mt-3 font-black">{String(title)}</p><p className="mt-1 text-xs text-[#66758f]">{String(sub)}</p></div>)}</div></PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Contact Support</h2><div className="mt-4 grid gap-3 md:grid-cols-4">{[["Live Chat", MessageCircle, "Start Chat"], ["WhatsApp Help", MessageCircle, "Chat on WhatsApp"], ["Raise a Ticket", Mail, "Raise Ticket"], ["Call Support", Phone, "+91 98920 12345"]].map(([title, Icon, action]) => <div key={String(title)} className="rounded-2xl border border-[#e3ebf7] p-4"><IconBubble icon={Icon as typeof Home} /><p className="mt-3 font-black">{String(title)}</p><button type="button" className="mt-4 w-full rounded-xl border border-[#cfe0ff] py-2 text-xs font-black text-[#075fff]">{String(action)}</button></div>)}</div></PortalCard>
        <PortalCard className="overflow-hidden p-0"><div className="p-4"><h2 className="font-display text-lg font-black">Your Support Tickets</h2></div>{["Late delivery", "Wrong item received", "Refund not received", "Payment failed but amount debited"].map((issue, index) => <TransactionRow key={issue} left={`#TK-${12458 - index}`} title={issue} sub={`Order #ORD-${89231 - index}`} amount={index === 0 ? "Today" : "Resolved"} status={index === 0 ? "In Progress" : "Resolved"} />)}</PortalCard>
      </div>
      <aside className="space-y-4">
        <PortalCard><h2 className="font-display text-lg font-black">Store Contact</h2><div className="mt-4 flex gap-3"><IconBubble icon={Store} tone="orange" /><div><p className="font-black">{catalog.shop.name}</p><p className="text-sm text-[#66758f]">{catalog.shop.city || "Local store"}</p><p className="text-xs font-black text-[#0f9f4a]">Open</p></div></div><button type="button" className="mt-4 w-full rounded-xl border border-[#cfe0ff] py-3 text-sm font-black text-[#075fff]"><Phone size={15} className="inline" /> Call Store</button><button type="button" className="mt-2 w-full rounded-xl border border-[#cdebd8] bg-[#f1fbf5] py-3 text-sm font-black text-[#0f9f4a]"><MessageCircle size={15} className="inline" /> WhatsApp Store</button></PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black">Store Operating Hours</h2>{["Mon - Fri 7:00 AM - 10:00 PM", "Saturday 7:00 AM - 10:00 PM", "Sunday 7:00 AM - 10:00 PM"].map((row) => <p key={row} className="border-b border-[#edf2f8] py-3 text-sm font-semibold text-[#52617a]">{row}</p>)}</PortalCard>
        <PortalCard><h2 className="font-display text-lg font-black text-[#ef4444]">Emergency Support</h2><InfoLine text="Customer Support (24x7): +91 98920 12345" /><InfoLine text="Email: support@kiranaos.in" /></PortalCard>
      </aside>
    </div>
  );
}

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#dfe8f5] bg-white px-3">
      <Search size={17} className="text-[#72819a]" />
      <input placeholder={placeholder} className="min-w-0 flex-1 bg-transparent py-3 text-sm font-semibold outline-none placeholder:text-[#7d8ba4]" />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status.includes("Delivered") || status.includes("Paid") || status.includes("Resolved") || status.includes("Success")
    ? "bg-[#e9fbf0] text-[#0f9f4a]"
    : status.includes("Return") || status.includes("Pending") || status.includes("Progress")
      ? "bg-[#fff8ed] text-[#f97316]"
      : "bg-[#fff1f2] text-[#ef4444]";
  return <span className={`rounded-lg px-2.5 py-1 text-xs font-black ${tone}`}>{status}</span>;
}

function PriceSummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-[#edf2f8] pt-3 text-sm">
      <span className="font-semibold text-[#66758f]">{label}</span>
      <span className={strong ? "font-display text-lg font-black text-[#075fff]" : "font-black text-[#071432]"}>{value}</span>
    </div>
  );
}

function TransactionRow({ left, title, sub, amount, status }: { left: string; title: string; sub: string; amount: string; status: string }) {
  return (
    <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)_110px_110px] sm:items-center sm:gap-3">
      <p className="font-black text-[#075fff]">{left}</p>
      <div className="min-w-0"><p className="truncate font-black">{title}</p><p className="truncate text-xs text-[#66758f]">{sub}</p></div>
      <p className="font-black">{amount}</p>
      <div className="sm:text-right"><StatusPill status={status} /></div>
    </div>
  );
}

function InfoLine({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 text-sm font-semibold text-[#52617a]">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#0f9f4a]" />
      <span>{text}</span>
    </div>
  );
}

function SectionTitle({ icon, title, sub }: { icon: typeof Home; title: string; sub: string }) {
  return (
    <div className="mb-4 flex gap-3">
      <IconBubble icon={icon} />
      <div><h2 className="font-display text-lg font-black">{title}</h2><p className="text-xs font-semibold text-[#66758f]">{sub}</p></div>
    </div>
  );
}

function SettingsInput({ label, value, verified = false }: { label: string; value: string; verified?: boolean }) {
  return (
    <label className="mt-3 block">
      <span className="text-xs font-black text-[#405173]">{label}</span>
      <span className="mt-1 flex items-center justify-between rounded-xl border border-[#dfe8f5] bg-white px-3 py-2.5 text-sm font-semibold">
        {value}
        {verified ? <span className="rounded-full bg-[#e9fbf0] px-2 py-0.5 text-[10px] font-black text-[#0f9f4a]">Verified</span> : null}
      </span>
    </label>
  );
}

function ToggleRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between border-t border-[#edf2f8] py-3 text-sm font-black">
      <span>{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-[#075fff]" : "bg-[#cbd5e1]"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function EmptyPortal({ label }: { label: string }) {
  return <div className="py-14 text-center text-sm font-semibold text-[#70809a]">{label}</div>;
}

const UsersFallbackIcon = User;

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
