import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, ScanLine, ShoppingBag } from "lucide-react";
import { useListProducts } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { parseOrderFromHash } from "@/lib/qr/cart-codec";
import { HELD_BILLS_KEY, billFromImportedCart, upsertOpenBill } from "@/features/billing/pages/open-bills";
import type { HeldBill } from "@/features/billing/pages/billing-types";

const formatRs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * /import-order — the owner lands here after scanning a customer's order QR with the native
 * camera. We read the cart from the URL fragment, match it to the owner's live products, and
 * (on confirm) drop it into the Open Bills set so the owner can review + finalize in Billing.
 * Works fully offline: nothing is fetched here, products come from the offline-hydrated cache.
 */
export default function ImportOrderPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [payload] = useState(() => parseOrderFromHash(window.location.hash));
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
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe6f5] border-t-[#075fff]" />
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
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#075fff] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#075fff]/25 disabled:opacity-60"
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
  const cls = tone === "blue" ? "bg-[#eaf2ff] text-[#075fff]" : "bg-[#fff1f2] text-[#e11d48]";
  return <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${cls}`}>{children}</div>;
}

function BackToBilling({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 rounded-xl border border-[#d6e0ee] bg-white px-4 py-2.5 text-sm font-bold text-[#075fff]"
    >
      Go to Billing
    </button>
  );
}
