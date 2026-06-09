import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Barcode, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermission } from "@/features/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import {
  findDuplicateProductWarnings,
  getLocalProductAliasSuggestions,
  productMatchesSearch,
  splitProductAliases,
  uniqueProductAliases,
} from "@/features/products/product-reliability";
import {
  CATEGORIES,
  averageCost,
  fromBaseQty,
  isDeletedProduct,
  isInactiveProduct,
  isLowStock,
  needsOwnerPinForPrices,
  productDisplayUnit,
  productMinimumPrice,
  productRetailPrice,
  productWholesalePrice,
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
import { fetchGroqAliasSuggestions } from "./product-aliases";
import { ProductFormModal } from "./components/ProductFormModal";
import { DataTableCard, EmptyState, FilterBar, PageHeader, PageShell, SearchInputWithIcon, StatCard, StatsGrid } from "@/components/shared";

function price(value: number | undefined | null) {
  return `Rs ${Number(value ?? 0).toLocaleString("en-IN")}`;
}

export default function ProductsPage() {
  const { toast } = useToast();
  const manageProducts = usePermission("manage_products");
  const belowMinPermission = usePermission("sell_below_minimum_price");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [pendingValues, setPendingValues] = useState<ProductFormData | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [aiAliasLoading, setAiAliasLoading] = useState(false);
  const [aiAliasError, setAiAliasError] = useState<string | null>(null);
  const [groqAliasSuggestions, setGroqAliasSuggestions] = useState<string[]>([]);
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

      const suggestionName = String(draft.name ?? draft.productName ?? base.name ?? "").trim();
      setGroqAliasSuggestions(suggestionName ? getLocalProductAliasSuggestions(suggestionName, String(draft.category ?? base.category ?? "general")) : []);
      setAiAliasError(null);
      setOpen(true);
      toast({
        title: shouldMerge ? "Product form updated" : nextEditing ? "Product edit prepared" : "Product draft prepared",
        description: shouldMerge ? "Voice filled the open product form. Keep speaking fields or save locally." : "Voice assistant filled the form. Review pricing/stock, then save locally.",
      });
    };
    window.addEventListener("kirana:voice-product-draft", handler);
    return () => window.removeEventListener("kirana:voice-product-draft", handler);
  }, [editing, form, manageProducts.allowed, manageProducts.reason, open, products.data, toast]);

  const createProduct = useCreateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        setOpen(false);
        setPinOpen(false);
        setPendingValues(null);
        form.reset(productToForm());
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
      .filter((product) => productMatchesSearch(product, q));
  }, [products.data, category, statusFilter, debouncedSearch]);

  const stats = useMemo(() => {
    const all = (products.data ?? []).filter((product) => !isDeletedProduct(product));
    return {
      total: all.length,
      active: all.filter((product) => !isInactiveProduct(product)).length,
      lowStock: all.filter(isLowStock).length,
      inactive: all.filter(isInactiveProduct).length,
    };
  }, [products.data]);

  const watchedName = form.watch("name");
  const watchedCategory = form.watch("category");
  const watchedAliases = form.watch("aliasesText");
  const watchedBarcode = form.watch("barcode");
  const duplicateWarnings = useMemo(() => findDuplicateProductWarnings({
    name: watchedName,
    category: watchedCategory,
    barcode: watchedBarcode,
    aliases: splitProductAliases(watchedAliases),
  }, products.data ?? [], editing?.id), [watchedName, watchedCategory, watchedBarcode, watchedAliases, products.data, editing?.id]);

  const aliasSuggestions = useMemo(() => {
    const existing = splitProductAliases(watchedAliases).map((item) => item.toLowerCase());
    return uniqueProductAliases([...groqAliasSuggestions, ...getLocalProductAliasSuggestions(watchedName, watchedCategory)])
      .filter((alias) => !existing.includes(alias.toLowerCase()))
      .slice(0, 16);
  }, [watchedName, watchedCategory, watchedAliases, groqAliasSuggestions]);

  const watchedMin = Number(form.watch("minimumSellingPrice") || 0);
  const watchedSell = Number(form.watch("sellingPrice") || 0);
  const watchedWholesale = Number(form.watch("wholesalePrice") || 0);
  const watchedRetail = Number(form.watch("retailPrice") || 0);
  const needsOwnerPinForPrice = needsOwnerPinForPrices(watchedMin, [watchedSell, watchedWholesale, watchedRetail]);
  const isPending = createProduct.isPending || updateProduct.isPending;

  const openAdd = () => {
    if (!manageProducts.allowed) {
      toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(null);
    form.reset(productToForm());
    setGroqAliasSuggestions([]);
    setAiAliasError(null);
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    if (!manageProducts.allowed) {
      toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
      return;
    }
    setEditing(product);
    form.reset(productToForm(product));
    setGroqAliasSuggestions([]);
    setAiAliasError(null);
    setOpen(true);
  };

  function appendAlias(alias: string) {
    const current = splitProductAliases(form.getValues("aliasesText"));
    form.setValue("aliasesText", uniqueProductAliases([...current, alias]).join(", "), { shouldDirty: true });
  }

  function appendAllAliasSuggestions() {
    const suggestions = getLocalProductAliasSuggestions(form.getValues("name"), form.getValues("category"));
    const current = splitProductAliases(form.getValues("aliasesText"));
    const next = uniqueProductAliases([...current, ...suggestions]);
    form.setValue("aliasesText", next.join(", "), { shouldDirty: true });
    toast({ title: "Alias suggestions added", description: "Review names once before saving the product." });
  }

  async function askGroqForAliases() {
    const name = form.getValues("name").trim();
    if (!name) {
      toast({ title: "Product name required", description: "Type product name first, then ask AI for aliases.", variant: "destructive" });
      return;
    }
    setAiAliasLoading(true);
    setAiAliasError(null);
    try {
      const suggestions = await fetchGroqAliasSuggestions(name, form.getValues("category"), form.getValues("unit"));
      setGroqAliasSuggestions(suggestions);
      if (suggestions.length === 0) {
        setAiAliasError("No AI aliases returned. Local aliases are still available.");
        toast({ title: "No AI aliases returned", description: "Use local alias chips or type manually." });
        return;
      }
      toast({ title: "AI aliases ready", description: `${suggestions.slice(0, 6).join(", ")}${suggestions.length > 6 ? "..." : ""}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI alias request failed";
      setAiAliasError(`${message}. Showing local fallback aliases because the backend AI proxy is unavailable.`);
      setGroqAliasSuggestions(getLocalProductAliasSuggestions(name, form.getValues("category")));
      toast({ title: "AI alias failed", description: "Showing local fallback aliases. Check backend AI proxy.", variant: "destructive" });
    } finally {
      setAiAliasLoading(false);
    }
  }

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
    <PageShell className="space-y-5">
      <PageHeader
        title="Products"
        description="Simple offline-ready product catalogue with prices, aliases and always-on stock tracking."
        actions={<Button data-testid="button-add-product" onClick={openAdd} disabled={!manageProducts.allowed}><Plus size={16} className="mr-1.5" />Add product</Button>}
      />

      <StatsGrid>
        <StatCard label="Total products" value={stats.total} />
        <StatCard label="Active products" value={stats.active} tone="green" />
        <StatCard label="Low stock alerts" value={stats.lowStock} tone="amber" />
        <StatCard label="Inactive" value={stats.inactive} tone="red" />
      </StatsGrid>

      <FilterBar>
        <SearchInputWithIcon id="input-search" label="Search products" placeholder="Search product, alias, barcode or category..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
            <SelectItem value="all">All status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full md:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
          {CATEGORIES.map((item) => (
              <SelectItem key={item} value={item} className="capitalize">{item.replace("_", " ")}</SelectItem>
          ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTableCard title={`${rows.length} products`} loading={products.isLoading} empty={!products.isLoading && rows.length === 0} emptyState={<EmptyState title="No products found" description="Add a product or clear filters to see your catalogue." />}>
          <table className="w-full text-sm">
            <thead className="bg-muted/60 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Stock</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Prices</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const unit = productDisplayUnit(product);
                const lowStock = isLowStock(product);
                const stock = fromBaseQty(product.stockBaseQty, unit);
                const retailQty = product.retailFromQuantity ?? 1;
                const wholesaleQty = product.wholesaleFromQuantity ?? 10;
                return (
                  <tr key={product.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 min-w-[260px]">
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        {product.name}
                        {lowStock ? <AlertTriangle size={14} className="text-orange-600" /> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="capitalize text-[10px]">{product.category ?? "general"}</Badge>
                        {product.barcode ? <Badge variant="secondary" className="text-[10px]"><Barcode size={10} className="mr-1" />{product.barcode}</Badge> : null}
                        {(product.aliases ?? []).slice(0, 3).map((alias) => <Badge key={alias} variant="outline" className="text-[10px]">{alias}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold">{stock} {unit}</p>
                      {lowStock ? <p className="text-[10px] font-medium text-orange-600">Low stock</p> : <p className="text-[10px] text-muted-foreground">In stock</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold">{price(productRetailPrice(product))}</p>
                      <p className="text-[10px] text-muted-foreground">Wholesale {price(productWholesalePrice(product))} from {wholesaleQty} {unit}</p>
                      <p className="text-[10px] text-muted-foreground">Min {price(productMinimumPrice(product))} - Avg cost {price(averageCost(product))} - Retail from {retailQty}</p>
                    </td>
                    <td className="px-4 py-3 text-center"><Badge variant={isInactiveProduct(product) ? "secondary" : "default"}>{isInactiveProduct(product) ? "Inactive" : "Active"}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-2">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(product)}><Pencil size={14} /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => {
                          if (!manageProducts.allowed) {
                            toast({ title: "Permission denied", description: manageProducts.reason, variant: "destructive" });
                            return;
                          }
                          setDeleteTarget(product);
                        }}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTableCard>

      <ProductFormModal
        open={open}
        editing={editing}
        form={form}
        duplicateWarnings={duplicateWarnings}
        aliasSuggestions={aliasSuggestions}
        aiAliasLoading={aiAliasLoading}
        aiAliasError={aiAliasError}
        needsOwnerPinForPrice={needsOwnerPinForPrice}
        isPending={isPending}
        onOpenChange={setOpen}
        onSubmit={onSubmit}
        onAppendAlias={appendAlias}
        onAppendAllLocalAliases={appendAllAliasSuggestions}
        onAskGroqForAliases={() => void askGroqForAliases()}
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
    </PageShell>
  );
}
