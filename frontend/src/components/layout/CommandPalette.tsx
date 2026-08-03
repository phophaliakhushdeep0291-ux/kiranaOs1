import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CornerDownLeft, Package, ReceiptText, Search, Users, X } from "lucide-react";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { dedupeBillsForDisplay } from "@/features/core/sync/bill-reconciliation";
import { cn } from "@/lib/utils";

type AnyRow = Record<string, unknown>;
type ItemKind = "product" | "customer" | "bill";

interface PaletteItem {
  kind: ItemKind;
  id: string;
  title: string;
  subtitle?: string;
  route: string;
}

const MAX_PER_GROUP = 6;

function field(row: AnyRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function isDeleted(row: AnyRow): boolean {
  return row.deleted_at != null || row.deletedAt != null;
}

function identity(row: AnyRow): string {
  return field(row, ["id", "server_id", "serverId", "local_id", "localId"]);
}

function mergeLocalRows(cacheKey: string, dbRows: AnyRow[]): AnyRow[] {
  const cachedRows = readInstantCache<AnyRow[]>(cacheKey, []);
  const rows = new Map<string, AnyRow>();
  for (const row of cachedRows) {
    const key = identity(row);
    if (key) rows.set(key, row);
  }
  for (const row of dbRows) {
    const key = identity(row);
    if (key) rows.set(key, { ...(rows.get(key) ?? {}), ...row });
  }
  return Array.from(rows.values());
}

function money(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? `₹${Math.round(num).toLocaleString("en-IN")}` : "";
}

/**
 * Offline-first command palette. Reads the user's LOCAL products, customers and
 * bills straight from IndexedDB (the same source the list pages use) — no backend
 * search endpoint. Ctrl+K or clicking the header search opens it; arrow keys +
 * Enter or a click navigates to the record via the existing wouter router.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [products, setProducts] = useState<AnyRow[]>([]);
  const [customers, setCustomers] = useState<AnyRow[]>([]);
  const [bills, setBills] = useState<AnyRow[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    let alive = true;
    void (async () => {
      const [productRows, customerRows, billRows] = await Promise.all([
        offlineDB.getAll<AnyRow>("products").catch(() => []),
        offlineDB.getAll<AnyRow>("customers").catch(() => []),
        offlineDB.getAll<AnyRow>("bills").catch(() => []),
      ]);
      if (!alive) return;
      setProducts(mergeLocalRows("products", productRows).filter((row) => !isDeleted(row) && field(row, ["name"])));
      setCustomers(mergeLocalRows("customers", customerRows).filter((row) => !isDeleted(row) && field(row, ["name"])));
      setBills(dedupeBillsForDisplay(mergeLocalRows("bills", billRows).filter((row) => !isDeleted(row))));
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const matched = (row: AnyRow, keys: string[]) => !q || keys.some((key) => field(row, [key]).toLowerCase().includes(q));

    const productItems: PaletteItem[] = products
      .filter((row) => matched(row, ["name", "barcode", "sku", "category"]))
      .slice(0, MAX_PER_GROUP)
      .map((row) => ({
        kind: "product",
        id: field(row, ["id"]),
        title: field(row, ["name"]),
        subtitle: field(row, ["category"]) || undefined,
        route: "/products",
      }));

    const customerItems: PaletteItem[] = customers
      .filter((row) => matched(row, ["name", "mobile", "phone"]))
      .slice(0, MAX_PER_GROUP)
      .map((row) => ({
        kind: "customer",
        id: field(row, ["id"]),
        title: field(row, ["name"]),
        subtitle: field(row, ["mobile", "phone"]) || undefined,
        route: `/customers/${field(row, ["id"])}`,
      }));

    const billItems: PaletteItem[] = bills
      .filter((row) => matched(row, ["billNumber", "billNo", "number", "customerName", "customer_name"]))
      .slice(0, MAX_PER_GROUP)
      .map((row) => ({
        kind: "bill",
        id: field(row, ["id", "server_id", "local_id"]),
        title: field(row, ["billNumber", "billNo", "number"]) || "Bill",
        subtitle: [field(row, ["customerName", "customer_name"]) || "Walk-in", money(row.grandTotal ?? row.totalAmount ?? row.netAmount)]
          .filter(Boolean)
          .join(" · "),
        route: `/bills/${field(row, ["id", "server_id", "local_id"])}`,
      }));

    return [...productItems, ...customerItems, ...billItems].filter((item) => item.id);
  }, [query, products, customers, bills]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    setLocation(item.route);
    if (item.kind === "product") {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("kirana:voice-product-search", {
          detail: { query: item.title, target: "product", sourceCommand: "command-palette" },
        }));
      }, 100);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[14px] border border-[#e2e8f0] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 border-b border-[#eef2f8] px-4">
          <Search size={17} className="text-[#64748b]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, items.length - 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
              else if (event.key === "Enter") { event.preventDefault(); go(items[active]); }
              else if (event.key === "Escape") { event.preventDefault(); onClose(); }
            }}
            placeholder="Search products, customers, bills…"
            className="h-12 flex-1 bg-transparent text-[14px] text-[var(--brand-ink)] outline-none placeholder:text-[#94a3b8]"
            aria-label="Search products, customers and bills"
          />
          <button onClick={onClose} className="rounded-md p-1 text-[#94a3b8] hover:bg-[#f1f4f8] hover:text-[var(--brand-ink)]" aria-label="Close search">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[#94a3b8]">
              {query.trim() ? "No matches in your local records." : "Type to search your shop’s products, customers, and bills."}
            </p>
          ) : (
            items.map((item, index) => {
              const Icon = item.kind === "product" ? Package : item.kind === "customer" ? Users : ReceiptText;
              return (
                <button
                  key={`${item.kind}_${item.id}_${index}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    index === active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--brand-softer)]",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-[8px]",
                      item.kind === "product" ? "bg-[#eef6ff] text-[var(--brand)]" : item.kind === "customer" ? "bg-[#ecfdf5] text-[#059669]" : "bg-[#fef3c7] text-[#b45309]",
                    )}
                  >
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--brand-ink)]">{item.title}</span>
                    {item.subtitle && <span className="block truncate text-[11px] text-[#64748b]">{item.subtitle}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">{item.kind}</span>
                  {index === active && <CornerDownLeft size={14} className="shrink-0 text-[#94a3b8]" aria-hidden="true" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
