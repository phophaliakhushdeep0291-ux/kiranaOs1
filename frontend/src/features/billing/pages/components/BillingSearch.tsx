import type { RefObject } from "react";
import { Mic, Package, Plus, ScanLine, Search, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Product } from "@/lib/api/client";
import { productSellingPrice } from "../billing-calculations";
import { BillingDraftRestore } from "./BillingDraftRestore";
import { SyncBadge } from "@/components/shared";

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
  voiceVisible: boolean;
  onToggleVoice: () => void;
}

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
  voiceVisible,
  onToggleVoice,
}: BillingSearchProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 space-y-3 border-b bg-card/95 p-3 shadow-sm backdrop-blur sm:p-4">
        {!isOnline && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
            <SyncBadge status="offline" label="Offline" />
            <span>Billing continues offline — data saved locally.</span>
          </div>
        )}

        <BillingDraftRestore
          draftRestored={draftRestored}
          cartLength={cartLength}
          onHideDraftRestored={onHideDraftRestored}
        />

        {/* Search bar */}
        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            data-testid="input-product-search"
            className="h-12 rounded-xl border-2 bg-background pl-11 pr-28 text-base font-semibold transition-colors focus-visible:border-primary focus-visible:ring-0"
            placeholder="Search product, barcode or alias…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            <button
              onClick={onToggleVoice}
              className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                voiceVisible
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              title={voiceVisible ? "Hide voice panel" : "Voice billing"}
              aria-pressed={voiceVisible}
            >
              <Mic size={14} />
            </button>
            <ScanLine size={16} className="text-muted-foreground" aria-hidden="true" />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline">
              F2
            </kbd>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
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

      {/* Product grid (scrollable) */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        {productsLoading && filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <Zap size={24} className="animate-pulse text-primary/50" />
            <p className="text-sm">Loading products…</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Package size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">No products found</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {search
                  ? "Try a different search or clear to browse all."
                  : "Add products from the Products page first."}
              </p>
            </div>
          </div>
        ) : (
          <>
            {search.length > 0 && (
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={() => onAddProduct(product)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: () => void;
}) {
  const price = productSellingPrice(product, 1);
  const unit = product.rateUnit ?? product.displayUnit ?? "pc";
  const stock = product.stockBaseQty ?? 0;

  return (
    <button
      data-testid={`product-card-${product.id}`}
      onClick={onAdd}
      className="group relative flex flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition-all duration-150 hover:border-primary/50 hover:shadow-md active:scale-[0.97]"
    >
      {/* Icon + add button row */}
      <div className="flex w-full items-start justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Package size={16} aria-hidden="true" />
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <Plus size={13} aria-hidden="true" />
        </span>
      </div>

      {/* Name + category */}
      <div className="min-w-0 w-full">
        <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
          {product.name}
        </p>
        {product.category && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {product.category}
          </p>
        )}
      </div>

      {/* Price + stock */}
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-sm font-black text-primary">
          ₹{price}
          <span className="text-[10px] font-normal text-muted-foreground">/{unit}</span>
        </span>
        {stock <= 0 ? (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-950/30 dark:text-red-400">
            Out
          </span>
        ) : stock <= 5 ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            Low
          </span>
        ) : null}
      </div>
    </button>
  );
}
