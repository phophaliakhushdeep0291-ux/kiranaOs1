import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermission } from "@/features/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { getProductEmoji } from "@/features/billing/pages/components/BillingSearch";
import { productMatchesSearch } from "@/features/products/product-reliability";
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
  const { toast } = useToast();
  const manageProducts = usePermission("manage_products");
  const belowMinPermission = usePermission("sell_below_minimum_price");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [pendingValues, setPendingValues] = useState<ProductFormData | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [stayOpen, setStayOpen] = useState(true);
  const stayOpenRef = useRef(true);
  const debouncedSearch = useDebounce(search.trim(), 150);

  const products = useListProducts({ limit: 1000 }, {
    query: { placeholderData: (previousData: Product[] | undefined) => previousData ?? [], staleTime: 2 * 60_000 },
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productToForm(),
  });

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = event instanceof CustomEvent ? readProductDraftEventDetail(event.detail) : null;
      const draft = detail?.draft;
      if (!draft) return;
      if (!manageProducts.allowed) {
        toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
        return;
      }
      const existingProduct = findDraftProduct(draft, products.data ?? []);
      const shouldMerge = Boolean(detail.merge || open);
      const base = shouldMerge ? form.getValues() : productToForm(existingProduct);
      const nextEditing = existingProduct ?? (shouldMerge ? editing : null);
      setEditing(nextEditing);
      form.reset(mergeDraftIntoProductForm(base, draft));
      setOpen(true);
      toast({
        title: shouldMerge ? "Product form updated" : nextEditing ? "Product edit prepared" : "Product draft prepared",
        description: "Voice assistant filled the form. Review pricing/stock, then save locally.",
      });
    };
    window.addEventListener("kirana:voice-product-draft", handler);
    return () => window.removeEventListener("kirana:voice-product-draft", handler);
  }, [editing, form, manageProducts.allowed, manageProducts.reason, open, products.data, toast]);

  const createProduct = useCreateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setPinOpen(false);
        setPendingValues(null);
        form.reset(productToForm());
        setOpen(stayOpenRef.current);
        toast({ title: "Product saved locally", description: "Stock tracking is enabled and it will sync to cloud when internet is available." });
      },
      onError: (err: unknown) => toast({ title: "Could not save product", description: err instanceof Error ? err.message : "Check required fields.", variant: "destructive" }),
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
        toast({ title: "Product updated locally" });
      },
      onError: (err: unknown) => toast({ title: "Could not update product", description: err instanceof Error ? err.message : "Check required fields.", variant: "destructive" }),
    },
  });

  const deleteProduct = useDeleteProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setDeleteTarget(null);
        toast({ title: "Product moved to recycle bin locally" });
      },
    },
  });

  const rows = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return (products.data ?? [])
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
  }, [products.data, category, statusFilter, stockFilter, typeFilter, debouncedSearch]);

  const stats = useMemo(() => {
    const all = (products.data ?? []).filter((product) => !isDeletedProduct(product));
    const categories = new Set<string>();
    all.forEach((product) => categories.add((product.category ?? "general").trim() || "general"));
    return {
      total: all.length,
      lowStock: all.filter((p) => isLowStock(p) && Number(p.stockBaseQty ?? 0) > 0).length,
      outOfStock: all.filter((p) => Number(p.stockBaseQty ?? 0) <= 0).length,
      categories: categories.size,
    };
  }, [products.data]);

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  useEffect(() => { setPage(1); }, [debouncedSearch, category, statusFilter, stockFilter, typeFilter, rowsPerPage]);
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const firstRow = rows.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const lastRow = Math.min(safePage * rowsPerPage, rows.length);

  const isPending = createProduct.isPending || updateProduct.isPending;

  const openAdd = () => {
    if (!manageProducts.allowed) {
      toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(null);
    form.reset(productToForm());
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    if (!manageProducts.allowed) {
      toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(product);
    form.reset(productToForm(product));
    setOpen(true);
  };

  function submitValues(values: ProductFormData, ownerPin?: string, reason?: string) {
    const input = formToInput(values, ownerPin, reason);
    if (editing) updateProduct.mutate({ id: editing.id, data: input });
    else createProduct.mutate({ data: input });
  }

  const onSubmit = (values: ProductFormData) => {
    const belowMin = needsOwnerPinForPrices(values.minimumSellingPrice, [values.sellingPrice, values.retailPrice, values.wholesalePrice]);
    if (belowMin && !belowMinPermission.allowed) {
      toast({ title: "Permission denied", description: belowMinPermission.reason, variant: "destructive" });
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
    <div className={`min-h-full bg-[#f7f9fd] px-4 py-4 transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "lg:pr-[440px]" : ""}`}>
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard icon={<Package size={18} />} iconClass="bg-blue-50 text-blue-600" label="Total Products" value={stats.total.toLocaleString("en-IN")} sub="Active listings" />
        <StatCard icon={<AlertTriangle size={18} />} iconClass="bg-amber-50 text-amber-600" label="Low Stock" value={stats.lowStock.toLocaleString("en-IN")} sub="Needs attention" />
        <StatCard icon={<XCircle size={18} />} iconClass="bg-rose-50 text-rose-600" label="Out of Stock" value={stats.outOfStock.toLocaleString("en-IN")} sub="Unavailable" />
        <StatCard icon={<Layers size={18} />} iconClass="bg-violet-50 text-violet-600" label="Categories" value={stats.categories.toLocaleString("en-IN")} sub="Active categories" />
      </div>

      {/* ── Toolbar ── */}
      <div className="mt-3.5 flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" aria-hidden="true" />
          <Input
            data-testid="input-search"
            className="h-11 rounded-[10px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[#0f2147] placeholder:text-[#6b7a9a] focus-visible:border-[#0057ff] focus-visible:bg-white focus-visible:ring-0"
            placeholder="Search by product name, barcode or SKU"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-11 w-full rounded-[10px] border-[#e3eaf3] text-[13px] font-semibold md:w-52" data-testid="select-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.filter((c) => c !== "all").map((item) => (
              <SelectItem key={item} value={item} className="capitalize">{item.replace(/_/g, " ")}</SelectItem>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead>
              <tr className="border-b-2 border-[#e6ecf4] bg-[#f9fbfd] text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-3 py-3 font-bold">Category</th>
                <th className="px-3 py-3 font-bold">SKU / Barcode</th>
                <th className="px-3 py-3 font-bold">Unit</th>
                <th className="px-3 py-3 text-right font-bold">MRP</th>
                <th className="px-3 py-3 text-right font-bold">Cost Price</th>
                <th className="px-3 py-3 text-right font-bold">Selling Price</th>
                <th className="px-3 py-3 text-center font-bold">Stock</th>
                <th className="px-3 py-3 text-center font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading && rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-sm text-[#536383]">Loading products…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center">
                  <p className="text-sm font-bold text-[#13274d]">No products found</p>
                  <p className="mt-1 text-xs text-[#536383]">Add a product or clear filters to see your catalogue.</p>
                </td></tr>
              ) : (
                pagedRows.map((product) => {
                  const unit = productDisplayUnit(product);
                  const stockBase = Number(product.stockBaseQty ?? 0);
                  const stock = fromBaseQty(product.stockBaseQty, unit);
                  const outOfStock = stockBase <= 0;
                  const low = isLowStock(product) && !outOfStock;
                  const cat = (product.category ?? "general").trim() || "general";
                  const brandLine = product.brand ?? product.aliases?.[0] ?? "";
                  const mrp = product.mrp && product.mrp > 0 ? product.mrp : productRetailPrice(product);
                  return (
                    <tr key={product.id} className="border-b border-[#f1f4f8] last:border-0 transition-colors hover:bg-[#f9fbfe]" data-testid={`row-product-${product.id}`}>
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
                            <StatusPill tone="rose">Out of Stock</StatusPill>
                          ) : low ? (
                            <StatusPill tone="amber">Low Stock</StatusPill>
                          ) : (
                            <StatusPill tone="emerald">In Stock</StatusPill>
                          )}
                        </div>
                      </td>
                      {/* Actions — three-dot menu */}
                      <td className="px-3 py-3">
                        <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8] data-[state=open]:bg-[#eef4ff] data-[state=open]:text-[#0057ff]"
                              aria-label={`Actions for ${product.name}`}
                            >
                              <MoreVertical size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => openEdit(product)}>
                              <Pencil size={14} className="mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                if (!manageProducts.allowed) {
                                  toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
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
              <span className="text-[12px] text-[#6d7c98]">Rows per page</span>
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

      <ProductFormPanel
        open={open}
        editing={editing}
        form={form}
        isPending={isPending}
        stayOpen={stayOpen}
        onStayOpenChange={(v) => { setStayOpen(v); stayOpenRef.current = v; }}
        onOpenChange={setOpen}
        onSubmit={onSubmit}
      />

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title="Move product to recycle bin"
        description={`Delete ${deleteTarget?.name ?? "this product"}? This is a soft delete and can be restored from recycle bin.`}
        confirmLabel="Move to recycle bin"
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
        title={editing ? "Owner approval required" : "Owner password required"}
        description={editing ? "This product price needs owner approval before saving." : "Creating a new product changes the shop catalogue, so owner password/PIN is required."}
        confirmLabel={editing ? "Approve update" : "Create product"}
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
    <div className="flex items-center gap-3.5 rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${iconClass}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-[#6d7c98]">{label}</p>
        <p className="font-display text-[22px] font-black leading-tight tracking-tight text-[#0f1e3d]">{value}</p>
        <p className="text-[11px] text-[#9aa6bb]">{sub}</p>
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
  const activeCount = [statusFilter !== "all", stockFilter !== "all", typeFilter !== "all"].filter(Boolean).length;
  const clearAll = () => { setStatusFilter("all"); setStockFilter("all"); setTypeFilter("all"); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid="button-filters"
          className="relative flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-[#e3eaf3] bg-white px-4 text-[13px] font-semibold text-[#3a4a6b] transition-colors hover:bg-[#f7f9fd] data-[state=open]:border-[#0057ff]"
        >
          <SlidersHorizontal size={14} className="text-[#6b7a9a]" />
          Filters
          {activeCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#0057ff] px-1 text-[10px] font-black text-white">{activeCount}</span>
          )}
          <ChevronDown size={14} className="text-[#6b7a9a]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[264px] p-0">
        <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-2.5">
          <span className="text-[13px] font-black text-[#13274d]">Filters</span>
          <button onClick={clearAll} disabled={activeCount === 0} className="text-[12px] font-bold text-[#0057ff] transition-colors disabled:text-[#9aa6bb]">Clear all</button>
        </div>
        <div className="space-y-4 p-4">
          <FilterGroup label="Stock" value={stockFilter} onChange={setStockFilter} options={[["all", "All"], ["in", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]]} />
          <FilterGroup label="Item type" value={typeFilter} onChange={setTypeFilter} options={[["all", "All"], ["packed", "Packed"], ["loose", "Loose"]]} />
          <FilterGroup label="Status" value={statusFilter} onChange={setStatusFilter} options={[["all", "All"], ["active", "Active"], ["inactive", "Inactive"]]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#7a89a3]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
              value === v ? "border-[#0057ff] bg-[#0057ff] text-white" : "border-[#e3eaf3] bg-white text-[#45577a] hover:bg-[#f7f9fd]"
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
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label="Previous page">
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
              p === page ? "bg-[#0057ff] text-white shadow-[0_4px_10px_rgba(0,87,255,0.25)]" : "border border-[#e3eaf3] text-[#45577a] hover:bg-[#f7f9fd]"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e3eaf3] text-[#536383] transition-colors hover:bg-[#f7f9fd] disabled:opacity-40" aria-label="Next page">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
