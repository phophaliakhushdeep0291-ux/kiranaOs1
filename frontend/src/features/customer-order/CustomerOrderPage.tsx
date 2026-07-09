import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "wouter";
import { ArrowLeft, CheckCircle2, ChefHat, ChevronLeft, ChevronRight, Clock, Loader2, Minus, PackageCheck, Plus, QrCode, RefreshCw, Search, Send, ShoppingBag, Store, WifiOff, X, XCircle } from "lucide-react";
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

const formatRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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

export default function CustomerOrderPage() {
  const params = useParams<{ shopCode: string }>();
  const shopCode = params.shopCode ?? "";

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [sheet, setSheet] = useState<"none" | "checkout" | "qr">("none");
  const [form, setForm] = useState({ name: "", mobile: "", address: "", note: "" });
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<SubmitOrderResult | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState<{ key: string; fingerprint: string } | null>(null);
  // Tracking the customer's own order (received → preparing → ready). trackedOrderId survives reloads
  // via localStorage; showTracker controls whether the tracker screen is up vs. the menu.
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(null);
  const [showTracker, setShowTracker] = useState(false);

  useEffect(() => {
    const mine = readMyOrder(shopCode);
    if (mine) setTrackedOrderId(mine.orderId);
  }, [shopCode]);

  useEffect(() => {
    let active = true;
    // Paint the cached catalog instantly (returning customer), then revalidate in the background
    // so the page feels immediate even on a slow connection.
    const cached = readCachedCatalog(shopCode);
    setState(cached ? { kind: "ready", catalog: cached, source: "cache" } : { kind: "loading" });
    loadCustomerCatalog(shopCode)
      .then((res) => {
        if (active) setState({ kind: "ready", catalog: res.catalog, source: res.source });
      })
      .catch((err: unknown) => {
        if (!active) return;
        // A definitive 404 (shop unknown / ordering off) always wins, even over a stale cache.
        if (err instanceof CatalogUnavailableError) {
          setState({ kind: "error", unavailable: true, message: err.message });
          return;
        }
        // Network failure with a cache already on screen: keep showing it (offline). Otherwise error.
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

  // Category chips (like the billing screen) so big catalogs stay browsable. Only shown when the
  // shop actually spreads products across more than one category.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "all" && (p.category ?? "").trim().toLowerCase() !== category.toLowerCase()) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q);
    });
  }, [products, search, category]);

  const items = useMemo(
    () =>
      Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([productId, q]) => ({ productId, qty: q })),
    [qty],
  );

  const totals = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    let count = 0;
    let amount = 0;
    for (const { productId, qty: q } of items) {
      const p = byId.get(productId);
      if (!p) continue;
      count += q;
      amount += q * p.price;
    }
    return { count, amount };
  }, [items, products]);

  const orderQrUrls = useMemo(() => {
    if (items.length === 0) return [];
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const origin = `${window.location.origin}${base}`;
    return buildOrderQrPayloads(origin, { shopCode, items });
  }, [items, shopCode]);

  function setItemQty(id: string, next: number) {
    setQty((prev) => {
      const value = Math.max(0, Math.round(next * 1000) / 1000);
      const copy = { ...prev };
      if (value <= 0) delete copy[id];
      else copy[id] = value;
      return copy;
    });
  }

  const mobileOk = /^[6-9]\d{9}$/.test(form.mobile.replace(/[\s-]/g, ""));
  const canPlace = form.name.trim().length >= 2 && mobileOk && items.length > 0;
  const submitFingerprint = useMemo(
    () =>
      JSON.stringify({
        name: form.name.trim(),
        mobile: form.mobile.replace(/[\s-]/g, ""),
        address: form.address.trim(),
        note: form.note.trim(),
        items,
      }),
    [form.address, form.mobile, form.name, form.note, items],
  );

  async function placeOrder() {
    if (!canPlace || placing) return;
    setPlacing(true);
    setSubmitError(null);
    const idempotencyKey =
      submitAttempt?.fingerprint === submitFingerprint ? submitAttempt.key : newOrderIdempotencyKey(shopCode);
    if (submitAttempt?.key !== idempotencyKey) setSubmitAttempt({ key: idempotencyKey, fingerprint: submitFingerprint });
    try {
      const result = await submitCustomerOrder(
        shopCode,
        {
          customerName: form.name.trim(),
          customerMobile: form.mobile.replace(/[\s-]/g, ""),
          customerAddress: form.address.trim() || undefined,
          note: form.note.trim() || undefined,
        },
        items,
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
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">Loading shop…</p>
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
          {state.unavailable ? "Shop not available" : "Couldn’t load shop"}
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
        onBackToMenu={() => { setShowTracker(false); setPlaced(null); }}
        onOrderAgain={() => { forgetMyOrder(shopCode); setTrackedOrderId(null); setShowTracker(false); setPlaced(null); }}
      />
    );
  }

  const { catalog, source } = state;

  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[#102347]">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-[#e4ecf7] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff]">
            <Store size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-black leading-tight">{catalog.shop.name}</h1>
            <p className="truncate text-[11px] font-semibold text-[#6b7a93]">
              {catalog.shop.city ? `${catalog.shop.city} · ` : ""}Self-order
            </p>
          </div>
          {source === "cache" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#fff7ed] px-2 py-1 text-[10px] font-bold text-[#c2410c]">
              <WifiOff size={11} /> Offline
            </span>
          )}
        </div>
        <div className="mx-auto max-w-xl px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#e2eaf4] bg-[#f7fafe] px-3">
            <Search size={16} className="text-[#94a3b8]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-[#9aa7bd]"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-[#94a3b8] hover:text-[#5b6b85]">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        {categories.length > 1 && (
          <div className="mx-auto max-w-xl overflow-x-auto px-4 pb-2.5">
            <div className="flex gap-1.5">
              {["all", ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold capitalize transition-colors " +
                    (category === c ? "bg-[#075fff] text-white" : "border border-[#e2eaf4] bg-white text-[#5b6b85]")
                  }
                >
                  {c === "all" ? "All" : c}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Returning customer: quick way back to their live order */}
      {trackedOrderId && (
        <div className="mx-auto max-w-xl px-4 pt-3">
          <button
            type="button"
            onClick={() => setShowTracker(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-[#cfe0ff] bg-[#eaf2ff] px-4 py-3 text-left"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#075fff]"><PackageCheck size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-black text-[#102347]">Track your order</span>
              <span className="block text-[11px] font-semibold text-[#5b6b85]">See if the shop has accepted and is preparing it.</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-[#075fff]" />
          </button>
        </div>
      )}

      {/* Product list */}
      <main className="mx-auto max-w-xl px-4 pb-40 pt-3">
        {filtered.length === 0 ? (
          <div className="mt-16 text-center text-sm text-[#6b7a93]">
            {products.length === 0 ? "This shop has no items listed yet." : "No items match your search."}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => (
              <ProductRow key={p.id} product={p} qty={qty[p.id] ?? 0} onChange={(n) => setItemQty(p.id, n)} />
            ))}
          </ul>
        )}
      </main>

      {/* Sticky cart bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e4ecf7] bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-[#6b7a93]">
              {totals.count > 0 ? `${totals.count} item${totals.count === 1 ? "" : "s"}` : "No items yet"}
            </p>
            <p className="font-display text-lg font-black">{formatRs(totals.amount)}</p>
          </div>
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => { setSubmitError(null); setSheet("checkout"); }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#075fff] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#075fff]/25 transition disabled:cursor-not-allowed disabled:bg-[#b8c6dc] disabled:shadow-none"
          >
            <Send size={17} /> Place order
          </button>
        </div>
      </div>

      {sheet === "checkout" && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-[#0b1424]/60 backdrop-blur-sm sm:items-center" onClick={() => !placing && setSheet("none")}>
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-black text-[#102347]">Your details</h2>
              <button type="button" aria-label="Close" onClick={() => setSheet("none")} className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5fb]"><X size={18} /></button>
            </div>
            <p className="mt-0.5 text-[12px] text-[#6b7a93]">{totals.count} item{totals.count === 1 ? "" : "s"} · about {formatRs(totals.amount)} — final price is set by the shop.</p>

            <div className="mt-4 space-y-3">
              <Field label="Name*">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Your name" className="w-full rounded-xl border border-[#dce5f1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#075fff]" />
              </Field>
              <Field label="Mobile number*" hint={form.mobile && !mobileOk ? "Enter a valid 10-digit number" : undefined}>
                <input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" className="w-full rounded-xl border border-[#dce5f1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#075fff]" />
              </Field>
              <Field label="Address (optional)">
                <textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} placeholder="Delivery address / landmark" className="w-full resize-none rounded-xl border border-[#dce5f1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#075fff]" />
              </Field>
              <Field label="Note (optional)">
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. deliver after 6pm" className="w-full rounded-xl border border-[#dce5f1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#075fff]" />
              </Field>
            </div>

            {submitError && (
              <div className="mt-3 rounded-xl bg-[#fff1f2] px-3 py-2 text-[12px] font-semibold text-[#e11d48]">
                {submitError}
                <button type="button" onClick={() => setSheet("qr")} className="ml-1 underline">Show QR instead</button>
              </div>
            )}

            <button
              type="button"
              disabled={!canPlace || placing}
              onClick={() => void placeOrder()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#075fff] py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b8c6dc]"
            >
              {placing ? <><Loader2 size={17} className="animate-spin" /> Sending…</> : <><Send size={17} /> Send order to shop</>}
            </button>
            <button type="button" onClick={() => setSheet("qr")} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#dce5f1] py-2.5 text-[12px] font-bold text-[#5b6b85]">
              <QrCode size={14} /> No internet? Show QR at the counter
            </button>
          </div>
        </div>
      )}

      {sheet === "qr" && (
        <OrderQrOverlay
          urls={orderQrUrls}
          count={totals.count}
          amount={totals.amount}
          onClose={() => setSheet("none")}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold text-[#3f4d68]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] font-semibold text-[#e11d48]">{hint}</span> : null}
    </label>
  );
}

function ProductRow({
  product,
  qty,
  onChange,
}: {
  product: CustomerCatalogProduct;
  qty: number;
  onChange: (next: number) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[#e6edf6] bg-white p-2.5 shadow-[0_4px_14px_rgba(26,57,112,0.04)]">
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#f0f4fa] text-[#9aa7bd]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-display text-lg font-black text-[#c2cee0]">{product.name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight">{product.name}</p>
        <p className="text-[12px] font-semibold text-[#5b6b85]">
          {formatRs(product.price)} <span className="font-medium text-[#92a0b6]">/ {product.unit}</span>
          {product.mrp && product.mrp > product.price ? (
            <span className="ml-1 text-[11px] font-medium text-[#9aa7bd] line-through">{formatRs(product.mrp)}</span>
          ) : null}
        </p>
      </div>
      {qty > 0 ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Decrease ${product.name}`}
            onClick={() => onChange(qty - 1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#d6e0ee] bg-white text-[#075fff]"
          >
            <Minus size={16} />
          </button>
          <span className="w-6 text-center text-sm font-black tabular-nums">{qty}</span>
          <button
            type="button"
            aria-label={`Increase ${product.name}`}
            onClick={() => onChange(qty + 1)}
            className="grid h-8 w-8 place-items-center rounded-lg bg-[#075fff] text-white"
          >
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onChange(1)}
          className="inline-flex items-center gap-1 rounded-lg border border-[#cfe0ff] bg-[#eaf2ff] px-3 py-2 text-xs font-bold text-[#075fff]"
        >
          <Plus size={14} /> Add
        </button>
      )}
    </li>
  );
}

function OrderQrOverlay({
  urls,
  count,
  amount,
  onClose,
}: {
  urls: string[];
  count: number;
  amount: number;
  onClose: () => void;
}) {
  const [part, setPart] = useState(0);
  const total = urls.length;
  const multi = total > 1;
  const safePart = Math.min(part, Math.max(0, total - 1));
  const current = urls[safePart] ?? "";

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#0b1424]/70 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold text-white">
        <ArrowLeft size={16} /> Back
      </button>
      <div className="m-auto w-[min(92vw,380px)] rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-bold text-[#075fff]">
          <ShoppingBag size={14} /> {count} item{count === 1 ? "" : "s"} · {formatRs(amount)}
        </div>
        <div className="mx-auto grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
          <QrCodeView value={current} level="L" size={272} title={multi ? `Order QR part ${safePart + 1} of ${total}` : "Your order QR"} />
        </div>
        {multi ? (
          <>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={safePart === 0}
                onClick={() => setPart((p) => Math.max(0, p - 1))}
                className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[#075fff] disabled:opacity-40"
                aria-label="Previous QR"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-[92px] text-[13px] font-black text-[#102347]">Part {safePart + 1} of {total}</span>
              <button
                type="button"
                disabled={safePart === total - 1}
                onClick={() => setPart((p) => Math.min(total - 1, p + 1))}
                className="grid h-9 w-9 place-items-center rounded-lg border border-[#d6e0ee] text-[#075fff] disabled:opacity-40"
                aria-label="Next QR"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <h2 className="mt-3 font-display text-base font-black text-[#102347]">Big order — show all {total} QRs</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">
              The shopkeeper scans each part in order (1 → {total}). Final price is set by the shop.
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-4 font-display text-base font-black text-[#102347]">Show this at the counter</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#5b6b85]">
              The shopkeeper scans it with their phone camera to load your order. Final price is set by the shop.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const STAGE_STEPS: Array<{ key: OrderStage; label: string; sub: string; Icon: typeof Clock }> = [
  { key: "received", label: "Order received", sub: "Waiting for the shop to accept", Icon: Clock },
  { key: "preparing", label: "Preparing your order", sub: "The shop accepted and is getting it ready", Icon: ChefHat },
  { key: "ready", label: "Ready", sub: "Your order is ready — please collect it", Icon: PackageCheck },
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
        // Transient/offline errors: keep showing the last known status silently.
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

  // Poll while the order is still moving; stop once it's ready/declined/gone.
  useEffect(() => {
    if (terminal) return;
    const id = window.setInterval(() => void load(), 12000);
    return () => window.clearInterval(id);
  }, [terminal, load]);

  if (loading && !status && !gone) {
    return (
      <CenterScreen>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[#075fff]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">Loading your order…</p>
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
        <p className="mt-1 max-w-xs text-center text-sm text-[#5b6b85]">
          This order is no longer available. You can place a new one.
        </p>
        <button type="button" onClick={onOrderAgain} className="mt-6 rounded-xl bg-[#075fff] px-5 py-3 text-sm font-bold text-white">
          Back to menu
        </button>
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
          <button
            type="button"
            onClick={() => void load(true)}
            aria-label="Refresh"
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#dfe7f2] text-[#405273] hover:bg-[#f7faff]"
          >
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
            <h2 className="mt-3 font-display text-lg font-black text-[#102347]">Order couldn't be taken</h2>
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
                    <span
                      className={
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors " +
                        (done ? "bg-[#16a34a] text-white" : active ? "bg-[#075fff] text-white" : "bg-[#eef2f8] text-[#9aa7bd]")
                      }
                    >
                      {done ? <CheckCircle2 size={18} /> : <StepIcon size={17} />}
                    </span>
                    {i < STAGE_STEPS.length - 1 && (
                      <span className={"my-1 w-0.5 flex-1 " + (i < currentIndex ? "bg-[#16a34a]" : "bg-[#e6ecf4]")} />
                    )}
                  </div>
                  <div className={"pb-6 " + (i === STAGE_STEPS.length - 1 ? "pb-0" : "")}>
                    <p className={"text-[14px] font-black " + (active || done ? "text-[#102347]" : "text-[#9aa7bd]")}>{step.label}</p>
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
                  <span className="min-w-0 truncate text-[#334364]"><span className="font-bold">{it.qty}×</span> {it.name}</span>
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
          <button type="button" onClick={onBackToMenu} className="flex-1 rounded-xl border border-[#dce5f1] py-3 text-sm font-bold text-[#405273]">
            Back to menu
          </button>
          <button type="button" onClick={onOrderAgain} className="flex-1 rounded-xl bg-[#075fff] py-3 text-sm font-bold text-white">
            Order again
          </button>
        </div>
      </main>
    </div>
  );
}

function CenterScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f8fd] px-6">{children}</div>;
}
