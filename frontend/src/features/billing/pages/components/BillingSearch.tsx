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
  if (t.match(/oil|ghee|dalda|vanaspati|sunlite|fortune/)) return "🫙";
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
    <div className="flex h-full flex-col gap-3.5 overflow-hidden">

      {/* ── Offline / draft banners ── */}
      {!isOnline && (
        <div className="shrink-0 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
          Offline — changes save locally and sync when back online.
        </div>
      )}
      {draftRestored && (
        <div className="shrink-0 rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
            <span>Draft restored ({cartLength} item{cartLength !== 1 ? "s" : ""})</span>
            <button onClick={onHideDraftRestored} className="ml-auto text-blue-500 hover:underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── 1. Product Browser Card ── */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[15px] border border-[#e6ecf4] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.045)]">

        {/* Top section: search + recent products */}
        <div className="shrink-0 px-4 pt-4">
          <div className="flex items-start gap-4">

            {/* Search box */}
            <div className="min-w-0 flex-1">
              <div className="relative flex h-12 items-center gap-3 rounded-[10px] border border-[#e3eaf3] bg-[#f8fafd] px-4 transition-colors focus-within:border-[#0057ff] focus-within:bg-white">
                <Search size={16} className="shrink-0 text-[#6b7a9a]" aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  data-testid="input-product-search"
                  className="h-full flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#0f2147] placeholder:font-medium placeholder:text-[#6b7a9a] focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Search by product name, barcode or SKU"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
                <kbd className="ml-auto flex shrink-0 items-center gap-1 rounded-[6px] border border-[#e1e8f2] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#45577a]">
                  ⌘ K
                </kbd>
              </div>
              {/* Scan + Voice */}
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#6b7a9a] transition-colors hover:text-[#0057ff]"
                >
                  <ScanLine size={13} aria-hidden="true" />
                  Scan barcode
                </button>
                <span className="text-[#d5dde8] select-none">|</span>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[#6b7a9a] transition-colors hover:text-[#0057ff]"
                >
                  <Mic size={13} aria-hidden="true" />
                  Voice
                </button>
              </div>
            </div>

            {/* Recent products — its own bordered box */}
            {recentProducts.length > 0 && !search && (
              <div className="hidden shrink-0 rounded-[10px] border border-[#e6ecf4] bg-[#fafbfe] px-3 py-2 lg:block">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#536383]">Recent Products</p>
                <div className="flex items-center gap-2.5">
                  {recentProducts.slice(0, 3).map((p) => {
                    const price = productSellingPrice(p, 1);
                    const color = productPlaceholderColor(p.name);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onAddProduct(p)}
                        className="flex min-w-[104px] items-center gap-2 rounded-lg border border-transparent bg-white px-2 py-1.5 shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition-all hover:border-[#cfe0ff]"
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg ${color}`}>
                          {getProductEmoji(p.name, p.category)}
                        </span>
                        <div className="min-w-0 text-left">
                          <p className="truncate text-[10.5px] font-extrabold leading-[1.15] text-[#14284e]">
                            {p.name.split(" ")[0]}
                          </p>
                          <p className="mt-0.5 text-[11px] font-black text-[#14284e]">₹{price}</p>
                        </div>
                      </button>
                    );
                  })}
                  {recentProducts.length > 3 && (
                    <button className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e7edf5] bg-white shadow-[0_5px_12px_rgba(15,23,42,0.05)] transition-colors hover:bg-[#f7f9fd]">
                      <ChevronRight size={13} className="text-[#536383]" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Category chips — rounded-[8px] matching spec */}
          <div className="mt-[18px] flex items-center gap-2.5 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none]">
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
              <button className="shrink-0 h-[34px] rounded-[8px] border border-[#e1e8f2] bg-white px-4 text-[12px] font-bold text-[#23365f] transition-colors hover:bg-[#f7f9fd]">
                More ▾
              </button>
            )}
          </div>
        </div>

        {/* Product grid — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {productsLoading && filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#536383]">
              <Search size={22} className="animate-pulse text-[#0057ff]/60" />
              <p className="text-sm">Loading products…</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#f7f9fd] text-2xl text-[#536383]">?</span>
              <div>
                <p className="text-sm font-bold text-[#13274d]">
                  {search ? `No results for "${search}"` : "No products yet"}
                </p>
                <p className="mt-1 text-xs text-[#536383]">
                  {search ? "Try a different term or clear search." : "Add products from the Products page."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {search && (
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#536383]">
                  {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""}
                </p>
              )}

              {/* 5-column grid */}
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
                {displayedProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAdd={() => onAddProduct(product)}
                  />
                ))}
              </div>

              {/* View all products */}
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="flex h-[34px] w-[176px] items-center justify-center gap-2 rounded-[8px] border border-[#dfe8f5] bg-white text-[12px] font-extrabold text-[#0057ff] transition-colors hover:bg-[#f5f9ff]"
                >
                  {showAll ? (
                    <>Show less <ChevronUp size={13} /></>
                  ) : (
                    <>View all products <ChevronDown size={13} /></>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 2. Bottom 3-column info section — Recent Bills widest, Quick Actions narrowest, Billing Tips medium ── */}
      {!search && (
        <div className="shrink-0 grid grid-cols-[1.45fr_0.95fr_1.15fr] gap-3.5" style={{ height: "260px" }}>
          <RecentBillsPanel />
          <QuickActionsPanel onHoldBill={onHoldBill} />
          <BillingTipsPanel />
        </div>
      )}

      {/* ── 3. Order Summary Card ── */}
      {cartItemCount > 0 && (
        <div className="shrink-0 flex items-center rounded-[13px] border border-[#e6ecf4] bg-white px-[22px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]" style={{ height: "86px" }}>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[12px] font-bold text-[#5b6b89]">Order Summary</p>
            <div className="flex items-center gap-[30px]">
              {/* Items */}
              <div className="flex items-center gap-2.5">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-blue-50">
                  <ReceiptText size={14} className="text-[#0057ff]" />
                </span>
                <div>
                  <p className="text-[13px] font-black text-[#13274d]">
                    {cartItemCount} {cartItemCount === 1 ? "Item" : "Items"}
                  </p>
                  <p className="text-[10px] text-[#7a89a3]">Products</p>
                </div>
              </div>
              {/* Subtotal */}
              <div className="flex items-center gap-2.5">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-emerald-50 text-[13px] font-black text-emerald-600">
                  ₹
                </span>
                <div>
                  <p className="text-[13px] font-black text-[#13274d]">
                    ₹{cartSubtotal.toLocaleString("en-IN")}
                  </p>
                  <p className="text-[10px] text-[#7a89a3]">Subtotal</p>
                </div>
              </div>
              {/* Tax */}
              {cartTax > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-purple-50 text-xs font-black text-purple-600">
                    %
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-[#13274d]">
                      ₹{(Math.round(cartTax * 100) / 100).toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] text-[#7a89a3]">Tax (5%)</p>
                  </div>
                </div>
              )}
              {/* Discount */}
              {cartDiscount > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-amber-50 text-xs font-black text-amber-600">
                    −
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-emerald-600">
                      −₹{cartDiscount.toLocaleString("en-IN")}
                    </p>
                    <p className="text-[10px] text-[#7a89a3]">Discount</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Grand total — right aligned */}
          <div className="ml-auto shrink-0 text-right">
            <p className="font-display text-[22px] font-black tracking-tight text-[#0f1e3d]">
              ₹{cartGrandTotal.toLocaleString("en-IN")}
            </p>
            <p className="mt-1 text-[12px] font-semibold text-[#536383]">Grand Total</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Product card — spec: 176px height, absolute price + add button ─── */
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
      className="group relative h-[176px] overflow-hidden rounded-[10px] border border-[#e5ebf4] bg-white p-[12px_10px_44px] text-left transition-all duration-150 hover:-translate-y-px hover:border-[#bcd0ff] hover:shadow-[0_10px_24px_rgba(15,23,42,0.07)]"
    >
      {/* Image area — 72px */}
      <div className={`relative mb-[9px] flex h-[72px] items-center justify-center overflow-hidden rounded-lg ${color}`}>
        <span className="text-3xl leading-none" aria-hidden="true">{emoji}</span>
        {stock <= 0 ? (
          <span className="absolute bottom-1 right-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">Out</span>
        ) : stock <= 5 ? (
          <span className="absolute bottom-1 right-1 rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">Low</span>
        ) : null}
      </div>

      {/* Name + unit */}
      <p className="line-clamp-2 min-h-[31px] text-[12px] font-extrabold leading-[1.25] text-[#14284e]">
        {product.name}
      </p>
      {product.category && (
        <p className="mt-0.5 truncate text-[11px] font-medium text-[#687895]">{product.category}</p>
      )}

      {/* Price — absolute bottom-left */}
      <span className="absolute bottom-[13px] left-2.5 text-[14px] font-black text-[#0f1e3d]">
        ₹{price}
        <span className="text-[10px] font-medium text-[#687895]">/{unit}</span>
      </span>

      {/* Add button — absolute bottom-right, rounded-[8px] matching spec */}
      <span className="absolute bottom-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-[8px] border border-[#dfe8f5] bg-white text-lg font-bold text-[#0057ff] transition-transform group-hover:scale-110">
        +
      </span>
    </button>
  );
}

/* ─── Category chip — rounded-[8px] per spec ─── */
function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-[34px] rounded-[8px] border px-4 text-[12px] font-bold transition-all ${
        active
          ? "border-[#0057ff] bg-[#0057ff] text-white shadow-[0_8px_16px_rgba(0,87,255,0.2)]"
          : "border-[#e1e8f2] bg-white text-[#23365f] hover:bg-[#f7f9fd]"
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
    if (label === "UPI") return "bg-[#eef4ff] text-[#2563eb]";
    if (label === "Udhar") return "bg-amber-50 text-amber-700";
    if (label === "Bank") return "bg-blue-50 text-blue-700";
    if (label === "Card") return "bg-[#f3e8ff] text-[#7c3aed]";
    return "bg-[#e9fff0] text-[#16a34a]";
  }

  return (
    <div className="h-full overflow-hidden rounded-[13px] border border-[#e6ecf4] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-[14px] flex items-center justify-between">
        <h3 className="font-display text-[14px] font-black tracking-tight text-[#13274d]">Recent Bills</h3>
        <Link
          to="/bills"
          className="flex items-center gap-0.5 text-[12px] font-extrabold text-[#0057ff] hover:underline"
        >
          View all <ChevronRight size={12} />
        </Link>
      </div>

      {bills.length === 0 ? (
        <p className="py-4 text-center text-xs text-[#536383]">No bills today yet</p>
      ) : (
        <div className="space-y-0">
          {bills.map((bill, i) => {
            const billNo = bill.billNo ?? bill.billNumber ?? `#${i + 1}`;
            const time = bill.createdAt
              ? new Date(bill.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
              : "";
            const amount = bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0;
            const customer =
              bill.customerName && bill.customerName !== "Walk-in" ? bill.customerName : "Walk-in";
            const pmtLabel = paymentLabel(bill);

            return (
              <div
                key={billNo + i}
                className="flex h-[38px] items-center gap-2 text-[11px]"
              >
                <span className="w-[70px] shrink-0 truncate font-extrabold text-[#13274d]">{billNo}</span>
                <span className="w-[60px] shrink-0 font-semibold text-[#6d7c98]">{time}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-[#6d7c98]">{customer}</span>
                <span className="shrink-0 text-right font-black text-[#13274d] tabular-nums">
                  ₹{amount.toLocaleString("en-IN")}
                </span>
                <span className={`shrink-0 inline-flex h-[22px] items-center justify-center rounded-[7px] px-2 text-[10px] font-extrabold ${badgeClass(pmtLabel)}`}>
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
function QuickActionsPanel({ onHoldBill }: { onHoldBill: () => void }) {
  const actions = [
    {
      iconEl: <Zap size={15} />,
      iconBg: "bg-[#e9fff0] text-[#16a34a]",
      title: "Apply Discount",
      description: "Give flat or % discount",
      hint: "F4",
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <Ticket size={15} />,
      iconBg: "bg-[#f3e8ff] text-[#7c3aed]",
      title: "Coupons",
      description: "Apply promo code",
      hint: null as string | null,
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <Users size={15} />,
      iconBg: "bg-[#fff3e4] text-[#f97316]",
      title: "Recent Customers",
      description: "Select from history",
      hint: null as string | null,
      onClick: undefined as (() => void) | undefined,
    },
    {
      iconEl: <PauseCircle size={15} />,
      iconBg: "bg-[#eef4ff] text-[#2563eb]",
      title: "Hold Current Bill",
      description: "Save and resume later",
      hint: "F9",
      onClick: onHoldBill,
    },
  ];

  return (
    <div className="h-full overflow-hidden rounded-[13px] border border-[#e6ecf4] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <h3 className="mb-[14px] font-display text-[14px] font-black tracking-tight text-[#13274d]">Quick Actions</h3>
      <div className="space-y-0">
        {actions.map((action) => (
          <button
            key={action.title}
            onClick={action.onClick}
            className="flex h-[48px] w-full items-center gap-3 rounded-lg px-1 text-left transition-colors hover:bg-[#f7f9fd]"
          >
            <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] ${action.iconBg}`}>
              {action.iconEl}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-extrabold text-[#13274d]">{action.title}</p>
              <p className="text-[10.5px] text-[#6d7c98]">{action.description}</p>
            </div>
            {action.hint && (
              <kbd className="shrink-0 inline-flex h-[22px] min-w-[28px] items-center justify-center rounded-[7px] border border-[#e1e8f2] bg-[#f4f7fb] px-2 text-[10px] font-extrabold text-[#536383]">
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
    <div className="h-full overflow-hidden rounded-[13px] border border-[#e6ecf4] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-[14px] flex items-center gap-2">
        <h3 className="font-display text-[14px] font-black tracking-tight text-[#13274d]">Billing Tips</h3>
        <Clock size={13} className="text-[#536383]" />
      </div>
      <div className="space-y-0">
        {tips.map((tip) => (
          <div key={tip.key} className="flex min-h-[32px] items-center gap-2 text-[11px] font-semibold text-[#5d6f8d]">
            <span className="h-[13px] w-[13px] shrink-0 text-[#16a34a]">✓</span>
            <span>
              {tip.action}{" "}
              <span className="inline-flex h-5 min-w-[26px] items-center justify-center rounded-[5px] bg-[#edf4ff] px-1.5 text-[10px] font-black text-[#0057ff]">
                {tip.key}
              </span>{" "}
              {tip.detail}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-[18px] flex justify-center">
        <button className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#0057ff] hover:underline">
          View all shortcuts <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
