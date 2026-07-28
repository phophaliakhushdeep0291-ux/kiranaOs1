import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Layers, ScanLine, ShoppingBag } from "lucide-react";
import { useListProducts } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { parseOrderHash, reassembleOrderChunks, type CartPayload } from "@/lib/qr/cart-codec";
import { HELD_BILLS_KEY, billFromImportedCart, upsertOpenBill } from "@/features/billing/pages/open-bills";
import type { HeldBill } from "@/features/billing/pages/billing-types";

const formatRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Multi-QR accumulation: a big order arrives as several QRs the owner scans in turn. Each scan
// is a fresh page load (and a native camera may open a new tab), so partial chunks are kept in
// localStorage keyed by the order's group id until all parts are in, then reassembled.
const PART_PREFIX = "kirana:qr-order-parts:v1:";
const PART_TTL_MS = 15 * 60_000;

interface PartStore {
  total: number;
  parts: Record<number, string>;
  ts: number;
}

function readPartStore(group: string): PartStore {
  try {
    const raw = localStorage.getItem(`${PART_PREFIX}${group}`);
    if (raw) {
      const parsed = JSON.parse(raw) as PartStore;
      if (Date.now() - (parsed.ts ?? 0) < PART_TTL_MS) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { total: 0, parts: {}, ts: Date.now() };
}

function writePartStore(group: string, store: PartStore): void {
  try {
    localStorage.setItem(`${PART_PREFIX}${group}`, JSON.stringify(store));
  } catch {
    /* ignore — accumulation just won't persist across reloads */
  }
}

function clearPartStore(group: string): void {
  try {
    localStorage.removeItem(`${PART_PREFIX}${group}`);
  } catch {
    /* ignore */
  }
}

type ParseState =
  | { kind: "invalid" }
  | { kind: "collecting"; have: number; total: number; justGot: number }
  | { kind: "ready"; payload: CartPayload };

function parseHashToState(): ParseState {
  const parsed = parseOrderHash(window.location.hash);
  if (!parsed) return { kind: "invalid" };
  if (parsed.kind === "single") return { kind: "ready", payload: parsed.payload };

  // Multi-QR part: merge into the group's store and reassemble once complete.
  const store = readPartStore(parsed.group);
  store.total = parsed.total;
  store.parts[parsed.index] = parsed.chunk;
  store.ts = Date.now();
  writePartStore(parsed.group, store);

  const have = Object.keys(store.parts).length;
  if (have >= parsed.total) {
    const cart = reassembleOrderChunks(store.parts, parsed.total);
    clearPartStore(parsed.group);
    return cart ? { kind: "ready", payload: cart } : { kind: "invalid" };
  }
  return { kind: "collecting", have, total: parsed.total, justGot: parsed.index };
}

/**
 * /import-order — the owner lands here after scanning a customer's order QR with the native
 * camera. We read the cart from the URL fragment, match it to the owner's live products, and
 * (on confirm) drop it into the Open Bills set so the owner can review + finalize in Billing.
 * Works fully offline: nothing is fetched here, products come from the offline-hydrated cache.
 */
export default function ImportOrderPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [parseState] = useState<ParseState>(parseHashToState);
  const payload = parseState.kind === "ready" ? parseState.payload : null;
  const [adding, setAdding] = useState(false);

  const productsQuery = useListProducts({ limit: 350 }, { query: { staleTime: 60_000 } });
  const products = useMemo(
    () => (productsQuery.data ?? []).filter((p) => p.deletedAt == null),
    [productsQuery.data],
  );

  const result = useMemo(
    () => (payload ? billFromImportedCart(products, payload.items, { label: "QR order" }) : null),
    [payload, products],
  );

  async function addToBilling() {
    if (!result || result.matched === 0) return;
    setAdding(true);
    try {
      const current = (await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null)) ?? [];
      await offlineDB.setSetting(HELD_BILLS_KEY, upsertOpenBill(current, result.bill)).catch(() => undefined);
      toast({
        title: "Order added to Open Bills",
        description: `${result.matched} item${result.matched === 1 ? "" : "s"} ready to review in Billing.`,
      });
      setLocation("/billing");
    } finally {
      setAdding(false);
    }
  }

  if (parseState.kind === "collecting") {
    const { have, total } = parseState;
    return (
      <Centered>
        <Icon tone="blue"><Layers size={26} /></Icon>
        <h1 className="mt-4 font-display text-lg font-black text-[#102347]">Big order — {have} of {total} QRs scanned</h1>
        <p className="mt-1 max-w-sm text-center text-sm text-[#5b6b85]">
          Open your camera again and scan the next QR on the customer’s phone. They’ll show all {total} in order.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-black ${
                n <= have ? "bg-[var(--brand)] text-white" : "border border-[#d6e0ee] text-[#94a3b8]"
              }`}
            >
              {n}
            </span>
          ))}
        </div>
        <BackToBilling onClick={() => setLocation("/billing")} />
      </Centered>
    );
  }

  if (!payload) {
    return (
      <Centered>
        <Icon tone="rose"><AlertTriangle size={26} /></Icon>
        <h1 className="mt-4 font-display text-lg font-black text-[#102347]">Invalid order link</h1>
        <p className="mt-1 max-w-sm text-center text-sm text-[#5b6b85]">
          This page opens a customer’s scanned order. Scan the QR shown on the customer’s phone again.
        </p>
        <BackToBilling onClick={() => setLocation("/billing")} />
      </Centered>
    );
  }

  if (productsQuery.isLoading) {
    return (
      <Centered>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[var(--brand)]" />
        <p className="mt-4 text-sm font-medium text-[#5b6b85]">Reading the order…</p>
      </Centered>
    );
  }

  const matchedLines = result?.bill.cart ?? [];
  const total = matchedLines.reduce((sum, l) => sum + l.rate * l.quantity, 0);

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Icon tone="blue"><ScanLine size={22} /></Icon>
        <div>
          <h1 className="font-display text-xl font-black text-[#102347]">Customer order</h1>
          <p className="text-[12px] font-semibold text-[#6b7a93]">Review the scanned items, then add to billing.</p>
        </div>
      </div>

      {result && result.matched === 0 ? (
        <div className="rounded-2xl border border-[#ffd9df] bg-[#fff5f6] p-5 text-center">
          <p className="font-bold text-[#b4233a]">None of these items match your products.</p>
          <p className="mt-1 text-sm text-[#8a5560]">
            This QR may be from a different shop, or the products were removed.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {matchedLines.map((line, i) => (
              <li
                key={`${line.product.id}-${i}`}
                className="flex items-center gap-3 rounded-2xl border border-[#e6edf6] bg-white p-3 shadow-[0_4px_14px_rgba(26,57,112,0.04)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#102347]">{line.product.name}</p>
                  <p className="text-[12px] font-semibold text-[#5b6b85]">
                    {line.quantity} {line.unit} × {formatRs(line.rate)}
                  </p>
                </div>
                <p className="font-display text-sm font-black text-[#102347]">{formatRs(line.rate * line.quantity)}</p>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#0b1424] px-4 py-3 text-white">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <ShoppingBag size={16} /> {result?.matched} item{result?.matched === 1 ? "" : "s"}
            </span>
            <span className="font-display text-lg font-black">{formatRs(total)}</span>
          </div>

          {result && result.skipped.length > 0 && (
            <p className="mt-2 text-center text-[12px] font-medium text-[#b4233a]">
              {result.skipped.length} item{result.skipped.length === 1 ? "" : "s"} from the order didn’t match your
              products and {result.skipped.length === 1 ? "was" : "were"} skipped.
            </p>
          )}

          <button
            type="button"
            onClick={addToBilling}
            disabled={adding}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-[var(--brand)]/25 disabled:opacity-60"
          >
            Add to Open Bills <ArrowRight size={18} />
          </button>
        </>
      )}

      <p className="mt-4 text-center text-[11px] leading-relaxed text-[#8595ac]">
        Prices are taken from your current products — the customer’s QR is only a request. Nothing is billed until you
        confirm in Billing.
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[70vh] flex-col items-center justify-center px-6">{children}</div>;
}

function Icon({ tone, children }: { tone: "blue" | "rose"; children: React.ReactNode }) {
  const cls = tone === "blue" ? "bg-[#eaf2ff] text-[var(--brand)]" : "bg-[#fff1f2] text-[#e11d48]";
  return <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${cls}`}>{children}</div>;
}

function BackToBilling({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 rounded-xl border border-[#d6e0ee] bg-white px-4 py-2.5 text-sm font-bold text-[var(--brand)]"
    >
      Go to Billing
    </button>
  );
}
