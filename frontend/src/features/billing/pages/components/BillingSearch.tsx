import type { RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Search, ScanLine, ShieldCheck, Zap } from "lucide-react";
import type { Product } from "@/lib/api/client";
import {
  productCostPrice,
  productMinSellingPrice,
  productSellingPrice,
  profitClass,
  roundMoney,
} from "../billing-calculations";
import { BillingDraftRestore } from "./BillingDraftRestore";
import { EmptyState, SyncBadge } from "@/components/shared";

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
}: BillingSearchProps) {
  return (
    <>
      {!isOnline && (
        <div className="shop-alert shop-alert-warning flex flex-wrap items-center gap-2">
          <SyncBadge status="offline" label="Local safe" />
          <span>Billing continues offline.</span>
        </div>
      )}

      <BillingDraftRestore
        draftRestored={draftRestored}
        cartLength={cartLength}
        onHideDraftRestored={onHideDraftRestored}
      />

      <div className="premium-panel-muted p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Zap size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-black leading-tight">Fast billing</p>
              <p className="text-xs text-muted-foreground">
                {cartLength} item{cartLength === 1 ? "" : "s"} in current bill
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SyncBadge status={isOnline ? "synced" : "offline"} label={isOnline ? "Cloud ready" : "Local safe"} />
            <span className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              <ShieldCheck size={13} aria-hidden="true" />
              Auto saved
            </span>
          </div>
        </div>

        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            data-testid="input-product-search"
            className="h-14 rounded-lg border bg-background pl-11 pr-11 text-lg font-semibold shadow-none focus-visible:ring-2"
            placeholder="Search product, alias, or barcode"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <ScanLine size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          {search.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-lg border bg-card shadow-2xl">
              <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Product results
              </div>
              <div className="max-h-[420px] overflow-auto">
                {productsLoading ? (
                  <div className="p-5 text-center text-sm text-muted-foreground">Searching local products...</div>
                ) : filteredProducts.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="No saved product found" description="Add the product from Products first." />
                  </div>
                ) : (
                  filteredProducts.map((product) => (
                    <ProductSearchRow key={product.id} product={product} onAdd={() => onAddProduct(product)} />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onSelectedCategoryChange("all")}
          className={`touch-target shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold shadow-xs ${
            selectedCategory === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          }`}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => onSelectedCategoryChange(category)}
            className={`touch-target shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold shadow-xs ${
              selectedCategory === category ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
          >
            {category}
          </button>
        ))}
      </div>
    </>
  );
}

function ProductSearchRow({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const selling = productSellingPrice(product, 1);
  const min = productMinSellingPrice(product);
  const cost = productCostPrice(product);
  const profit = roundMoney(selling - cost);
  return (
    <button
      data-testid={`button-add-product-${product.id}`}
      onClick={onAdd}
      className="flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{product.name}</span>
          {product.category ? <span className="shrink-0 text-xs text-muted-foreground">{product.category}</span> : null}
        </div>
        {product.aliases && product.aliases.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">Alias: {product.aliases.slice(0, 4).join(", ")}</p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          Min Rs {min} · Cost Rs {cost} · Stock {product.stockBaseQty ?? 0} {product.displayUnit ?? product.rateUnit ?? "pc"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-sm font-semibold text-primary">
          Rs {selling}/{product.rateUnit ?? product.displayUnit ?? "pc"}
        </span>
        <span className={`block text-xs font-semibold ${profitClass(profit)}`}>Profit Rs {profit}</span>
      </div>
    </button>
  );
}
