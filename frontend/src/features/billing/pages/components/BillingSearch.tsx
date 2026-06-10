import { useState, type RefObject } from "react";
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
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useListBills } from "@/features/bills/queries";
import type { Bill, Product } from "@/lib/api/client";
import { productSellingPrice } from "../billing-calculations";
import { BillingDraftRestore } from "./BillingDraftRestore";

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
  if (t.match(/oil|ghee|dalda|vanaspati|sunflite|fortune/)) return "🫙";
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
  /* order summary bar */
  cartItemCount: number;
  cartSubtotal: number;
  cartTax: number;
  cartDiscount: number;
  cartGrandTotal: number;
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
  onHoldBill,
  cartItemCount,
  cartSubtotal,
  cartTax,
  cartDiscount,
  cartGrandTotal,
}: BillingSearchProps) {
  const [showAll, setShowAll] = useState(false);
  const displayedProducts = showAll ? filteredProducts : filteredProducts.slice(0, 10);
  const visibleCategories = categories.slice(0, CATEGORY_LIMIT);
  const hasMoreCategories = categories.length > CATEGORY_LIMIT;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
          Offline — changes save locally and sync when back online.
        </div>
      )}

      {/* ── Draft restored banner ── */}
      {draftRestored && (
        <div className="shrink-0 border-b bg-blue-50 px-4 py-2 dark:bg-blue-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <span>Draft restored ({cartLength} item{cartLength !== 1 ? "s" : ""})</span>
            <button
              onClick={onHideDraftRestored}
              className="ml-auto text-blue-500 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky header: Search + Recent Products ── */}
      <div className="shrink-0 border-b bg-background px-4 pb-3 pt-4">
        <div className="flex items-start gap-4">

          {/* Left: Search input + barcode scan button */}
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={searchInputRef}
                data-testid="input-product-search"
                className="h-11 rounded-xl border-2 bg-background pl-9 pr-16 font-medium transition-colors focus-visible:border-primary focus-visible:ring-0"
                placeholder="Search by product name, barcode or SKU"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
              <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
                ⌘ K
              </kbd>
            </div>
            {/* Scan + Voice buttons below search */}
            <div className="mt-1.5 flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ScanLine size={13} aria-hidden="true" />
                Scan barcode
              </button>
              <span className="text-muted-foreground/30 select-none">|</span>
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Mic size={13} aria-hidden="true" />
                Voice
              </button>
            </div>
          </div>

          {/* Right: Recent Products */}
          {recentProducts.length > 0 && !search && (
            <div className="hidden shrink-0 lg:block">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recent Products
              </p>
              <div className="flex items-center gap-2">
                {recentProducts.slice(0, 3).map((p) => {
                  const price = productSellingPrice(p, 1);
                  const color = productPlaceholderColor(p.name);
                  return (
                    <button
                      key={p.id}
                      onClick={() => onAddProduct(p)}
                      className="flex w-[80px] shrink-0 flex-col items-center gap-1 rounded-xl border bg-card p-2 text-center transition-all hover:border-primary/50 hover:shadow-sm active:scale-[0.97]"
                    >
                      <span className={`grid h-9 w-full place-items-center rounded-lg text-xl ${color}`}>
                        {getProductEmoji(p.name, undefined)}
                      </span>
                      <p className="line-clamp-1 w-full text-[10px] font-semibold leading-tight">
                        {p.name.split(" ")[0]}
                      </p>
                      <span className="text-[11px] font-bold text-primary">₹{price}</span>
                    </button>
                  );
                })}
                {recentProducts.length > 3 && (
                  <button className="flex h-[76px] w-7 flex-col items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted">
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Category chips — pill style matching reference */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
          <CategoryChip
            label="All"
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
            <button className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted">
              More ▾
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {productsLoading && filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Search size={22} className="animate-pulse text-primary/60" />
            <p className="text-sm">Loading products…</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-2xl text-muted-foreground">
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
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-5">
              {displayedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={() => onAddProduct(product)}
                />
              ))}
            </div>

            {/* View all products button — always visible */}
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
            >
              {showAll ? (
                <>
                  <ChevronUp size={13} aria-hidden="true" /> Show less
                </>
              ) : (
                <>
                  View all products
                  {filteredProducts.length > 10 && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {filteredProducts.length}
                    </span>
                  )}
                  <ChevronDown size={13} aria-hidden="true" />
                </>
              )}
            </button>
          </>
        )}

        {/* ── Bottom 3-column info section ── */}
        {!search && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <RecentBillsPanel />
            <QuickActionsPanel onHoldBill={onHoldBill} />
            <BillingTipsPanel />
          </div>
        )}
      </div>

      {/* ── Order Summary sticky bar ── */}
      {cartItemCount > 0 && (
        <div className="shrink-0 border-t bg-background/95 px-4 py-2">
          <div className="flex items-center gap-4">
            {/* Items count */}
            <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <ReceiptText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              {cartItemCount} {cartItemCount === 1 ? "Item" : "Items"}
            </span>
            {/* Divider */}
            <span className="text-muted-foreground/30">|</span>
            {/* Subtotal */}
            <span className="text-xs text-muted-foreground">
              Subtotal&nbsp;<strong className="font-semibold text-foreground">₹{cartSubtotal.toLocaleString("en-IN")}</strong>
            </span>
            {/* Tax */}
            {cartTax > 0 && (
              <>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-xs text-muted-foreground">
                  Tax (5%)&nbsp;<strong className="font-semibold text-foreground">₹{(Math.round(cartTax * 100) / 100).toLocaleString("en-IN")}</strong>
                </span>
              </>
            )}
            {/* Discount */}
            {cartDiscount > 0 && (
              <>
                <span className="text-muted-foreground/30">|</span>
                <span className="text-xs text-muted-foreground">
                  Discount&nbsp;<strong className="font-semibold text-emerald-600">−₹{cartDiscount.toLocaleString("en-IN")}</strong>
                </span>
              </>
            )}
            {/* Grand Total — right aligned */}
            <div className="ml-auto flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Grand Total</span>
              <span className="text-base font-black text-foreground">₹{cartGrandTotal.toLocaleString("en-IN")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Product card ─── */
function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const price = productSellingPrice(product, 1);
  const unit = product.rateUnit ?? product.displayUnit ?? "pc";
  const stock = product.stockBaseQty ?? 0;
  const color = productPlaceholderColor(product.name);
  const emoji = getProductEmoji(product.name, product.category);

  return (
    <button
      data-testid={`product-card-${product.id}`}
      onClick={onAdd}
      className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-2.5 text-left shadow-sm transition-all duration-150 hover:border-primary/40 hover:shadow-md active:scale-[0.97]"
    >
      {/* Image area — blank/emoji placeholder */}
      <div
        className={`relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg ${color}`}
      >
        <span className="text-4xl leading-none" aria-hidden="true">{emoji}</span>
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

      {/* Product name */}
      <div className="min-w-0 w-full">
        <p className="line-clamp-2 text-xs font-bold leading-snug text-foreground">
          {product.name}
        </p>
        {product.category && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{product.category}</p>
        )}
      </div>

      {/* Price + add button */}
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-sm font-bold text-foreground">
          ₹{price}
          <span className="text-[10px] font-normal text-muted-foreground">/{unit}</span>
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground shadow-sm transition-transform group-hover:scale-110">
          +
        </span>
      </div>
    </button>
  );
}

/* ─── Category chip — pill style matching reference ─── */
function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors ${
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
    if (mode === "card") return "Card";
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  function badgeClass(label: string): string {
    if (label === "UPI") return "bg-purple-100 text-purple-700";
    if (label === "Udhar") return "bg-amber-100 text-amber-700";
    if (label === "Bank") return "bg-blue-100 text-blue-700";
    if (label === "Card") return "bg-slate-100 text-slate-700";
    return "bg-emerald-100 text-emerald-700";
  }

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-bold">Recent Bills</h3>
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

/* ─── Quick Actions panel — matches reference icons ─── */
function QuickActionsPanel({ onHoldBill }: { onHoldBill: () => void }) {
  const actions = [
    {
      iconEl: <Zap size={14} className="text-yellow-600" />,
      iconBg: "bg-yellow-100",
      title: "Apply Discount",
      description: "Give flat or % discount",
      hint: "F4",
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <Ticket size={14} className="text-purple-600" />,
      iconBg: "bg-purple-100",
      title: "Coupons",
      description: "Apply promo code",
      hint: null as string | null,
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <Users size={14} className="text-orange-600" />,
      iconBg: "bg-orange-100",
      title: "Recent Customers",
      description: "Select from history",
      hint: null as string | null,
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <PauseCircle size={14} className="text-blue-600" />,
      iconBg: "bg-blue-100",
      title: "Hold Current Bill",
      description: "Save and resume later",
      hint: "F9",
      onClick: onHoldBill,
    },
  ];

  return (
    <div className="rounded-xl border bg-card p-3">
      <h3 className="mb-2.5 text-xs font-bold">Quick Actions</h3>
      <div className="space-y-1">
        {actions.map((action) => (
          <button
            key={action.title}
            onClick={action.onClick}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${action.iconBg}`}
            >
              {action.iconEl}
            </span>
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
    { action: "Scan barcode or press", key: "F2", detail: "to search fast" },
    { action: "Use", key: "F4", detail: "to apply discount" },
    { action: "Use", key: "F6", detail: "to add customer" },
    { action: "Use", key: "F9", detail: "to hold the bill" },
    { action: "Press", key: "Ctrl + S", detail: "to save bill" },
  ];

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="text-xs font-bold">Billing Tips</h3>
        <Clock size={13} className="text-muted-foreground" />
      </div>
      <div className="space-y-2">
        {tips.map((tip) => (
          <div key={tip.key} className="flex items-start gap-1.5 text-xs">
            <span className="mt-0.5 font-bold text-primary">✓</span>
            <span className="text-muted-foreground">
              {tip.action}{" "}
              <span className="font-semibold text-foreground">{tip.key}</span>{" "}
              {tip.detail}
            </span>
          </div>
        ))}
        <button className="mt-1 flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">
          View all shortcuts <ChevronRight size={11} />
        </button>
      </div>
    </div>
  );
}
