import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft, Minus, Plus, QrCode, Search, ShoppingBag, Store, WifiOff } from "lucide-react";
import { QrCodeView } from "@/lib/qr/QrCodeView";
import { buildOrderDeepLink } from "@/lib/qr/cart-codec";
import {
  loadCustomerCatalog,
  readCachedCatalog,
  CatalogUnavailableError,
  type CustomerCatalog,
  type CustomerCatalogProduct,
} from "./catalog";

const formatRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// A single QR comfortably holds this many bytes in byte-mode at ECC level L while staying
// scannable on a phone screen. Beyond it we ask the customer to trim the cart (multi-QR is a
// planned follow-up).
const MAX_ORDER_LINK_BYTES = 2900;

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
  const [showQr, setShowQr] = useState(false);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

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

  const orderLink = useMemo(() => {
    if (items.length === 0) return "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const origin = `${window.location.origin}${base}`;
    return buildOrderDeepLink(origin, { shopCode, items });
  }, [items, shopCode]);

  const orderTooBig = orderLink.length > MAX_ORDER_LINK_BYTES;

  function setItemQty(id: string, next: number) {
    setQty((prev) => {
      const value = Math.max(0, Math.round(next * 1000) / 1000);
      const copy = { ...prev };
      if (value <= 0) delete copy[id];
      else copy[id] = value;
      return copy;
    });
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
          </div>
        </div>
      </header>

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
            onClick={() => setShowQr(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#075fff] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#075fff]/25 transition disabled:cursor-not-allowed disabled:bg-[#b8c6dc] disabled:shadow-none"
          >
            <QrCode size={18} /> Show my order
          </button>
        </div>
      </div>

      {showQr && (
        <OrderQrOverlay
          link={orderLink}
          tooBig={orderTooBig}
          count={totals.count}
          amount={totals.amount}
          onClose={() => setShowQr(false)}
        />
      )}
    </div>
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
  link,
  tooBig,
  count,
  amount,
  onClose,
}: {
  link: string;
  tooBig: boolean;
  count: number;
  amount: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#0b1424]/70 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold text-white">
        <ArrowLeft size={16} /> Back
      </button>
      <div className="m-auto w-[min(92vw,380px)] rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-[#eaf2ff] px-3 py-1 text-xs font-bold text-[#075fff]">
          <ShoppingBag size={14} /> {count} item{count === 1 ? "" : "s"} · {formatRs(amount)}
        </div>
        {tooBig ? (
          <p className="py-10 text-sm font-semibold text-[#e11d48]">
            Your list is too long to fit in one QR. Please remove a few items and show it in two batches.
          </p>
        ) : (
          <>
            <div className="mx-auto grid place-items-center rounded-2xl border border-[#eef2f8] p-3">
              <QrCodeView value={link} level="L" size={272} title="Your order QR" />
            </div>
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

function CenterScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f8fd] px-6">{children}</div>;
}
