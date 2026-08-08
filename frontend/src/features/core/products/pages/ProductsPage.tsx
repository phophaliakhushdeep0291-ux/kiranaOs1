import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  getListProductsQueryKey,
  useCreateProduct,
  useDeleteProduct,
  useListProducts,
  useUpdateProduct,
  type Product,
} from "@/lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useOfflineStatus } from "@/features/core/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Layers,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openLabelPrintWindow } from "@/features/core/products/label-print";
import { BulkEditDialog } from "./components/BulkEditDialog";
import { BulkDeleteDialog } from "./components/BulkDeleteDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { usePermission } from "@/features/core/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { getProductEmoji } from "@/features/core/billing/pages/components/BillingSearch";
import { productMatchesSearch } from "@/features/core/products/product-reliability";
import {
  CATEGORIES,
  averageCost,
  fromBaseQty,
  isDeletedProduct,
  isInactiveProduct,
  isLowStock,
  needsOwnerPinForPrices,
  productDisplayUnit,
  productRetailPrice,
} from "./product-pricing";
import {
  findDraftProduct,
  formToInput,
  mergeDraftIntoProductForm,
  productFormSchema,
  productToForm,
  readProductDraftEventDetail,
  type ProductFormData,
} from "./product-form-state";
import { ProductFormPanel } from "./components/ProductFormPanel";
import { ImportProductsDialog } from "./components/ImportProductsDialog";
import { offlineDB } from "@/lib/offline/db";
import { useAppLanguage } from "@/features/core/settings/i18n";

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

function rs(value: number | undefined | null) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* deterministic soft badge colour per category */
const CATEGORY_BADGE = [
  "bg-blue-50 text-blue-700",
  "bg-emerald-50 text-emerald-700",
  "bg-purple-50 text-purple-700",
  "bg-amber-50 text-amber-700",
  "bg-rose-50 text-rose-700",
  "bg-cyan-50 text-cyan-700",
  "bg-indigo-50 text-indigo-700",
  "bg-teal-50 text-teal-700",
];
function categoryBadge(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return CATEGORY_BADGE[h % CATEGORY_BADGE.length];
}

export default function ProductsPage() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const manageProducts = usePermission("manage_products");
  const belowMinPermission = usePermission("sell_below_minimum_price");
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [starterHint, setStarterHint] = useState(false);
  const [pendingValues, setPendingValues] = useState<ProductFormData | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [stayOpen, setStayOpen] = useState(true);
  const stayOpenRef = useRef(true);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:product-panel-width");
  const debouncedSearch = useDebounce(search.trim(), 150);
  const [localProductRows, setLocalProductRows] = useState<Product[]>([]);

  const products = useListProducts({ limit: 1000 }, {
    query: { placeholderData: (previousData: Product[] | undefined) => previousData ?? [], staleTime: 2 * 60_000 },
  });
  // `[]` is an authoritative, successfully loaded catalogue. Falling back to
  // every IndexedDB row when the server returns an empty list resurrects stale
  // products; use the direct DB paint only until the repository has resolved.
  const productRows = products.data === undefined ? localProductRows : products.data;

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productToForm(),
  });

  useEffect(() => {
    let cancelled = false;
    const loadLocalProducts = async () => {
      const rows = await offlineDB.getAll<Product>("products").catch(() => []);
      if (!cancelled) setLocalProductRows(rows);
    };
    void loadLocalProducts();
    window.addEventListener("kirana:local-data-changed", loadLocalProducts);
    window.addEventListener("kirana:sync-queue-updated", loadLocalProducts);
    return () => {
      cancelled = true;
      window.removeEventListener("kirana:local-data-changed", loadLocalProducts);
      window.removeEventListener("kirana:sync-queue-updated", loadLocalProducts);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = event instanceof CustomEvent ? readProductDraftEventDetail(event.detail) : null;
      const draft = detail?.draft;
      if (!draft) return;
      if (!manageProducts.allowed) {
        toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" });
        return;
      }
      const existingProduct = findDraftProduct(draft, productRows);
      const shouldMerge = Boolean(detail.merge || open);
      const base = shouldMerge ? form.getValues() : productToForm(existingProduct);
      const nextEditing = existingProduct ?? (shouldMerge ? editing : null);
      setEditing(nextEditing);
      form.reset(mergeDraftIntoProductForm(base, draft));
      setOpen(true);
      toast({
        title: shouldMerge ? t("products.toast.formUpdated") : nextEditing ? t("products.toast.editPrepared") : t("products.toast.draftPrepared"),
        description: t("products.toast.voiceFilled"),
      });
    };
    window.addEventListener("kirana:voice-product-draft", handler);
    return () => window.removeEventListener("kirana:voice-product-draft", handler);
  }, [editing, form, manageProducts.allowed, manageProducts.reason, open, productRows, toast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: unknown }>).detail?.query ?? "").trim();
      if (!query) return;
      setSearch(query);
      setPage(1);
    };
    window.addEventListener("kirana:voice-product-search", handler);
    return () => window.removeEventListener("kirana:voice-product-search", handler);
  }, []);

  const createProduct = useCreateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setPinOpen(false);
        setPendingValues(null);
        form.reset(productToForm());
        setOpen(stayOpenRef.current);
        toast(isOnline
          ? { title: t("products.toast.added") }
          : { title: t("products.toast.savedOffline"), description: t("products.toast.willSync") });
      },
      onError: (err: unknown) => toast({ title: t("products.toast.saveFailed"), description: err instanceof Error ? err.message : t("products.toast.checkRequired"), variant: "destructive" }),
    },
  });

  const updateProduct = useUpdateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setOpen(false);
        setPinOpen(false);
        setPendingValues(null);
        setEditing(null);
        form.reset(productToForm());
        toast(isOnline
          ? { title: t("products.toast.updated") }
          : { title: t("products.toast.updatedOffline"), description: t("products.toast.changesWillSync") });
      },
      onError: (err: unknown) => toast({ title: t("products.toast.updateFailed"), description: err instanceof Error ? err.message : t("products.toast.checkRequired"), variant: "destructive" }),
    },
  });

  const deleteProduct = useDeleteProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setDeleteTarget(null);
        toast({ title: t("products.toast.recycledLocally") });
      },
    },
  });

  const rows = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return productRows
      .filter((product) => !isDeletedProduct(product))
      .filter((product) => category === "all" || (product.category ?? "general") === category)
      .filter((product) => statusFilter === "all" || (statusFilter === "active" ? !isInactiveProduct(product) : isInactiveProduct(product)))
      .filter((product) => {
        if (stockFilter === "all") return true;
        const out = Number(product.stockBaseQty ?? 0) <= 0;
        const low = isLowStock(product) && !out;
        if (stockFilter === "out") return out;
        if (stockFilter === "low") return low;
        return !out && !low; // "in"
      })
      .filter((product) => typeFilter === "all" || (typeFilter === "loose" ? !!product.isLooseItem : !product.isLooseItem))
      .filter((product) => productMatchesSearch(product, q));
  }, [productRows, category, statusFilter, stockFilter, typeFilter, debouncedSearch]);

  const stats = useMemo(() => {
    const all = productRows.filter((product) => !isDeletedProduct(product));
    const categories = new Set<string>();
    all.forEach((product) => categories.add((product.category ?? "general").trim() || "general"));
    return {
      total: all.length,
      lowStock: all.filter((p) => isLowStock(p) && Number(p.stockBaseQty ?? 0) > 0).length,
      outOfStock: all.filter((p) => Number(p.stockBaseQty ?? 0) <= 0).length,
      categories: categories.size,
    };
  }, [productRows]);

  /**
   * Filter by the categories this shop actually uses, not a fixed list. A shop
   * whose catalogue is "staples", "oils", "masala" could not filter to any of
   * them, while the stat card beside the filter counted them — so the control
   * silently covered a fraction of the catalogue. Seed defaults stay for a shop
   * with no products yet.
   */
  const categoryOptions = useMemo(() => {
    const used = new Set<string>();
    productRows
      .filter((product) => !isDeletedProduct(product))
      .forEach((product) => {
        const value = (product.category ?? "").trim();
        if (value) used.add(value);
      });
    const defaults = CATEGORIES.filter((item) => item !== "all");
    return [...new Set([...used, ...(used.size === 0 ? defaults : [])])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [productRows]);

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  useEffect(() => { setPage(1); }, [debouncedSearch, category, statusFilter, stockFilter, typeFilter, rowsPerPage]);
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const firstRow = rows.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const lastRow = Math.min(safePage * rowsPerPage, rows.length);

  // ── Bulk selection ─────────────────────────────────────────────
  // Selection is keyed by product id and survives pagination; a filter change
  // drops ids no longer visible so a hidden selection can't be edited blind.
  const visibleIds = useMemo(() => new Set(rows.map((product) => product.id)), [rows]);
  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);
  const selectedProducts = useMemo(
    () => rows.filter((product) => selectedIds.has(product.id)) as Array<Product & Record<string, unknown>>,
    [rows, selectedIds],
  );
  const pageAllSelected = pagedRows.length > 0 && pagedRows.every((product) => selectedIds.has(product.id));
  const toggleOne = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePage = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (pageAllSelected) pagedRows.forEach((product) => next.delete(product.id));
    else pagedRows.forEach((product) => next.add(product.id));
    return next;
  });
  // Some selected product sells near its minimum → bulk price change needs owner PIN.
  const bulkNeedsOwnerPin = useMemo(
    () => selectedProducts.some((product) => Number(product.minPricePerRateUnit ?? product.minimumSellingPrice ?? 0) > 0),
    [selectedProducts],
  );

  const isPending = createProduct.isPending || updateProduct.isPending;

  const openAdd = useCallback(() => {
    if (!manageProducts.allowed) {
      toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(null);
    form.reset(productToForm());
    setOpen(true);
  }, [form, manageProducts.allowed, manageProducts.reason, toast]);

  useEffect(() => {
    const [path, query = ""] = location.split("?");
    const browserQuery = typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");
    if (path !== "/products") return;
    const params = new URLSearchParams(query || browserQuery);
    if (params.get("add") === "1") openAdd();
    if (params.get("import") === "1") setImportOpen(true);
    // A filter hint, so a screen that just added a few hundred products can land the shop
    // on the group it wants reviewed rather than on an undifferentiated list.
    const categoryHint = params.get("category")?.trim();
    if (categoryHint) setCategory(categoryHint);
    if (params.get("starter") === "1") setStarterHint(true);
    const handled = params.get("add") === "1" || params.get("import") === "1"
      || Boolean(categoryHint) || params.get("starter") === "1";
    if (!handled) return;
    setLocation("/products");
  }, [location, openAdd, setLocation]);

  const openEdit = (product: Product) => {
    if (!manageProducts.allowed) {
      toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(product);
    form.reset(productToForm(product));
    setOpen(true);
  };

  // Standard retail practice: a pack you need to count and reorder on its own is a
  // separate SKU, not a second stock bucket on one product. Retyping every field is what
  // pushed people toward "Other pack sizes" expecting a quantity there, so this copies
  // the catalogue details and clears only what must be unique to the new SKU.
  const duplicateProduct = (product: Product) => {
    if (!manageProducts.allowed) {
      toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" });
      return;
    }
    const source = productToForm(product);
    // editing = null so this saves as a NEW product rather than overwriting the source.
    setEditing(null);
    form.reset({
      ...source,
      // The server rejects a duplicate active name, so the copy must arrive distinct.
      name: `${source.name} (copy)`,
      // A barcode identifies one physical pack; sharing it would make scans ambiguous.
      barcode: "",
      // A new SKU starts empty — stock is counted in, never copied.
      stockQuantity: 0,
      // These carry the SOURCE product's selling-unit database ids. formToInput reuses
      // previousDefault.id when the unitCode matches, which would attach another
      // product's units to this one. The unit is rebuilt from unit/packSize below.
      sellingUnits: [],
    });
    setOpen(true);
    toast({
      title: t("products.toast.copyReady"),
      description: t("products.toast.copyReadyHint"),
    });
  };

  const printLabel = (product: Product) => {
    if (!openLabelPrintWindow([product])) {
      toast({ title: t("products.toast.popupBlocked"), description: t("products.toast.popupBlockedPrice"), variant: "destructive" });
    }
  };

  function submitValues(values: ProductFormData, ownerPin?: string, reason?: string) {
    const input = formToInput(values, ownerPin, reason);
    if (editing) {
      // optimistic-concurrency base = the server version this edit started from
      input.baseUpdatedAt = editing.updatedAt;
      updateProduct.mutate({ id: editing.id, data: input });
    } else {
      createProduct.mutate({ data: input });
    }
  }

  const onSubmit = (values: ProductFormData) => {
    const belowMin = needsOwnerPinForPrices(values.minimumSellingPrice, [values.sellingPrice, values.retailPrice, values.wholesalePrice]);
    if (belowMin && !belowMinPermission.allowed) {
      toast({ title: t("products.toast.permissionDenied"), description: belowMinPermission.reason, variant: "destructive" });
      return;
    }
    if (!editing || belowMin) {
      setPendingValues(values);
      setPinOpen(true);
      return;
    }
    submitValues(values);
  };

  return (
    <div
      className={`app-docked-page ${isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"}`}
      style={open && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 xl:grid-cols-4">
        <StatCard icon={<Package size={18} />} iconClass="bg-blue-50 text-blue-600" label={t("products.stats.total")} value={stats.total.toLocaleString("en-IN")} sub={t("products.stats.totalHint")} />
        <StatCard icon={<AlertTriangle size={18} />} iconClass="bg-amber-50 text-amber-600" label={t("products.stats.lowStock")} value={stats.lowStock.toLocaleString("en-IN")} sub={t("products.stats.lowStockHint")} />
        <StatCard icon={<XCircle size={18} />} iconClass="bg-rose-50 text-rose-600" label={t("products.stats.outOfStock")} value={stats.outOfStock.toLocaleString("en-IN")} sub={t("products.stats.outOfStockHint")} />
        <StatCard icon={<Layers size={18} />} iconClass="bg-violet-50 text-violet-600" label={t("products.stats.categories")} value={stats.categories.toLocaleString("en-IN")} sub={t("products.stats.categoriesHint")} />
      </div>

      {/* The starter catalog stocks a shop with items it may not carry. Say where to prune
          them, once, rather than leaving a shopkeeper to scroll several hundred rows. */}
      {starterHint && (
        <div className="mt-3.5 flex items-start gap-3 rounded-[14px] border border-[#d9e7fb] bg-[#f4f9ff] p-3" data-testid="starter-catalog-hint">
          <Layers size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12px] leading-5 text-[#344668]">
            <span className="font-bold">Starter items added.</span>{" "}
            Use the category filter to take one group at a time and delete anything you don't sell.
            Prices are starting values — correct them as you go.
          </p>
          <button
            className="shrink-0 text-[11px] font-bold text-[#536383] hover:underline"
            data-testid="starter-catalog-hint-dismiss"
            onClick={() => setStarterHint(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="mt-3.5 flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" aria-hidden="true" />
          <Input
            data-testid="input-search"
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[var(--brand-ink)] placeholder:text-[#6b7a9a] focus-visible:border-[var(--brand)] focus-visible:bg-white focus-visible:ring-0"
            placeholder={t("products.search.placeholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-11 w-full rounded-[10px] border-[#e3eaf3] text-[13px] font-semibold capitalize lg:w-52" data-testid="select-category">
            {/* Render the label ourselves so the trigger reads "Home Care" like the
                option does, instead of echoing the raw stored value ("home-care"). */}
            <SelectValue placeholder={t("products.filter.allCategories")}>
              {category === "all" ? "All Categories" : category.replace(/[_-]/g, " ")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("products.filter.allCategories")}</SelectItem>
            {categoryOptions.map((item) => (
              <SelectItem key={item} value={item} className="capitalize">{item.replace(/[_-]/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FiltersButton
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          stockFilter={stockFilter}
          setStockFilter={setStockFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
        />
        <Button
          variant="outline"
          onClick={() => setImportOpen(true)}
          disabled={!manageProducts.allowed}
          className="hidden h-11 shrink-0 gap-1.5 rounded-[10px] px-4 text-[13px] font-bold lg:inline-flex"
        >
          <Upload size={16} /> Import
        </Button>
        <Button
          data-testid="button-add-product"
          onClick={openAdd}
          disabled={!manageProducts.allowed}
          className="h-11 shrink-0 gap-1.5 rounded-[10px] px-5 text-[13px] font-bold shadow-[0_8px_18px_rgba(0,77,255,0.22)]"
        >
          <Plus size={16} /> Add Product
        </Button>
      </div>

      {/* ── Products table ── */}
      <div className="mt-3.5 overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="space-y-2.5 p-2.5 lg:hidden">
          {products.isLoading && rows.length === 0 ? (
            <div className="py-12 text-center text-sm font-semibold text-[#64748b]">{t("products.list.loading")}</div>
          ) : pagedRows.length === 0 ? (
            <div className="rounded-[16px] border border-dashed border-[#d8e2f1] px-4 py-12 text-center">
              <Package size={26} className="mx-auto text-[#94a3b8]" />
              <p className="mt-2 text-sm font-black text-[var(--brand-ink)]">{t("products.list.emptyTitle")}</p>
              <p className="mt-1 text-xs text-[#64748b]">{t("products.list.emptyHintFilters")}</p>
            </div>
          ) : pagedRows.map((product) => {
            const defaultUnit = product.sellingUnits?.find((row) => row.isDefault) ?? product.sellingUnits?.[0];
            const unit = defaultUnit?.name ?? productDisplayUnit(product);
            const stockBase = Number(product.stockBaseQty ?? 0);
            const stock = defaultUnit?.conversionToBase
              ? Math.round((stockBase / defaultUnit.conversionToBase + Number.EPSILON) * 100) / 100
              : fromBaseQty(product.stockBaseQty, productDisplayUnit(product));
            const outOfStock = stockBase <= 0;
            const low = isLowStock(product) && !outOfStock;
            const price = product.sellingPrice ?? product.defaultPricePerRateUnit;
            return (
              <article key={product.id} className="rounded-[16px] border border-[#e4ebf4] bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[13px] bg-[#f4f7fb] text-xl">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain" /> : getProductEmoji(product.name, product.category)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-black text-[var(--brand-ink)]">{product.name}</p>
                    <p className="mt-0.5 truncate text-[11px] font-semibold capitalize text-[#64748b]">{product.category || t("products.filter.general")} · {unit}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-black text-[var(--brand)]">{rs(price)}</span>
                      {outOfStock ? <StatusPill tone="rose">{t("products.badge.outOfStockShort")}</StatusPill> : low ? <StatusPill tone="amber">{t("products.badge.lowStockShort")}</StatusPill> : <StatusPill tone="emerald">{stock} available</StatusPill>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-[#dfe7f2] text-[#405273]" aria-label={`Actions for ${product.name}`}><MoreVertical size={17} /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openEdit(product)}><Pencil size={14} className="mr-2" /> {t("products.action.edit")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateProduct(product)}><Copy size={14} className="mr-2" /> {t("products.action.duplicate")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation(`/products/${product.id}/pricing`)}><Layers size={14} className="mr-2" /> {t("products.action.customerPricing")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => printLabel(product)}><Tag size={14} className="mr-2" /> {t("products.action.printLabel")}</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(product)}><Trash2 size={14} className="mr-2" /> {t("products.action.recycle")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
        </div>
        <div className="app-table-scroll hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead>
              <tr className="border-b-2 border-[#e6ecf4] bg-[#f9fbfd] text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={t("products.list.selectAll")}
                    data-testid="bulk-select-page"
                    className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                    checked={pageAllSelected}
                    onChange={togglePage}
                  />
                </th>
                <th className="px-4 py-3 font-bold">{t("products.col.product")}</th>
                <th className="px-3 py-3 font-bold">{t("products.col.category")}</th>
                <th className="px-3 py-3 font-bold">{t("products.col.skuBarcode")}</th>
                <th className="px-3 py-3 font-bold">{t("products.col.unit")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("products.col.mrp")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("products.col.costPrice")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("products.col.sellingPrice")}</th>
                <th className="px-3 py-3 text-center font-bold">{t("products.col.stock")}</th>
                <th className="px-3 py-3 text-center font-bold">{t("products.col.action")}</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading && rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-16 text-center text-sm text-[#536383]">{t("products.list.loading")}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-16 text-center">
                  <p className="text-sm font-bold text-[#13274d]">{t("products.list.emptyTitle")}</p>
                  <p className="mt-1 text-xs text-[#536383]">{t("products.list.emptyHintCatalogue")}</p>
                </td></tr>
              ) : (
                pagedRows.map((product) => {
                  const defaultSellingUnit = product.sellingUnits?.find((row) => row.isDefault) ?? product.sellingUnits?.[0];
                  const unit = defaultSellingUnit?.name ?? productDisplayUnit(product);
                  const stockBase = Number(product.stockBaseQty ?? 0);
                  const stock = defaultSellingUnit?.conversionToBase
                    ? Math.round((stockBase / defaultSellingUnit.conversionToBase + Number.EPSILON) * 100) / 100
                    : fromBaseQty(product.stockBaseQty, productDisplayUnit(product));
                  const outOfStock = stockBase <= 0;
                  const low = isLowStock(product) && !outOfStock;
                  const cat = (product.category ?? "general").trim() || "general";
                  const brandLine = product.brand ?? product.aliases?.[0] ?? "";
                  const mrp = product.mrp && product.mrp > 0 ? product.mrp : productRetailPrice(product);
                  return (
                    <tr key={product.id} className={`border-b border-[#f1f4f8] last:border-0 transition-colors hover:bg-[#f9fbfe] ${selectedIds.has(product.id) ? "bg-[#f3f8ff]" : ""}`} data-testid={`row-product-${product.id}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${product.name}`}
                          data-testid={`bulk-select-${product.id}`}
                          className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                          checked={selectedIds.has(product.id)}
                          onChange={() => toggleOne(product.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[#f4f7fb] text-lg">
                            {product.imageUrl ? (
                              <img src={product.imageUrl} alt="" className="h-full w-full object-contain" />
                            ) : (
                              getProductEmoji(product.name, product.category)
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-extrabold text-[#14284e]">{product.name}</p>
                            {brandLine && <p className="truncate text-[11px] text-[#8a97ad]">{brandLine}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${categoryBadge(cat)}`}>
                          {cat.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-3"><span className="font-mono text-[12px] text-[#45577a]">{product.barcode ?? product.sku ?? "—"}</span></td>
                      <td className="px-3 py-3 capitalize text-[#45577a]">{unit}</td>
                      <td className="px-3 py-3 text-right font-semibold text-[#45577a]">{rs(mrp)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-[#45577a]">{rs(averageCost(product))}</td>
                      <td className="px-3 py-3 text-right font-extrabold text-[#13274d]">{rs(product.sellingPrice ?? product.defaultPricePerRateUnit)}</td>
                      {/* Stock + status underneath, centered */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`font-bold ${outOfStock ? "text-rose-600" : low ? "text-amber-600" : "text-[#13274d]"}`}>{stock}</span>
                          {outOfStock ? (
                            <StatusPill tone="rose">{t("products.badge.outOfStock")}</StatusPill>
                          ) : low ? (
                            <StatusPill tone="amber">{t("products.badge.lowStock")}</StatusPill>
                          ) : (
                            <StatusPill tone="emerald">{t("products.badge.inStock")}</StatusPill>
                          )}
                        </div>
                      </td>
                      {/* Actions — three-dot menu */}
                      <td className="px-3 py-3">
                        <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8] data-[state=open]:bg-[#eef4ff] data-[state=open]:text-[var(--brand)]"
                              aria-label={`Actions for ${product.name}`}
                            >
                              <MoreVertical size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => openEdit(product)}>
                              <Pencil size={14} className="mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicateProduct(product)}>
                              <Copy size={14} className="mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLocation(`/products/${product.id}/pricing`)}>
                              <Layers size={14} className="mr-2" /> Pricing
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => printLabel(product)}>
                              <Tag size={14} className="mr-2" /> Print label
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                if (!manageProducts.allowed) {
                                  toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" });
                                  return;
                                }
                                setDeleteTarget(product);
                              }}
                            >
                              <Trash2 size={14} className="mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {rows.length > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-[#eef1f6] px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-0">
            <p className="text-[12px] text-[#6d7c98] sm:justify-self-start">
              Showing <span className="font-bold text-[#13274d]">{firstRow}</span> to <span className="font-bold text-[#13274d]">{lastRow}</span> of <span className="font-bold text-[#13274d]">{rows.length.toLocaleString("en-IN")}</span> products
            </p>
            <div className="sm:justify-self-center">
              <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
            </div>
            <div className="flex items-center gap-1.5 sm:justify-self-end">
              <span className="text-[12px] text-[#6d7c98]">{t("products.rowsPerPage")}</span>
              <Select value={String(rowsPerPage)} onValueChange={(v) => setRowsPerPage(Number(v))}>
                <SelectTrigger className="h-8 w-[68px] rounded-lg border-[#e3eaf3] text-[12px] font-semibold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROWS_PER_PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* max-w-xl, not md: a third action does not fit 448px beside the count on a
          phone, and the group wraps rather than pushing Delete off the edge. */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[calc(100%-2rem)] max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[#d6e2f5] bg-white px-4 py-3 shadow-[0_16px_40px_rgba(15,40,90,0.18)]" data-testid="bulk-action-bar">
          <span className="text-sm font-bold text-[#13274d]">{selectedIds.size} selected</span>
          <button className="text-xs font-semibold text-[#536383] hover:underline" onClick={() => setSelectedIds(new Set())}>{t("products.filter.clear")}</button>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => openLabelPrintWindow(selectedProducts) || toast({ title: t("products.toast.popupBlocked"), description: t("products.toast.popupBlockedLabels"), variant: "destructive" })}>
              <Tag size={14} className="mr-1" />Labels
            </Button>
            <Button
              size="sm"
              data-testid="bulk-edit-open"
              onClick={() => {
                if (!manageProducts.allowed) { toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" }); return; }
                setBulkOpen(true);
              }}
            >
              <SlidersHorizontal size={14} className="mr-1" />Bulk edit
            </Button>
            <Button
              size="sm"
              variant="destructive"
              data-testid="bulk-delete-open"
              onClick={() => {
                if (!manageProducts.allowed) { toast({ title: t("products.toast.permissionDenied"), description: manageProducts.reason, variant: "destructive" }); return; }
                setBulkDeleteOpen(true);
              }}
            >
              <Trash2 size={14} className="mr-1" />Delete
            </Button>
          </div>
        </div>
      )}

      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        products={selectedProducts}
        requiresOwnerPin={bulkNeedsOwnerPin}
        onDone={() => { setSelectedIds(new Set()); queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); }}
      />

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        products={selectedProducts}
        // Deliberately does NOT clear the selection: deleted rows leave `rows`, and the
        // visible-ids effect above drops them on its own. What survives is exactly the
        // rows that failed, still ticked, ready to retry.
        onDone={() => queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() })}
      />

      <ProductFormPanel
        open={open}
        editing={editing}
        form={form}
        isPending={isPending}
        stayOpen={stayOpen}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onStayOpenChange={(v) => { setStayOpen(v); stayOpenRef.current = v; }}
        onOpenChange={setOpen}
        onSubmit={onSubmit}
      />

      <ImportProductsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() })}
      />

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title={t("products.action.moveToRecycleBin")}
        description={`Delete ${deleteTarget?.name ?? "this product"}? This is a soft delete and can be restored from recycle bin.`}
        confirmLabel={t("products.action.moveToRecycleBinShort")}
        reasonRequired
        loading={deleteProduct.isPending}
        onCancel={() => { if (!deleteProduct.isPending) setDeleteTarget(null); }}
        onConfirm={({ ownerPin, reason }) => {
          if (!deleteTarget) return;
          deleteProduct.mutate({ id: deleteTarget.id, ownerPin, reason });
        }}
      />
      <OwnerPinModal
        open={pinOpen}
        onCancel={() => setPinOpen(false)}
        title={editing ? t("products.toast.ownerApprovalRequired") : t("products.toast.ownerPasswordRequired")}
        description={editing ? t("products.toast.priceNeedsApproval") : "Creating a new product changes the shop catalogue, so owner password/PIN is required."}
        confirmLabel={editing ? t("products.toast.approveUpdate") : t("products.action.createProduct")}
        loading={isPending}
        onConfirm={({ ownerPin, reason }) => {
          if (!pendingValues) return;
          submitValues(pendingValues, ownerPin, reason);
        }}
      />
    </div>
  );
}

/* ── Stat card ── */
function StatCard({ icon, iconClass, label, value, sub }: { icon: React.ReactNode; iconClass: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex min-h-[92px] items-center gap-2.5 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:gap-3.5 sm:p-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] sm:h-11 sm:w-11 sm:rounded-[12px] ${iconClass}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold leading-tight text-[#6d7c98] sm:text-[12px]">{label}</p>
        <p className="font-display text-[20px] font-black leading-tight tracking-tight text-[var(--brand-ink)] sm:text-[22px]">{value}</p>
        <p className="hidden text-[11px] text-[#9aa6bb] sm:block">{sub}</p>
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "emerald" | "amber" | "rose"; children: React.ReactNode }) {
  const map = { emerald: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", rose: "bg-rose-100 text-rose-700" } as const;
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[7px] px-2 py-[3px] text-[11px] font-bold ${map[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {children}
    </span>
  );
}

/* ── Filters popover ── */
function FiltersButton({
  statusFilter, setStatusFilter, stockFilter, setStockFilter, typeFilter, setTypeFilter,
}: {
  statusFilter: string; setStatusFilter: (v: string) => void;
  stockFilter: string; setStockFilter: (v: string) => void;
  typeFilter: string; setTypeFilter: (v: string) => void;
}) {
  const { t } = useAppLanguage();
  const activeCount = [statusFilter !== "all", stockFilter !== "all", typeFilter !== "all"].filter(Boolean).length;
  const clearAll = () => { setStatusFilter("all"); setStockFilter("all"); setTypeFilter("all"); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid="button-filters"
          className="relative flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-[#e3eaf3] bg-white px-4 text-[13px] font-semibold text-[#3a4a6b] transition-colors hover:bg-[#f7f9fd] data-[state=open]:border-[var(--brand)]"
        >
          <SlidersHorizontal size={14} className="text-[#6b7a9a]" />
          Filters
          {activeCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-black text-white">{activeCount}</span>
          )}
          <ChevronDown size={14} className="text-[#6b7a9a]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[264px] p-0">
        <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-2.5">
          <span className="text-[13px] font-black text-[#13274d]">{t("products.filter.title")}</span>
          <button onClick={clearAll} disabled={activeCount === 0} className="text-[12px] font-bold text-[var(--brand)] transition-colors disabled:text-[#9aa6bb]">{t("products.filter.clearAll")}</button>
        </div>
        <div className="space-y-4 p-4">
          <FilterGroup label={t("products.filter.stock")} value={stockFilter} onChange={setStockFilter} options={[["all", "All"], ["in", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]]} />
          <FilterGroup label={t("products.filter.itemType")} value={typeFilter} onChange={setTypeFilter} options={[["all", "All"], ["packed", t("products.filter.packed")], ["loose", t("products.filter.loose")]]} />
          <FilterGroup label={t("products.filter.status")} value={statusFilter} onChange={setStatusFilter} options={[["all", "All"], ["active", t("products.filter.active")], ["inactive", t("products.filter.inactive")]]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const { t } = useAppLanguage();
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
              value === v ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[#e3eaf3] bg-white text-[#45577a] hover:bg-[#f7f9fd]"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Pagination ── */
function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const { t } = useAppLanguage();
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label={t("products.previousPage")}>
        <ChevronLeft size={15} />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1.5 text-[12px] text-[#9aa6bb]">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[12px] font-bold transition-colors ${
              p === page ? "bg-[var(--brand)] text-white shadow-[0_4px_10px_rgba(0,87,255,0.25)]" : "border border-[#e3eaf3] text-[#45577a] hover:bg-[#f7f9fd]"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label={t("products.nextPage")}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
