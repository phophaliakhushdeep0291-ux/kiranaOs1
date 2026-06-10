import { useState, type RefObject } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Clock, ScanLine, Search, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useListBills } from "@/features/bills/queries";
import type { Bill, Product } from "@/lib/api/client";
import { productSellingPrice } from "../billing-calculations";
import { BillingDraftRestore } from "./BillingDraftRestore";
import { SyncBadge } from "@/components/shared";

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
  onAddProduct: (product: Product) => void;
  categories: string[];
  selectedCategory: string;
  onSelectedCategoryChange: (category: string) => void;
  recentProducts: Product[];
  voiceVisible: boolean;
  onToggleVoice: () => void;
  onHoldBill: () => void;
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
  onAddProduct,
  categories,
  selectedCategory,
  onSelectedCategoryChange,
  recentProducts,
  voiceVisible,
  onToggleVoice,
  onHoldBill,
}: BillingSearchProps) {
  const [showAll, setShowAll] = useState(false);
  const displayedProducts = showAll ? filteredProducts : filteredProducts.slice(0, 10);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Sticky header ── */}
      <div className="shrink-0 border-b bg-card/95 px-4 pb-3 pt-3 shadow-sm backdrop-blur">
        {!isOnline && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
            <SyncBadge status="offline" label="Offline" />
            <span>Billing continues offline.</span>
          </div>
        )}

        <BillingDraftRestore
          draftRestored={draftRestored}
          cartLength={cartLength}
          onHideDraftRestored={onHideDraftRestored}
        />

        {/* Search + Recent Products strip */}
        <div className="flex items-end gap-4">
          {/* Search */}
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={searchInputRef}
              data-testid="input-product-search"
              className="h-11 rounded-xl border-2 bg-background pl-10 pr-24 font-medium transition-colors focus-visible:border-primary focus-visible:ring-0"
              placeholder="Search by product name, barcode or SKU"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline">
                ⌘ K
              </kbd>
              <ScanLine size={15} className="text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          {/* Recent Products */}
          {recentProducts.length > 0 && !search && (
            <div className="hidden shrink-0 lg:block">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recent Products
              </p>
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
                {recentProducts.slice(0, 5).map((p) => {
                  const price = productSellingPrice(p, 1);
                  const color = productPlaceholderColor(p.name);
                  return (
                    <button
                      key={p.id}
                      onClick={() => onAddProduct(p)}
                      className="flex w-[92px] shrink-0 flex-col items-center gap-1 rounded-xl border bg-card p-2 transition-all hover:border-primary/50 hover:shadow-sm active:scale-[0.97]"
                    >
                      <span
                        className={`grid h-8 w-full place-items-center rounded-lg text-sm font-black ${color}`}
                      >
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                      <p className="line-clamp-1 w-full text-center text-[11px] font-semibold leading-tight">
                        {p.name.split(" ")[0]}
                      </p>
                      <span className="text-[11px] font-black text-primary">₹{price}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Category chips */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
          <CategoryChip
            label="All"
            active={selectedCategory === "all"}
            onClick={() => onSelectedCategoryChange("all")}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              active={selectedCategory === cat}
              onClick={() => onSelectedCategoryChange(cat)}
            />
          ))}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {productsLoading && filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Zap size={22} className="animate-pulse text-primary/60" />
            <p className="text-sm">Loading products…</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-2xl font-black text-muted-foreground">
              ?
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {search ? `No results for "${search}"` : "No products yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search
                  ? "Try a different term or clear search."
                  : "Add products from the Products page."}
              </p>
            </div>
          </div>
        ) : (
          <>
            {search && (
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""}
              </p>
            )}

            {/* Product grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {displayedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={() => onAddProduct(product)}
                />
              ))}
            </div>

            {/* View all / collapse */}
            {filteredProducts.length > 10 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {showAll ? (
                  <>
                    <ChevronUp size={14} /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} /> View all products ({filteredProducts.length})
                  </>
                )}
              </button>
            )}
          </>
        )}

        {/* Bottom info panels */}
        {!search && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <RecentBillsPanel />
            <QuickActionsPanel onHoldBill={onHoldBill} onToggleVoice={onToggleVoice} />
            <BillingTipsPanel />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Product card ─── */
function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const price = productSellingPrice(product, 1);
  const unit = product.rateUnit ?? product.displayUnit ?? "pc";
  const stock = product.stockBaseQty ?? 0;
  const color = productPlaceholderColor(product.name);

  return (
    <button
      data-testid={`product-card-${product.id}`}
      onClick={onAdd}
      className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-2.5 text-left shadow-xs transition-all duration-150 hover:border-primary/40 hover:shadow-md active:scale-[0.97]"
    >
      {/* Image placeholder */}
      <div
        className={`relative flex h-20 w-full items-center justify-center overflow-hidden rounded-lg text-xl font-black ${color}`}
      >
        {product.name.slice(0, 2).toUpperCase()}
        {stock <= 0 ? (
          <span className="absolute bottom-1 right-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">
            Out
          </span>
        ) : stock <= 5 ? (
          <span className="absolute bottom-1 right-1 rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">
            Low
          </span>
        ) : null}
      </div>

      {/* Name + category */}
      <div className="min-w-0 w-full">
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
          {product.name}
        </p>
        {product.category && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{product.category}</p>
        )}
      </div>

      {/* Price + add */}
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-sm font-black text-foreground">
          ₹{price}
          <span className="text-[10px] font-normal text-muted-foreground">/{unit}</span>
        </span>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[13px] font-black text-primary-foreground shadow-sm transition-transform group-hover:scale-110">
          +
        </span>
      </div>
    </button>
  );
}

/* ─── Category chip ─── */
function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

/* ─── Recent Bills panel ─── */
function RecentBillsPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: result } = useListBills(
    { from: today, to: today, limit: 6 },
    { query: { staleTime: 30_000 } },
  );
  const bills: Bill[] = Array.isArray(result)
    ? result
    : (result as { entries?: Bill[] } | undefined)?.entries ?? [];

  function paymentLabel(bill: Bill): string {
    const payments = bill.payments as Array<{ mode?: string }> | undefined;
    const billAny = bill as { paymentMode?: string };
    const mode = payments?.[0]?.mode ?? billAny.paymentMode ?? null;
    if (!mode || mode === "cash") return "Cash";
    if (mode === "upi") return "UPI";
    if (mode === "credit") return "Udhar";
    if (mode === "bank") return "Bank";
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  function badgeClass(label: string): string {
    if (label === "UPI") return "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400";
    if (label === "Udhar") return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400";
    if (label === "Bank") return "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400";
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400";
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">Recent Bills</h3>
        <Link
          to="/bills"
          className="flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
        >
          View all <ChevronRight size={12} />
        </Link>
      </div>

      {bills.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No bills today yet</p>
      ) : (
        <div className="space-y-1">
          {bills.map((bill, i) => {
            const billNo = bill.billNo ?? bill.billNumber ?? `#${i + 1}`;
            const time = bill.createdAt
              ? new Date(bill.createdAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            const amount = bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0;
            const customer =
              bill.customerName && bill.customerName !== "Walk-in"
                ? bill.customerName
                : "Walk-in Customer";
            const pmtLabel = paymentLabel(bill);

            return (
              <div
                key={billNo + i}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/60"
              >
                <span className="w-14 shrink-0 truncate font-mono text-[11px] font-bold text-foreground">
                  {billNo}
                </span>
                <span className="w-12 shrink-0 text-[10px] text-muted-foreground">{time}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{customer}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  ₹{amount.toLocaleString("en-IN")}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeClass(pmtLabel)}`}>
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
function QuickActionsPanel({ onHoldBill, onToggleVoice }: { onHoldBill: () => void; onToggleVoice: () => void }) {
  const actions = [
    { icon: "🏷️", title: "Apply Discount", description: "Give flat or % discount", hint: "F4", onClick: undefined },
    { icon: "🎟️", title: "Coupons", description: "Apply promo code", hint: null, onClick: undefined },
    { icon: "🎙️", title: "Voice Billing", description: "Speak items to add", hint: null, onClick: onToggleVoice },
    { icon: "⏸️", title: "Hold Current Bill", description: "Save and resume later", hint: "F9", onClick: onHoldBill },
  ];

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold">Quick Actions</h3>
      <div className="space-y-1">
        {actions.map((action) => (
          <button
            key={action.title}
            onClick={action.onClick}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <span className="text-base leading-none">{action.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">{action.title}</p>
              <p className="text-[10px] text-muted-foreground">{action.description}</p>
            </div>
            {action.hint && (
              <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
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
  const tips = [
    { action: "Scan barcode or press F2", detail: "to search fast" },
    { action: "Use F4", detail: "to apply discount" },
    { action: "Use F6", detail: "to add customer" },
    { action: "Use F9", detail: "to hold the bill" },
    { action: "Press Ctrl+S", detail: "to save bill" },
  ];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-bold">Billing Tips</h3>
        <Clock size={13} className="text-muted-foreground" />
      </div>
      <div className="space-y-2">
        {tips.map((tip) => (
          <div key={tip.action} className="flex items-start gap-1.5 text-xs">
            <span className="mt-0.5 font-bold text-primary">✓</span>
            <span>
              <span className="font-semibold text-foreground">{tip.action}</span>{" "}
              <span className="text-muted-foreground">{tip.detail}</span>
            </span>
          </div>
        ))}
      </div>
      <button className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        View all shortcuts <ChevronRight size={12} />
      </button>
    </div>
  );
}
