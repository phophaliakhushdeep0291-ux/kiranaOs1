import { useEffect, useMemo, useState } from "react";
import {
  getGetInventoryQueryKey,
  getGetLowStockQueryKey,
  getGetStockLedgerQueryKey,
  getListProductsQueryKey,
  useGetInventory,
  useGetLowStock,
  useGetStockLedger,
  useListProducts,
  useListSuppliers,
  useRecordDamage,
  useRecordPurchase,
  useStockCorrection,
  type InventoryItem,
  type Product,
  type Supplier,
} from "@/lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, BarChart3, CalendarClock, ClipboardList, Loader2, PackageCheck, ShieldAlert, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { patchProductLocalFirst } from "@/features/products/local-actions";
import { recordSaleLocalFirst } from "@/features/inventory/local-actions";
import { usePermission } from "@/features/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import {
  INVENTORY_UNIT_CONVERSION as CONVERSION,
  buildUnitMismatchWarning,
  calculateInventoryPriceSuggestions,
  roundInventoryValue,
} from "@/features/inventory/calculations";
import { FilterBar, PageHeader, PageShell, SearchInputWithIcon, StatCard, StatsGrid } from "@/components/shared";

const UNITS = [
  "piece", "dozen", "set", "pair", "bundle", "roll", "sheet",
  "kg", "gram", "litre", "ml",
  "meter", "yard",
  "packet", "box",
  "strip", "tablet", "bottle", "tube",
  "plate", "glass",
  "custom",
];

type MovementType = "purchase" | "sale" | "damage" | "correction";

type MovementForm = {
  productId: string;
  movementType: MovementType;
  quantity: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  billAmount: string;
  supplierBillNo: string;
  purchasePaymentStatus: "paid" | "partial" | "due";
  purchasePaymentMode: "cash" | "upi";
  purchasePaidAmount: string;
  purchaseDueDate: string;
  costPrice: string;
  minPrice: string;
  sellingPrice: string;
  reason: string;
  minMarginPercent: string;
  sellingMarginPercent: string;
};

type MovementEntry = {
  id: string;
  productName?: string;
  productId?: string;
  product_id?: string;
  action?: string;
  type?: string;
  quantityDelta?: number;
  quantity_delta?: number;
  unit?: string;
  supplierName?: string;
  supplier_name?: string;
  billAmount?: number;
  bill_amount?: number;
  supplierBillNo?: string;
  supplier_bill_no?: string;
  purchaseBillNo?: string;
  purchase_bill_no?: string;
  purchasePaymentStatus?: string;
  purchase_payment_status?: string;
  purchasePaymentMode?: string;
  purchase_payment_mode?: string;
  purchasePaidAmount?: number;
  purchase_paid_amount?: number;
  purchaseDueAmount?: number;
  purchase_due_amount?: number;
  purchaseDueDate?: string;
  purchase_due_date?: string;
  note?: string;
  reason?: string;
  createdAt?: string;
  created_at?: string;
  sync_status?: string;
};

const initialForm: MovementForm = {
  productId: "",
  movementType: "purchase",
  quantity: "1",
  unit: "piece",
  supplierId: "none",
  supplierName: "",
  billAmount: "",
  supplierBillNo: "",
  purchasePaymentStatus: "paid",
  purchasePaymentMode: "cash",
  purchasePaidAmount: "",
  purchaseDueDate: "",
  costPrice: "",
  minPrice: "",
  sellingPrice: "",
  reason: "",
  minMarginPercent: "",
  sellingMarginPercent: "",
};

function round2(value: number) {
  return roundInventoryValue(value);
}

function displayQtyFromBase(baseQty: number | undefined, unit: string | null | undefined) {
  return round2(Number(baseQty || 0) / (CONVERSION[unit || "piece"] ?? 1));
}

function toBaseQty(quantity: number, unit: string) {
  return round2(quantity * (CONVERSION[unit] ?? 1));
}

function isLowStock(product: InventoryItem) {
  if ((product.stockTrackingEnabled ?? product.trackStock ?? true) === false) return false;
  return Number(product.stockBaseQty ?? 0) <= Number(product.lowStockThreshold ?? 0);
}

function movementLabel(type: string) {
  if (type === "purchase") return "Purchase";
  if (type === "sale") return "Sale";
  if (type === "damage") return "Damage/Wastage";
  if (type === "correction") return "Correction";
  return type;
}

function movementClass(type: string) {
  if (type === "purchase") return "secondary" as const;
  if (type === "sale") return "outline" as const;
  if (type === "damage") return "destructive" as const;
  return "default" as const;
}

function safeDate(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function fmtMoney(value: unknown) {
  return `Rs ${money(value).toLocaleString("en-IN")}`;
}

function purchaseTotal(row: MovementEntry) {
  return money(row.billAmount ?? row.bill_amount);
}

function purchasePaid(row: MovementEntry) {
  const explicit = row.purchasePaidAmount ?? row.purchase_paid_amount;
  if (explicit !== undefined && explicit !== null) return money(explicit);
  const status = String(row.purchasePaymentStatus ?? row.purchase_payment_status ?? "paid").toLowerCase();
  if (status === "due" || status === "unpaid") return 0;
  return purchaseTotal(row);
}

function purchaseDue(row: MovementEntry) {
  const explicit = row.purchaseDueAmount ?? row.purchase_due_amount;
  if (explicit !== undefined && explicit !== null) return money(explicit);
  return Math.max(0, purchaseTotal(row) - purchasePaid(row));
}

function purchaseStatus(row: MovementEntry) {
  const status = String(row.purchasePaymentStatus ?? row.purchase_payment_status ?? "").toLowerCase();
  if (status === "due" || status === "unpaid") return "Due";
  if (status === "partial") return "Partial";
  if (purchaseDue(row) > 0) return "Partial";
  return "Paid";
}

export default function InventoryPage() {
  const { toast } = useToast();
  const manageInventory = usePermission("manage_inventory");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovementForm>(initialForm);
  const [savingManualSale, setSavingManualSale] = useState(false);
  const [ownerPinOpen, setOwnerPinOpen] = useState(false);

  const inventory = useGetInventory();
  const lowStock = useGetLowStock();
  const ledger = useGetStockLedger({ limit: 200 });
  const products = useListProducts({ limit: 1000 });
  const suppliers = useListSuppliers();

  const recordPurchase = useRecordPurchase({ mutation: { onSuccess: () => afterMovementSaved("Purchase saved locally"), onError: showError } });
  const recordDamage = useRecordDamage({ mutation: { onSuccess: () => afterMovementSaved("Damage saved locally"), onError: showError } });
  const stockCorrection = useStockCorrection({ mutation: { onSuccess: () => afterMovementSaved("Stock correction saved locally"), onError: showError } });

  function showError(error: unknown) {
    toast({ title: "Could not save stock movement", description: (error as { message?: string })?.message ?? "Please check the form.", variant: "destructive" });
  }

  function refreshQueries() {
    queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLowStockQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStockLedgerQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
  }

  function afterMovementSaved(title: string) {
    refreshQueries();
    setDialogOpen(false);
    setForm(initialForm);
    toast({ title, description: "Inventory is updated locally and will sync when internet is available." });
  }

  const inventoryRows = useMemo(() => {
    const q = search.toLowerCase();
    return (inventory.data ?? [])
      .filter((item) => !(item as { deletedAt?: unknown; deleted_at?: unknown }).deletedAt && !(item as { deleted_at?: unknown }).deleted_at)
      .filter((item) => !q || [item.name, item.category, item.barcode, ...(item.aliases ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [inventory.data, search]);

  const movementRows = useMemo(() => ((ledger.data?.entries ?? []) as MovementEntry[]), [ledger.data]);

  const stockStats = useMemo(() => {
    const rows = (inventory.data ?? []).filter((item) => !(item as { deletedAt?: unknown }).deletedAt);
    const tracked = rows.filter((item) => (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false);
    const stockValue = tracked.reduce((sum, item) => sum + Number(item.stockBaseQty ?? 0) * Number(item.costPerRateUnit ?? item.costPrice ?? 0) / (CONVERSION[item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece"] ?? 1), 0);
    return {
      products: rows.length,
      lowStock: (lowStock.data ?? rows.filter(isLowStock)).length,
      stockValue: round2(stockValue),
    };
  }, [inventory.data, lowStock.data]);

  const movementSummary = useMemo(() => {
    const purchaseRows = movementRows.filter((row) => (row.action ?? row.type) === "purchase");
    const purchases = purchaseRows.length;
    const sales = movementRows.filter((row) => (row.action ?? row.type) === "sale").length;
    const damage = movementRows.filter((row) => (row.action ?? row.type) === "damage").length;
    const purchasePaidTotal = purchaseRows.reduce((sum, row) => sum + purchasePaid(row), 0);
    const purchaseDueTotal = purchaseRows.reduce((sum, row) => sum + purchaseDue(row), 0);
    return { purchases, sales, damage, purchasePaidTotal: round2(purchasePaidTotal), purchaseDueTotal: round2(purchaseDueTotal) };
  }, [movementRows]);


  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ draft?: Partial<MovementForm> & { productName?: string; quantity?: number; billAmount?: number; costPrice?: number; minPrice?: number; sellingPrice?: number; minMarginPercent?: number; sellingMarginPercent?: number } }>).detail;
      const draft = detail?.draft;
      if (!draft) return;
      if (!manageInventory.allowed) {
        toast({ title: "Permission denied", description: manageInventory.reason, variant: "destructive" });
        return;
      }
      const lookupName = String(draft.productName ?? "").trim().toLowerCase();
      const matchedProduct = lookupName
        ? (products.data ?? []).find((product: Product) => {
            const aliases = product.aliases ?? [];
            return product.name.toLowerCase().includes(lookupName)
              || aliases.some((alias) => alias.toLowerCase().includes(lookupName));
          })
        : undefined;
      const unit = draft.unit ?? matchedProduct?.unit ?? matchedProduct?.displayUnit ?? matchedProduct?.rateUnit ?? "piece";
      setForm({
        ...initialForm,
        movementType: draft.movementType ?? "purchase",
        productId: matchedProduct?.id ?? "",
        quantity: draft.quantity !== undefined ? String(draft.quantity) : "1",
        unit,
        supplierId: "none",
        supplierName: draft.supplierName ?? "",
        billAmount: draft.billAmount !== undefined ? String(draft.billAmount) : "",
        supplierBillNo: "",
        purchasePaymentStatus: "paid",
        purchasePaymentMode: "cash",
        purchasePaidAmount: draft.billAmount !== undefined ? String(draft.billAmount) : "",
        purchaseDueDate: "",
        costPrice: draft.costPrice !== undefined ? String(draft.costPrice) : matchedProduct ? String(matchedProduct.averageCostPrice ?? matchedProduct.costPrice ?? matchedProduct.costPerRateUnit ?? "") : "",
        minPrice: draft.minPrice !== undefined ? String(draft.minPrice) : matchedProduct ? String(matchedProduct.minimumSellingPrice ?? matchedProduct.minPricePerRateUnit ?? "") : "",
        sellingPrice: draft.sellingPrice !== undefined ? String(draft.sellingPrice) : matchedProduct ? String(matchedProduct.sellingPrice ?? matchedProduct.defaultPricePerRateUnit ?? "") : "",
        minMarginPercent: draft.minMarginPercent !== undefined ? String(draft.minMarginPercent) : "",
        sellingMarginPercent: draft.sellingMarginPercent !== undefined ? String(draft.sellingMarginPercent) : "",
        reason: draft.reason ?? (draft.movementType === "correction" ? "Voice stock correction" : "Voice inventory entry"),
      });
      setDialogOpen(true);
      toast({
        title: matchedProduct ? "Inventory entry prepared" : "Product not matched",
        description: matchedProduct ? "Voice assistant filled the movement form. Review and save locally." : "Select the product manually, then save locally.",
        variant: matchedProduct ? "default" : "destructive",
      });
    };
    window.addEventListener("kirana:voice-inventory-draft", handler);
    return () => window.removeEventListener("kirana:voice-inventory-draft", handler);
  }, [manageInventory.allowed, manageInventory.reason, products.data, toast]);

  const selectedProduct = (products.data ?? []).find((product: Product) => product.id === form.productId);
  const selectedSupplier = (suppliers.data ?? []).find((supplier: Supplier) => supplier.id === form.supplierId);
  const selectedProductUnit = selectedProduct?.unit ?? selectedProduct?.displayUnit ?? selectedProduct?.rateUnit ?? form.unit;
  const currentAverageCost = round2(Number(selectedProduct?.averageCostPrice ?? selectedProduct?.costPrice ?? selectedProduct?.costPerRateUnit ?? 0));
  const purchaseQuantity = Math.max(Number(form.quantity) || 0, 0);
  const priceSuggestions = calculateInventoryPriceSuggestions({
    currentStockBaseQty: Number(selectedProduct?.stockBaseQty ?? 0),
    currentAverageCost,
    purchaseQuantity,
    purchaseUnit: form.unit,
    productBaseUnit: selectedProduct?.baseUnit ?? selectedProductUnit,
    productRateUnit: selectedProduct?.rateUnit ?? selectedProductUnit,
    purchaseUnitCost: Number(form.costPrice || 0) || undefined,
    billAmount: Number(form.billAmount || 0) || undefined,
    minMarginPercent: Number(form.minMarginPercent || 0) || undefined,
    sellingMarginPercent: Number(form.sellingMarginPercent || 0) || undefined,
  });
  const purchaseBaseQty = priceSuggestions.purchaseBaseQty;
  const purchaseQtyInProductUnit = priceSuggestions.purchaseQtyInRateUnit || purchaseQuantity;
  const purchaseUnitCost = priceSuggestions.purchaseUnitCost;
  const projectedAverageCost = form.movementType === "purchase" && selectedProduct ? priceSuggestions.projectedAverageCost : currentAverageCost;
  const minMarginSuggestion = priceSuggestions.minPriceSuggestion;
  const sellingMarginSuggestion = priceSuggestions.sellingPriceSuggestion;
  const unitMismatchWarning = selectedProduct ? buildUnitMismatchWarning(form.unit, selectedProductUnit) : undefined;
  const purchaseBillAmount = form.billAmount ? round2(Number(form.billAmount)) : round2(purchaseQuantity * (purchaseUnitCost || 0));
  const purchasePaidAmount = form.movementType === "purchase"
    ? form.purchasePaymentStatus === "due"
      ? 0
      : form.purchasePaymentStatus === "paid"
        ? purchaseBillAmount
        : round2(Number(form.purchasePaidAmount || 0))
    : 0;
  const purchaseDueAmount = form.movementType === "purchase" ? Math.max(0, round2(purchaseBillAmount - purchasePaidAmount)) : 0;

  function applyMarginPrices() {
    setForm((current) => ({
      ...current,
      minPrice: current.minMarginPercent ? String(minMarginSuggestion) : current.minPrice,
      sellingPrice: current.sellingMarginPercent ? String(sellingMarginSuggestion) : current.sellingPrice,
    }));
  }

  function openMovement(type: MovementType, product?: Product | InventoryItem) {
    if (!manageInventory.allowed) {
      toast({ title: "Permission denied", description: manageInventory.reason, variant: "destructive" });
      return;
    }
    const unit = product?.unit ?? product?.displayUnit ?? product?.rateUnit ?? "piece";
    setForm({
      ...initialForm,
      movementType: type,
      productId: product?.id ?? "",
      unit,
      supplierId: "none",
      costPrice: product ? String(product.costPrice ?? product.costPerRateUnit ?? "") : "",
      minPrice: product ? String(product.minimumSellingPrice ?? product.minPricePerRateUnit ?? "") : "",
      sellingPrice: product ? String(product.sellingPrice ?? product.defaultPricePerRateUnit ?? "") : "",
      reason: type === "correction" ? "Physical stock count correction" : "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    const quantity = Number(form.quantity);
    if (!form.productId) {
      toast({ title: "Select product", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: "Enter valid quantity", variant: "destructive" });
      return;
    }
    if (form.movementType === "purchase") {
      if (purchaseBillAmount <= 0) {
        toast({ title: "Enter purchase bill amount", description: "Supplier purchase bill amount is needed for payment/due tracking.", variant: "destructive" });
        return;
      }
      if (purchasePaidAmount < 0 || purchasePaidAmount > purchaseBillAmount) {
        toast({ title: "Invalid paid amount", description: "Paid amount cannot be negative or greater than purchase bill amount.", variant: "destructive" });
        return;
      }
    }
    if (!manageInventory.allowed) {
      toast({ title: "Permission denied", description: manageInventory.reason, variant: "destructive" });
      return;
    }
    if (form.movementType === "correction") {
      setOwnerPinOpen(true);
      return;
    }

    await submitMovement();
  }

  async function submitMovement(ownerPin?: string, ownerPinReason?: string) {
    const quantity = Number(form.quantity);
    const payload = {
      productId: form.productId,
      productName: selectedProduct?.name,
      quantity,
      quantityDelta: form.movementType === "correction" ? toBaseQty(quantity, form.unit) : undefined,
      enteredUnit: form.unit,
      unit: form.unit,
      supplierId: form.supplierId === "none" ? undefined : form.supplierId,
      supplierName: selectedSupplier?.name ?? (form.supplierName || undefined),
      billAmount: form.movementType === "purchase" ? purchaseBillAmount : form.billAmount ? Number(form.billAmount) : undefined,
      supplierBillNo: form.supplierBillNo || undefined,
      purchasePaymentStatus: form.movementType === "purchase" ? form.purchasePaymentStatus : undefined,
      purchasePaymentMode: form.movementType === "purchase" && purchasePaidAmount > 0 ? form.purchasePaymentMode : undefined,
      purchasePaidAmount: form.movementType === "purchase" ? purchasePaidAmount : undefined,
      purchaseDueAmount: form.movementType === "purchase" ? purchaseDueAmount : undefined,
      purchaseDueDate: form.purchaseDueDate || undefined,
      purchaseBillNo: form.movementType === "purchase" ? `LPB-${Date.now().toString().slice(-6)}` : undefined,
      costPerRateUnit: form.movementType === "purchase" ? purchaseUnitCost || undefined : form.costPrice ? Number(form.costPrice) : undefined,
      reason: ownerPinReason || form.reason || undefined,
      note: ownerPinReason || form.reason || undefined,
      ownerPin: ownerPin || undefined,
    };

    if (form.movementType === "purchase") {
      recordPurchase.mutate({ data: payload });
      await maybeUpdateProductPrices();
      return;
    }
    if (form.movementType === "damage") {
      recordDamage.mutate({ data: payload });
      return;
    }
    if (form.movementType === "correction") {
      stockCorrection.mutate({ data: payload });
      return;
    }

    setSavingManualSale(true);
    try {
      await recordSaleLocalFirst(payload);
      afterMovementSaved("Sale movement saved locally");
    } catch (error) {
      showError(error);
    } finally {
      setSavingManualSale(false);
    }
  }

  async function maybeUpdateProductPrices() {
    if (!form.productId) return;
    const update: Record<string, number | string> = {};
    // Average cost is updated by the purchase movement using weighted average.
    if (form.minPrice || form.minMarginPercent) update.minPricePerRateUnit = Number(form.minPrice || minMarginSuggestion);
    if (form.sellingPrice || form.sellingMarginPercent) update.defaultPricePerRateUnit = Number(form.sellingPrice || sellingMarginSuggestion);
    if (Object.keys(update).length === 0) return;
    try {
      await patchProductLocalFirst(form.productId, update, undefined, form.reason || undefined);
    } catch {
      // Movement should still save; product price update can be corrected later.
    }
  }

  const isSaving = recordPurchase.isPending || recordDamage.isPending || stockCorrection.isPending || savingManualSale;

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Stock health, purchase entries, and corrections in one offline-ready workspace."
        actions={(
          <>
            <Button variant="outline" onClick={() => openMovement("correction")}><ShieldAlert size={16} className="mr-1.5" />Correct</Button>
            <Button onClick={() => openMovement("purchase")}><PackageCheck size={16} className="mr-1.5" />Stock entry</Button>
          </>
        )}
      />

      <StatsGrid columns={3}>
        <StatCard label="Products" value={stockStats.products} />
        <StatCard label="Low stock alerts" value={stockStats.lowStock} tone="amber" />
        <StatCard label="Approx. stock value" value={fmtMoney(stockStats.stockValue)} tone="green" />
      </StatsGrid>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 md:max-w-3xl">
          <TabsTrigger value="dashboard">Stock</TabsTrigger>
          <TabsTrigger value="movements">History</TabsTrigger>
          <TabsTrigger value="purchase-bills">Bills</TabsTrigger>
          <TabsTrigger value="reports">Insights</TabsTrigger>
          <TabsTrigger value="batch">Batch</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <FilterBar>
            <SearchInputWithIcon label="Search stock" placeholder="Search stock by product, alias, barcode..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </FilterBar>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Stock</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="p-4"><Skeleton className="h-6 w-full" /></td></tr>)
                  ) : inventoryRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No inventory rows found</td></tr>
                  ) : inventoryRows.map((item) => {
                    const unit = item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece";
                    const qty = displayQtyFromBase(item.stockBaseQty, unit);
                    const alertQty = displayQtyFromBase(item.lowStockThreshold, unit);
                    const low = isLowStock(item);
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 min-w-[240px]"><p className="font-semibold flex items-center gap-2">{item.name}{low ? <AlertTriangle size={14} className="text-orange-600" /> : null}</p><p className="text-xs text-muted-foreground">{item.category ?? "general"}</p></td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold">{(item.stockTrackingEnabled ?? item.trackStock ?? true) === false ? "Not tracked" : `${qty} ${unit}`}</p>
                          <p className="text-[10px] text-muted-foreground">Alert at {alertQty} {unit}</p>
                        </td>
                        <td className="px-4 py-3 text-right">{fmtMoney(round2(item.averageCostPrice ?? item.costPerRateUnit ?? item.costPrice ?? 0))}</td>
                        <td className="px-4 py-3 text-center"><Badge variant={low ? "destructive" : "secondary"}>{low ? "Low stock" : "OK"}</Badge></td>
                        <td className="px-4 py-3"><div className="flex justify-center gap-2"><Button size="sm" variant="outline" onClick={() => openMovement("purchase", item)}>Purchase</Button><Button size="sm" variant="outline" onClick={() => openMovement("correction", item)}>Correct</Button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          <StatsGrid columns={3}>
            <StatCard label="Purchases" value={movementSummary.purchases} />
            <StatCard label="Sales" value={movementSummary.sales} tone="blue" />
            <StatCard label="Damage" value={movementSummary.damage} tone="amber" />
          </StatsGrid>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 border-b"><tr><th className="px-4 py-3 text-left">Product</th><th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-right">Qty delta</th><th className="px-4 py-3 text-left">Supplier / Note</th><th className="px-4 py-3 text-center">Sync</th><th className="px-4 py-3 text-right">Time</th></tr></thead>
              <tbody>
                {movementRows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No stock movements yet</td></tr> : movementRows.map((entry) => {
                  const type = entry.action ?? entry.type ?? "movement";
                  const qty = Number(entry.quantityDelta ?? entry.quantity_delta ?? 0);
                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{entry.productName ?? "-"}</td>
                      <td className="px-4 py-3"><Badge variant={movementClass(type)}>{movementLabel(type)}</Badge></td>
                      <td className="px-4 py-3 text-right">{qty > 0 ? "+" : ""}{qty} {entry.unit ?? ""}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[260px] truncate">{entry.supplierName ?? entry.supplier_name ?? entry.note ?? entry.reason ?? "-"}</td>
                      <td className="px-4 py-3 text-center"><Badge variant="outline">{entry.sync_status ?? "local"}</Badge></td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs">{format(safeDate(entry.createdAt ?? entry.created_at), "d MMM, h:mm a")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>



        <TabsContent value="purchase-bills" className="space-y-4">
          <StatsGrid columns={3}>
            <StatCard label="Purchase bills" value={movementSummary.purchases} />
            <StatCard label="Supplier paid" value={fmtMoney(movementSummary.purchasePaidTotal)} tone="green" />
            <StatCard label="Supplier due" value={fmtMoney(movementSummary.purchaseDueTotal)} tone="amber" />
          </StatsGrid>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Purchase bill</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Supplier</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Bill amount</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Paid</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Due</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {movementRows.filter((entry) => (entry.action ?? entry.type) === "purchase").length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No purchase bills yet. Click Purchase and save supplier payment status.</td></tr>
                  ) : movementRows.filter((entry) => (entry.action ?? entry.type) === "purchase").map((entry) => (
                    <tr key={`purchase-bill-${entry.id}`} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3"><p className="font-semibold">{entry.purchaseBillNo ?? entry.purchase_bill_no ?? "Local purchase"}</p><p className="text-xs text-muted-foreground">Supplier bill: {entry.supplierBillNo ?? entry.supplier_bill_no ?? "Not set"}</p></td>
                      <td className="px-4 py-3">{entry.supplierName ?? entry.supplier_name ?? "No supplier"}</td>
                      <td className="px-4 py-3">{entry.productName ?? entry.productId ?? entry.product_id ?? "Product"}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtMoney(purchaseTotal(entry))}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmtMoney(purchasePaid(entry))}</td>
                      <td className="px-4 py-3 text-right text-orange-700">{fmtMoney(purchaseDue(entry))}</td>
                      <td className="px-4 py-3 text-center"><Badge variant={purchaseDue(entry) > 0 ? "destructive" : "secondary"}>{purchaseStatus(entry)}</Badge></td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{format(safeDate(entry.createdAt ?? entry.created_at), "d MMM, h:mm a")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Purchase bills are saved locally and included in dashboard and daily closing numbers.</p>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-4"><TrendingUp size={18} className="mb-2" /><p className="font-semibold">Fast movers</p><p className="mt-1 text-xs text-muted-foreground">Ranks products after sale history is available.</p></div>
            <div className="rounded-lg border bg-card p-4"><TrendingDown size={18} className="mb-2" /><p className="font-semibold">Slow movers</p><p className="mt-1 text-xs text-muted-foreground">Compares stock age with sale movement.</p></div>
            <div className="rounded-lg border bg-card p-4"><BarChart3 size={18} className="mb-2" /><p className="font-semibold">Dead stock</p><p className="mt-1 text-xs text-muted-foreground">Flags stock with no recent movement.</p></div>
          </div>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4">
          <div className="rounded-lg border bg-card p-4 flex gap-4">
            <CalendarClock className="text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">Batch and expiry support</h3><Badge>Higher plan</Badge></div>
              <p className="mt-1 text-sm text-muted-foreground">Attach batch, expiry, MRP, and lot-wise stock to purchase movements.</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{movementLabel(form.movementType)} entry</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid md:grid-cols-2 gap-3">
              <div><Label>Movement type</Label><Select value={form.movementType} onValueChange={(value) => setForm((current) => ({ ...current, movementType: value as MovementType }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="purchase">Purchase</SelectItem><SelectItem value="sale">Manual sale</SelectItem><SelectItem value="damage">Damage / wastage</SelectItem><SelectItem value="correction">Stock correction</SelectItem></SelectContent></Select></div>
              <div><Label>Product *</Label><Select value={form.productId} onValueChange={(value) => { const product = (products.data ?? []).find((row: Product) => row.id === value); setForm((current) => ({ ...current, productId: value, unit: product?.unit ?? product?.displayUnit ?? product?.rateUnit ?? current.unit, costPrice: String(product?.averageCostPrice ?? product?.costPrice ?? product?.costPerRateUnit ?? current.costPrice), minPrice: String(product?.minimumSellingPrice ?? product?.minPricePerRateUnit ?? current.minPrice), sellingPrice: String(product?.sellingPrice ?? product?.defaultPricePerRateUnit ?? current.sellingPrice) })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select product" /></SelectTrigger><SelectContent>{(products.data ?? []).map((product: Product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div><Label>{form.movementType === "correction" ? "New stock / delta" : "Quantity"}</Label><Input type="number" step="0.01" className="mt-1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></div>
              <div><Label>Unit</Label><Select value={form.unit} onValueChange={(value) => setForm((current) => ({ ...current, unit: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select>{unitMismatchWarning ? <p className="mt-1 text-xs text-orange-700">{unitMismatchWarning}</p> : null}</div>
              <div><Label>Total bill amount</Label><Input type="number" step="0.01" className="mt-1" value={form.billAmount} onChange={(event) => setForm((current) => ({ ...current, billAmount: event.target.value }))} disabled={form.movementType !== "purchase"} /></div>
            </div>
            {form.movementType === "purchase" ? (
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Supplier</Label><Select value={form.supplierId} onValueChange={(value) => setForm((current) => ({ ...current, supplierId: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No supplier</SelectItem>{(suppliers.data ?? []).map((supplier: Supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Supplier name if not saved</Label><Input className="mt-1" value={form.supplierName} onChange={(event) => setForm((current) => ({ ...current, supplierName: event.target.value }))} /></div>
              </div>
            ) : null}
            {form.movementType === "purchase" ? (
              <div className="rounded-xl border bg-muted/40 p-3 space-y-3">
                <div className="flex items-center gap-2"><Wallet size={16} /><p className="font-medium text-sm">Supplier payment tracking</p></div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>Supplier bill no.</Label><Input className="mt-1" value={form.supplierBillNo} onChange={(event) => setForm((current) => ({ ...current, supplierBillNo: event.target.value }))} placeholder="Optional" /></div>
                  <div><Label>Payment status</Label><Select value={form.purchasePaymentStatus} onValueChange={(value) => setForm((current) => ({ ...current, purchasePaymentStatus: value as MovementForm["purchasePaymentStatus"], purchasePaidAmount: value === "paid" ? String(purchaseBillAmount || "") : value === "due" ? "0" : current.purchasePaidAmount }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="paid">Paid</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="due">Due</SelectItem></SelectContent></Select></div>
                  <div><Label>Payment mode</Label><Select value={form.purchasePaymentMode} onValueChange={(value) => setForm((current) => ({ ...current, purchasePaymentMode: value as MovementForm["purchasePaymentMode"] }))} disabled={form.purchasePaymentStatus === "due"}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI / bank</SelectItem></SelectContent></Select></div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>Paid amount</Label><Input type="number" step="0.01" className="mt-1" value={form.purchasePaymentStatus === "paid" ? String(purchaseBillAmount || "") : form.purchasePaidAmount} onChange={(event) => setForm((current) => ({ ...current, purchasePaidAmount: event.target.value, purchasePaymentStatus: current.purchasePaymentStatus === "paid" ? "partial" : current.purchasePaymentStatus }))} disabled={form.purchasePaymentStatus !== "partial"} /></div>
                  <div><Label>Due amount</Label><Input className="mt-1" value={fmtMoney(purchaseDueAmount)} readOnly /></div>
                  <div><Label>Due date</Label><Input type="date" className="mt-1" value={form.purchaseDueDate} onChange={(event) => setForm((current) => ({ ...current, purchaseDueDate: event.target.value }))} disabled={purchaseDueAmount <= 0} /></div>
                </div>
                <p className="text-xs text-muted-foreground">This creates a local purchase bill history row and helps Dashboard/Closing calculate supplier cash out and supplier dues.</p>
              </div>
            ) : null}
            {form.movementType === "purchase" ? (
              <div className="rounded-xl border bg-muted/40 p-3 space-y-4">
                <div className="flex items-center gap-2"><ClipboardList size={16} /><p className="font-medium text-sm">Average costing and price suggestion</p></div>
                <div className="grid gap-2 rounded-lg border bg-background p-3 text-sm sm:grid-cols-3">
                  <div><p className="text-xs text-muted-foreground">Current avg cost</p><p className="font-bold">{fmtMoney(currentAverageCost)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Purchase unit cost</p><p className="font-bold">{fmtMoney(purchaseUnitCost || 0)}</p></div>
                  <div><p className="text-xs text-muted-foreground">New avg after save</p><p className="font-bold text-primary">{fmtMoney(projectedAverageCost || 0)}</p></div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>Cost price / unit</Label><Input type="number" step="0.01" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} placeholder="Auto from bill amount" /></div>
                  <div><Label>Minimum margin %</Label><Input type="number" step="0.01" value={form.minMarginPercent} onChange={(event) => setForm((current) => ({ ...current, minMarginPercent: event.target.value }))} placeholder="e.g. 5" /><p className="mt-1 text-xs text-muted-foreground">Suggestion: {fmtMoney(minMarginSuggestion || 0)}</p></div>
                  <div><Label>Selling margin %</Label><Input type="number" step="0.01" value={form.sellingMarginPercent} onChange={(event) => setForm((current) => ({ ...current, sellingMarginPercent: event.target.value }))} placeholder="e.g. 12" /><p className="mt-1 text-xs text-muted-foreground">Suggestion: {fmtMoney(sellingMarginSuggestion || 0)}</p></div>
                </div>
                <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3"><div><Label>Minimum price</Label><Input type="number" step="0.01" value={form.minPrice} onChange={(event) => setForm((current) => ({ ...current, minPrice: event.target.value }))} /></div><div><Label>Selling price</Label><Input type="number" step="0.01" value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></div><Button type="button" variant="outline" className="self-end" onClick={applyMarginPrices}>Apply margin</Button></div>
              </div>
            ) : null}
            {form.movementType === "correction" ? <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 flex gap-2"><ShieldAlert size={16} /> Stock correction requires owner PIN and creates a pending sync correction.</div> : null}
            <div><Label>Reason / note</Label><Input className="mt-1" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="e.g. physical count, damaged packet" />{form.movementType === "correction" ? <p className="mt-1 text-xs text-orange-700">Owner password/PIN will be asked after you click Save locally.</p> : null}</div>
            <div className="flex gap-3 pt-2"><Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancel</Button><Button className="flex-1" onClick={handleSubmit} disabled={isSaving}>{isSaving ? <Loader2 size={14} className="animate-spin" /> : "Save locally"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <OwnerPinModal
        open={ownerPinOpen}
        onCancel={() => setOwnerPinOpen(false)}
        title="Owner approval required"
        description="Stock correction changes real inventory. Enter owner password/PIN to save locally."
        confirmLabel="Save correction"
        loading={isSaving}
        reasonRequired
        onConfirm={({ ownerPin, reason }) => {
          setOwnerPinOpen(false);
          void submitMovement(ownerPin, reason);
        }}
      />
    </PageShell>
  );
}
