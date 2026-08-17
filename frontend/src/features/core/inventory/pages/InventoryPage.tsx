import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  Ellipsis,
  History,
  IndianRupee,
  Loader2,
  Package,
  PackagePlus,
  PackageX,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { patchProductLocalFirst } from "@/features/core/products/local-actions";
import { recordSaleLocalFirst } from "@/features/core/inventory/local-actions";
import { usePermission } from "@/features/core/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { cn } from "@/lib/utils";
import {
  buildUnitMismatchWarning,
  calculateInventoryPriceSuggestions,
  roundInventoryValue,
} from "@/features/core/inventory/calculations";
import {
  activeInventorySellingUnits,
  findInventorySellingUnit,
  inventoryAverageUnitCost,
  inventoryConversionToBase,
  inventoryDisplayQuantity,
  inventoryMovementUnit,
  inventoryQuantityToBase,
  inventorySimpleUnit,
  inventoryStockRows,
  inventoryStockValue,
  inventoryUnitLabel,
  mergeInventoryRows,
} from "@/features/core/inventory/stock-display";
import { PageShell, StatCard, StatsGrid } from "@/components/shared";
import { offlineDB } from "@/lib/offline/db";
import { ACTIVITY_EVENTS, trackEvent } from "@/lib/activity";

const UNITS = [
  "piece", "dozen", "set", "pair", "bundle", "roll", "sheet",
  "kg", "gram", "litre", "ml",
  "meter", "yard",
  "packet", "pack", "pouch", "box", "carton", "bottle", "jar", "can", "sachet",
  "strip", "tablet", "bottle", "tube",
  "plate", "glass",
  "custom",
];

type MovementType = "purchase" | "sale" | "damage" | "correction";
type InventoryTab = "dashboard" | "movements" | "purchase-bills" | "reports" | "batch";

const STOCK_ROWS_PER_PAGE = 8;

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

// Not a component and not a hook: it is called from `.filter()` and from the
// Export click handler. The `useAppLanguage()` an earlier i18n pass left here
// read nothing, and a hook called outside render throws — which took the Export
// button down with it.
function isLowStock(product: InventoryItem) {
  if ((product.stockTrackingEnabled ?? product.trackStock ?? true) === false) return false;
  // Both sides are base units; no threshold (0) means never "low" — matches the backend filter.
  const threshold = Number(product.lowStockThreshold ?? 0);
  return threshold > 0 && Number(product.stockBaseQty ?? 0) <= threshold;
}

function movementLabel(type: string, t: Translate) {
  if (type === "purchase") return t("inventory.page.purchase");
  if (type === "sale") return t("inventory.page.manualSale");
  if (type === "damage") return t("inventory.page.damage");
  if (type === "correction") return t("inventory.page.correction");
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
  return `\u20B9${money(value).toLocaleString("en-IN")}`;
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

function purchaseStatus(row: MovementEntry, t: Translate) {
  const status = String(row.purchasePaymentStatus ?? row.purchase_payment_status ?? "").toLowerCase();
  if (status === "due" || status === "unpaid") return t("inventory.page.due");
  if (status === "partial") return t("inventory.page.partial");
  if (purchaseDue(row) > 0) return t("inventory.page.partial");
  return t("inventory.page.paid");
}

/** §13 INVENTORY_VIEW — one event per visit, not per re-render. */
function useTrackedInventoryView() {
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent(ACTIVITY_EVENTS.INVENTORY_VIEW, {});
  }, []);
}

export default function InventoryPage() {
  const { t } = useAppLanguage();
  useTrackedInventoryView();
  const { toast } = useToast();
  const manageInventory = usePermission("manage_inventory");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<InventoryTab>("dashboard");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [stockPage, setStockPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MovementForm>(initialForm);
  const [savingManualSale, setSavingManualSale] = useState(false);
  const [ownerPinOpen, setOwnerPinOpen] = useState(false);
  const [localProductRows, setLocalProductRows] = useState<InventoryItem[]>([]);

  const inventory = useGetInventory();
  const lowStock = useGetLowStock();
  const ledger = useGetStockLedger({ limit: 200 });
  const products = useListProducts({ limit: 1000 });
  const suppliers = useListSuppliers();

  const recordPurchase = useRecordPurchase({ mutation: { onSuccess: () => afterMovementSaved(t("inventory.page.purchaseSaved")), onError: showError } });
  const recordDamage = useRecordDamage({ mutation: { onSuccess: () => afterMovementSaved(t("inventory.page.damageSaved")), onError: showError } });
  const stockCorrection = useStockCorrection({ mutation: { onSuccess: () => afterMovementSaved(t("inventory.page.correctionSaved")), onError: showError } });

  function showError(error: unknown) {
    toast({ title: t("inventory.page.saveFailed"), description: (error as { message?: string })?.message ?? t("inventory.page.checkForm"), variant: "destructive" });
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
    toast({ title, description: t("inventory.page.savedLocally") });
  }

  useEffect(() => {
    let cancelled = false;
    const loadLocalProducts = async () => {
      const rows = await offlineDB.getAll<Product>("products").catch(() => []);
      if (!cancelled) setLocalProductRows(rows as unknown as InventoryItem[]);
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

  const allInventoryRows = useMemo(() => {
    const inventoryRows = inventory.data ?? [];
    const productRows = (products.data ?? []) as unknown as InventoryItem[];
    return mergeInventoryRows(productRows, inventoryRows, localProductRows);
  }, [inventory.data, localProductRows, products.data]);

  const filterOptions = useMemo(() => ({
    categories: [...new Set(allInventoryRows.map((item) => item.category?.trim()).filter(Boolean) as string[])].sort(),
    brands: [...new Set(allInventoryRows.map((item) => item.brand?.trim()).filter(Boolean) as string[])].sort(),
    units: [...new Set(allInventoryRows.map((item) => inventoryUnitLabel(item).trim()).filter(Boolean))].sort(),
  }), [allInventoryRows]);

  const inventoryRows = useMemo(() => {
    const q = search.toLowerCase();
    return allInventoryRows
      .filter((item) => !q || [item.name, item.category, item.brand, item.barcode, item.sku, ...(item.aliases ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q))
      .filter((item) => categoryFilter === "all" || item.category === categoryFilter)
      .filter((item) => brandFilter === "all" || item.brand === brandFilter)
      .filter((item) => unitFilter === "all" || inventoryUnitLabel(item) === unitFilter)
      .filter((item) => {
        const tracked = (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false;
        const qty = Number(item.stockBaseQty ?? 0);
        if (stockFilter === "out") return tracked && qty <= 0;
        if (stockFilter === "low") return tracked && qty > 0 && isLowStock(item);
        if (stockFilter === "in") return !tracked || (qty > 0 && !isLowStock(item));
        return true;
      });
  }, [allInventoryRows, brandFilter, categoryFilter, search, stockFilter, unitFilter]);

  const movementRows = useMemo(() => ((ledger.data?.entries ?? []) as MovementEntry[]), [ledger.data]);

  const stockStats = useMemo(() => {
    const rows = allInventoryRows;
    const tracked = rows.filter((item) => (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false);
    const stockValue = tracked.reduce((sum, item) => sum + inventoryStockValue(item), 0);
    const totalQuantity = tracked.reduce((sum, item) => sum + inventoryDisplayQuantity(item), 0);
    const soldLast30Days = movementRows
      .filter((row) => (row.action ?? row.type) === "sale" && safeDate(row.createdAt ?? row.created_at).getTime() >= Date.now() - 30 * 86_400_000)
      .reduce((sum, row) => sum + Math.abs(Number(row.quantityDelta ?? row.quantity_delta ?? 0)), 0);
    const localLowStock = rows.filter(isLowStock);
    const remoteLowStock = lowStock.data ?? [];
    return {
      products: rows.length,
      lowStock: (remoteLowStock.length > 0 ? remoteLowStock : localLowStock).length,
      outOfStock: tracked.filter((item) => Number(item.stockBaseQty ?? 0) <= 0).length,
      totalQuantity: roundInventoryValue(totalQuantity),
      stockValue: roundInventoryValue(stockValue),
      turnover30: totalQuantity > 0 ? Math.round((soldLast30Days / totalQuantity) * 10) / 10 : 0,
    };
  }, [allInventoryRows, lowStock.data, movementRows]);

  useEffect(() => {
    setStockPage(1);
  }, [brandFilter, categoryFilter, search, stockFilter, unitFilter]);

  const stockTotalPages = Math.max(1, Math.ceil(inventoryRows.length / STOCK_ROWS_PER_PAGE));
  const safeStockPage = Math.min(stockPage, stockTotalPages);
  const pagedInventoryRows = inventoryRows.slice((safeStockPage - 1) * STOCK_ROWS_PER_PAGE, safeStockPage * STOCK_ROWS_PER_PAGE);

  const movementSummary = useMemo(() => {
    const purchaseRows = movementRows.filter((row) => (row.action ?? row.type) === "purchase");
    const purchases = purchaseRows.length;
    const sales = movementRows.filter((row) => (row.action ?? row.type) === "sale").length;
    const damage = movementRows.filter((row) => (row.action ?? row.type) === "damage").length;
    const purchasePaidTotal = purchaseRows.reduce((sum, row) => sum + purchasePaid(row), 0);
    const purchaseDueTotal = purchaseRows.reduce((sum, row) => sum + purchaseDue(row), 0);
    return { purchases, sales, damage, purchasePaidTotal: roundInventoryValue(purchasePaidTotal), purchaseDueTotal: roundInventoryValue(purchaseDueTotal) };
  }, [movementRows]);


  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ draft?: Partial<MovementForm> & { productName?: string; quantity?: number; billAmount?: number; costPrice?: number; minPrice?: number; sellingPrice?: number; minMarginPercent?: number; sellingMarginPercent?: number } }>).detail;
      const draft = detail?.draft;
      if (!draft) return;
      if (!manageInventory.allowed) {
        toast({ title: t("inventory.page.permissionDenied"), description: manageInventory.reason, variant: "destructive" });
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
      const unit = draft.unit ?? inventoryMovementUnit(matchedProduct) ?? "piece";
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
        reason: draft.reason ?? (draft.movementType === "correction" ? t("inventory.page.voiceCorrectionReason") : t("inventory.page.voiceEntryReason")),
      });
      setDialogOpen(true);
      toast({
        title: matchedProduct ? t("inventory.page.voiceDraftReady") : t("inventory.page.voiceProductNotMatched"),
        description: matchedProduct ? t("inventory.page.voiceDraftReadyHelp") : t("inventory.page.voiceProductNotMatchedHelp"),
        variant: matchedProduct ? "default" : "destructive",
      });
    };
    window.addEventListener("kirana:voice-inventory-draft", handler);
    return () => window.removeEventListener("kirana:voice-inventory-draft", handler);
  }, [manageInventory.allowed, manageInventory.reason, products.data, t, toast]);

  const selectedProduct = (products.data ?? []).find((product: Product) => product.id === form.productId);
  const selectedSupplier = (suppliers.data ?? []).find((supplier: Supplier) => supplier.id === form.supplierId);
  const selectedProductUnit = inventoryMovementUnit(selectedProduct) ?? form.unit;
  const selectedProductSimpleUnit = selectedProduct ? inventorySimpleUnit(selectedProduct, form.unit) : form.unit;
  const purchaseConversionToBase = selectedProduct ? inventoryConversionToBase(selectedProduct, form.unit) : undefined;
  const selectedCostRateUnit = purchaseConversionToBase
    ? selectedProductSimpleUnit
    : selectedProduct?.rateUnit ?? selectedProduct?.unit ?? selectedProduct?.displayUnit ?? selectedProductSimpleUnit;
  const currentAverageCost = roundInventoryValue(Number(selectedProduct?.averageCostPrice ?? selectedProduct?.costPrice ?? selectedProduct?.costPerRateUnit ?? 0));
  const purchaseQuantity = Math.max(Number(form.quantity) || 0, 0);
  const priceSuggestions = calculateInventoryPriceSuggestions({
    currentStockBaseQty: Number(selectedProduct?.stockBaseQty ?? 0),
    currentAverageCost,
    purchaseQuantity,
    purchaseUnit: form.unit,
    productBaseUnit: selectedProduct?.baseUnit ?? selectedProductUnit,
    productRateUnit: selectedCostRateUnit,
    purchaseConversionToBase,
    rateConversionToBase: purchaseConversionToBase,
    purchaseUnitCost: Number(form.costPrice || 0) || undefined,
    billAmount: Number(form.billAmount || 0) || undefined,
    minMarginPercent: Number(form.minMarginPercent || 0) || undefined,
    sellingMarginPercent: Number(form.sellingMarginPercent || 0) || undefined,
  });
  const purchaseUnitCost = priceSuggestions.purchaseUnitCost;
  const projectedAverageCost = form.movementType === "purchase" && selectedProduct ? priceSuggestions.projectedAverageCost : currentAverageCost;
  const minMarginSuggestion = priceSuggestions.minPriceSuggestion;
  const sellingMarginSuggestion = priceSuggestions.sellingPriceSuggestion;
  const unitMismatchWarning = selectedProduct ? buildUnitMismatchWarning(selectedProductSimpleUnit, inventorySimpleUnit(selectedProduct, selectedProductUnit)) : undefined;
  const movementUnitOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const unit of activeInventorySellingUnits(selectedProduct)) {
      options.set(unit.unitCode, unit.name);
    }
    for (const unit of UNITS) {
      if (![...options.values()].some((label) => label.toLowerCase() === unit.toLowerCase())) {
        options.set(unit, unit);
      }
    }
    return [...options.entries()].map(([value, label]) => ({ value, label }));
  }, [selectedProduct]);
  const purchaseBillAmount = form.billAmount ? roundInventoryValue(Number(form.billAmount)) : roundInventoryValue(purchaseQuantity * (purchaseUnitCost || 0));
  const purchasePaidAmount = form.movementType === "purchase"
    ? form.purchasePaymentStatus === "due"
      ? 0
      : form.purchasePaymentStatus === "paid"
        ? purchaseBillAmount
        : roundInventoryValue(Number(form.purchasePaidAmount || 0))
    : 0;
  const purchaseDueAmount = form.movementType === "purchase" ? Math.max(0, roundInventoryValue(purchaseBillAmount - purchasePaidAmount)) : 0;

  function applyMarginPrices() {
    setForm((current) => ({
      ...current,
      minPrice: current.minMarginPercent ? String(minMarginSuggestion) : current.minPrice,
      sellingPrice: current.sellingMarginPercent ? String(sellingMarginSuggestion) : current.sellingPrice,
    }));
  }

  function openMovement(type: MovementType, product?: Product | InventoryItem) {
    if (!manageInventory.allowed) {
      toast({ title: t("inventory.page.permissionDenied"), description: manageInventory.reason, variant: "destructive" });
      return;
    }
    const unit = inventoryMovementUnit(product);
    setForm({
      ...initialForm,
      movementType: type,
      productId: product?.id ?? "",
      unit,
      supplierId: "none",
      costPrice: product ? String(product.costPrice ?? product.costPerRateUnit ?? "") : "",
      minPrice: product ? String(product.minimumSellingPrice ?? product.minPricePerRateUnit ?? "") : "",
      sellingPrice: product ? String(product.sellingPrice ?? product.defaultPricePerRateUnit ?? "") : "",
      reason: type === "correction" ? t("inventory.page.physicalCountReason") : "",
    });
    setDialogOpen(true);
  }

  function exportInventory() {
    const header = [t("inventory.col.product"), t("inventory.col.skuBarcode"), t("inventory.col.category"), t("inventory.page.brand"), t("inventory.col.unit"), t("inventory.col.stock"), t("products.col.costPrice"), t("inventory.col.stockValue"), t("inventory.col.status")];
    const lines = inventoryRows.map((item) => {
      const unit = inventoryUnitLabel(item);
      const qty = inventoryDisplayQuantity(item);
      const cost = inventoryAverageUnitCost(item);
      const status = Number(item.stockBaseQty ?? 0) <= 0 ? t("inventory.stock.outOfStock") : isLowStock(item) ? t("inventory.stock.lowStock") : t("inventory.stock.inStock");
      return [item.name, item.sku ?? item.barcode ?? "", item.category ?? "", item.brand ?? "", unit, qty, cost, roundInventoryValue(qty * cost), status];
    });
    const csv = [header, ...lines]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inventory-${format(new Date(), "yyyy-MM-dd")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit() {
    const quantity = Number(form.quantity);
    if (!form.productId) {
      toast({ title: t("inventory.page.selectProduct"), variant: "destructive" });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: t("inventory.page.enterValidQuantity"), variant: "destructive" });
      return;
    }
    if (form.movementType === "purchase") {
      if (purchaseBillAmount <= 0) {
        toast({ title: t("inventory.page.enterBillAmount"), description: t("inventory.page.enterBillAmountHelp"), variant: "destructive" });
        return;
      }
      if (purchasePaidAmount < 0 || purchasePaidAmount > purchaseBillAmount) {
        toast({ title: t("inventory.page.invalidPaidAmount"), description: t("inventory.page.invalidPaidAmountHelp"), variant: "destructive" });
        return;
      }
    }
    if (!manageInventory.allowed) {
      toast({ title: t("inventory.page.permissionDenied"), description: manageInventory.reason, variant: "destructive" });
      return;
    }
    // Damage and correction both adjust stock outside a sale — the server sync
    // handler requires an owner PIN for both, so collect it here. Without this a
    // damage write-off saves locally but its sync op fails forever ("Owner PIN
    // required"), diverging local stock from the server.
    if (form.movementType === "correction" || form.movementType === "damage") {
      setOwnerPinOpen(true);
      return;
    }

    await submitMovement();
  }

  async function submitMovement(ownerPin?: string, ownerPinReason?: string) {
    const quantity = Number(form.quantity);
    const baseQuantity = inventoryQuantityToBase(selectedProduct, quantity, form.unit);
    const selectedSellingUnit = findInventorySellingUnit(selectedProduct, form.unit);
    const syncEnteredUnit = selectedProduct?.baseUnit ?? selectedProductSimpleUnit ?? form.unit;
    const payload = {
      productId: form.productId,
      productName: selectedProduct?.name,
      quantity,
      quantityDelta: form.movementType === "correction" ? baseQuantity : undefined,
      enteredUnit: form.unit,
      unit: form.unit,
      displayQuantity: quantity,
      displayUnit: selectedProduct ? inventoryUnitLabel(selectedProduct, form.unit) : form.unit,
      sellingUnitCode: selectedSellingUnit?.unitCode,
      sellingUnitLabel: selectedSellingUnit?.name,
      conversionToBase: selectedSellingUnit?.conversionToBase,
      syncQuantityBase: Math.abs(baseQuantity),
      syncEnteredUnit,
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
      afterMovementSaved(t("inventory.page.saleSaved"));
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

  const lowStockRows = ((lowStock.data?.length ?? 0) > 0 ? mergeInventoryRows(allInventoryRows, lowStock.data ?? []) : allInventoryRows.filter(isLowStock))
    .filter((item) => Number(item.stockBaseQty ?? 0) > 0)
    .sort((a, b) => Number(a.stockBaseQty ?? 0) - Number(b.stockBaseQty ?? 0));
  const recentMovements = [...movementRows]
    .sort((a, b) => safeDate(b.createdAt ?? b.created_at).getTime() - safeDate(a.createdAt ?? a.created_at).getTime())
    .slice(0, 4);

  return (
    <PageShell className="space-y-4 bg-white pb-8">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <InventoryMetricCard label={t("inventory.page.totalStockValue")} value={fmtMoney(stockStats.stockValue)} detail={t("inventory.page.atCurrentCost")} tone="blue" icon={<IndianRupee size={19} />} />
        <InventoryMetricCard label={t("inventory.page.totalSkus")} value={stockStats.products.toLocaleString("en-IN")} detail={t("inventory.page.unitsTracked", { count: stockStats.totalQuantity.toLocaleString("en-IN") })} tone="violet" icon={<Tags size={19} />} />
        <InventoryMetricCard label={t("dashboard.kpi.lowStockItems")} value={stockStats.lowStock.toLocaleString("en-IN")} detail={t("inventory.page.requireAttention")} tone="amber" icon={<AlertTriangle size={19} />} />
        <InventoryMetricCard label={t("inventory.page.outOfStockItems")} value={stockStats.outOfStock.toLocaleString("en-IN")} detail={t("inventory.page.takeImmediateAction")} tone="rose" icon={<PackageX size={19} />} />
        <div className="col-span-2 xl:col-span-1"><InventoryMetricCard label={t("inventory.page.stockTurnover")} value={`${stockStats.turnover30}x`} detail={stockStats.turnover30 > 0 ? t("inventory.page.basedOnSold") : t("inventory.page.noSalesMovement")} tone="green" icon={<TrendingUp size={19} />} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <InventoryActionCard label={t("inventory.page.addStock")} detail={t("inventory.page.addStockHelp")} tone="blue" icon={<PackagePlus size={20} />} onClick={() => openMovement("purchase")} />
        <InventoryActionCard label={t("inventory.page.correctionTile")} detail={t("inventory.page.correctionHelp")} tone="green" icon={<Wrench size={20} />} onClick={() => openMovement("correction")} />
        <InventoryActionCard label={t("inventory.page.damageTile")} detail={t("inventory.page.damageHelp")} tone="orange" icon={<ShieldAlert size={20} />} onClick={() => openMovement("damage")} />
        <InventoryActionCard label={t("inventory.page.supplierPurchase")} detail={t("inventory.page.supplierPurchaseHelp")} tone="violet" icon={<CircleDollarSign size={20} />} onClick={() => openMovement("purchase")} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="group col-span-2 flex min-h-[82px] w-full items-center gap-3 rounded-[16px] border border-[#e2e8f1] bg-white px-3.5 text-left shadow-[0_4px_14px_rgba(30,55,90,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_8px_20px_rgba(30,55,90,0.07)] lg:col-span-1">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#eef4ff] text-[var(--brand)]"><Ellipsis size={20} /></span>
              <span className="min-w-0"><span className="block text-[13px] font-bold text-[#13223f]">{t("inventory.page.moreActions")}</span><span className="mt-1 block text-[11px] leading-4 text-[#6d7c98]">{t("inventory.page.moreActionsHelp")}</span></span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setActiveTab("movements")}><History size={15} className="mr-2" />{t("inventory.page.movementHistory")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("purchase-bills")}><ClipboardList size={15} className="mr-2" />{t("inventory.page.purchaseBills")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("reports")}><BarChart3 size={15} className="mr-2" />{t("inventory.page.insights")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("batch")}><CalendarClock size={15} className="mr-2" />{t("inventory.page.batchExpiry")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InventoryTab)} className="space-y-4">
        {activeTab !== "dashboard" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#e2e8f1] bg-white px-4 py-3">
            <div><p className="text-[14px] font-semibold text-[#13223f]">{activeTab === "movements" ? t("inventory.page.movementHistory") : activeTab === "purchase-bills" ? t("inventory.page.purchaseBills") : activeTab === "reports" ? t("inventory.page.insights") : t("inventory.page.batchExpiry")}</p><p className="text-[11px] text-[#718096]">{t("inventory.page.detailRecords")}</p></div>
            <Button variant="outline" className="h-9 rounded-[8px] text-[11px]" onClick={() => setActiveTab("dashboard")}><ChevronLeft size={14} className="mr-1.5" />{t("inventory.page.backToStock")}</Button>
          </div>
        ) : null}
        <TabsContent value="dashboard" className="mt-0 space-y-4">
          {/* `min-w-0` on the grid child: a grid item defaults to `min-width:auto`,
              so it refuses to shrink below its content's intrinsic width. The
              240px search box below made that 384px, which pushed this card nine
              pixels past a 375px screen and sliced the t("inventory.page.reorder") buttons off the
              right edge of every low-stock row. */}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.95fr)]">
            <section className="min-w-0 overflow-hidden rounded-[12px] border border-[#e2e8f1] bg-white shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
              <div className="border-b border-[#e8edf4] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#13223f]">{t("inventory.page.productStock")}</h2>
                    <p className="mt-0.5 text-[11px] text-[#6d7c98]">{t("inventory.page.productStockHelp")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Search takes the whole first line on a phone and shares it
                        with Filters/Export only once there is room; squeezed into
                        a three-control row at 375px its placeholder read
                        "Search by". */}
                    <div className="relative min-w-0 flex-1 basis-full sm:basis-0 sm:min-w-[240px] lg:w-[340px]">
                      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a89a3]" />
                      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("inventory.page.search")} className="h-10 rounded-[8px] border-[#dfe6ef] bg-[#fbfcfe] pl-9 text-[12px] focus-visible:bg-white focus-visible:ring-1" />
                    </div>
                    <Button variant="outline" className="h-10 rounded-[8px] px-3 text-[12px]" onClick={() => setStockFilter(stockFilter === "all" ? "low" : "all")}><SlidersHorizontal size={14} className="mr-1.5" />{t("inventory.page.filters")}</Button>
                    <Button className="h-10 rounded-[8px] bg-[var(--brand)] px-4 text-[12px] shadow-[0_7px_16px_var(--brand-shadow)] hover:bg-[var(--brand-strong)]" onClick={exportInventory}><Download size={14} className="mr-1.5" />{t("inventory.page.export")}</Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <InventoryFilterSelect value={categoryFilter} onChange={setCategoryFilter} placeholder={t("products.filter.allCategories")} options={filterOptions.categories} />
                  <InventoryFilterSelect value={brandFilter} onChange={setBrandFilter} placeholder={t("inventory.page.allBrands")} options={filterOptions.brands} />
                  <InventoryFilterSelect value={unitFilter} onChange={setUnitFilter} placeholder={t("inventory.page.allUnits")} options={filterOptions.units} />
                  <Select value={stockFilter} onValueChange={setStockFilter}>
                    <SelectTrigger className="h-9 rounded-[8px] border-[#dfe6ef] text-[11px] font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">{t("inventory.page.allStockStatus")}</SelectItem><SelectItem value="in">{t("inventory.stock.inStock")}</SelectItem><SelectItem value="low">{t("inventory.stock.lowStock")}</SelectItem><SelectItem value="out">{t("inventory.stock.outOfStock")}</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="divide-y divide-[#edf2f7] md:hidden">
                {inventory.isLoading ? Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="p-4"><Skeleton className="h-20 w-full rounded-[14px]" /></div>
                )) : pagedInventoryRows.length === 0 ? (
                  <div className="px-4 py-12 text-center"><Package className="mx-auto text-[#a2aec0]" size={28} /><p className="mt-2 text-sm font-semibold text-[#243653]">{t("inventory.page.noMatch")}</p><p className="mt-1 text-xs text-[#718096]">{t("inventory.page.noMatchHelp")}</p></div>
                ) : pagedInventoryRows.map((item) => {
                  const unit = inventoryUnitLabel(item);
                  const qty = inventoryDisplayQuantity(item);
                  const cost = inventoryAverageUnitCost(item);
                  const tracked = (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false;
                  const out = tracked && Number(item.stockBaseQty ?? 0) <= 0;
                  const low = tracked && !out && isLowStock(item);
                  // A product that counts each size separately gets a line per size:
                  // one blended number cannot say WHICH size ran out.
                  const packRows = item.packagingMode === "per_pack" ? inventoryStockRows(item) : [];
                  return (
                    <button key={item.id} type="button" onClick={() => openMovement("purchase", item)} className="w-full px-4 py-4 text-left transition-colors hover:bg-[#f8fbff]">
                      <span className="grid w-full grid-cols-[58px_1fr_auto] items-center gap-3">
                        <InventoryProductAvatar item={item} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-extrabold text-[var(--brand-ink)]">{item.name}</span>
                          <span className="mt-1 block truncate text-[12px] font-medium text-[#52627d]">{t("inventory.page.skuLabel", { value: item.sku ?? item.barcode ?? "-" })}</span>
                          <span className="mt-1 block truncate text-[12px] text-[#718096]">{t("inventory.page.categoryLabel", { value: item.category ?? t("products.filter.general") })}</span>
                        </span>
                        <span className="min-w-[88px] text-right">
                          <span className={cn("block text-[16px] font-black", out ? "text-[#ff304f]" : low ? "text-[#f08a00]" : "text-[#10a948]")}>{tracked ? `${qty.toLocaleString("en-IN")} ${unit}` : t("inventory.page.notTracked")}</span>
                          <span className="mt-1 block text-[12px] text-[#718096]">{t("inventory.page.valueLabel", { value: fmtMoney(qty * cost) })}</span>
                          <span className="mt-2 inline-block"><InventoryStatusBadge status={out ? "out" : low ? "low" : "in"} /></span>
                        </span>
                      </span>
                      {packRows.length > 0 ? (
                        <span className="mt-2.5 block space-y-1 rounded-[10px] bg-[#f6f9fd] px-3 py-2">
                          {packRows.map((row) => (
                            <span key={row.key} className="flex items-center justify-between gap-3 text-[12px]">
                              <span className="min-w-0 truncate font-semibold text-[#243653]">{row.label}</span>
                              <span className={cn("shrink-0 font-black", row.isOut ? "text-[#ff304f]" : row.isLow ? "text-[#f08a00]" : "text-[#10a948]")}>{row.quantity.toLocaleString("en-IN")}</span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-left text-[12px]">
                  <thead><tr className="border-b border-[#e4eaf2] bg-[#f8fafc] text-[10px] font-semibold uppercase tracking-[0.02em] text-[#718096]">
                    <th className="px-4 py-3">{t("inventory.col.product")}</th><th className="px-3 py-3">{t("inventory.col.skuBarcode")}</th><th className="px-3 py-3">{t("inventory.col.category")}</th><th className="px-3 py-3">{t("inventory.col.unit")}</th><th className="px-3 py-3 text-right">{t("inventory.col.stock")}</th><th className="px-3 py-3 text-right">{t("inventory.page.cost")}</th><th className="px-3 py-3 text-right">{t("inventory.page.totalValue")}</th><th className="px-4 py-3 text-center">{t("inventory.col.status")}</th>
                  </tr></thead>
                  <tbody>
                    {inventory.isLoading ? Array.from({ length: 7 }).map((_, index) => <tr key={index}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-7 w-full" /></td></tr>) : pagedInventoryRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-16 text-center"><Package className="mx-auto text-[#a2aec0]" size={28} /><p className="mt-2 text-sm font-semibold text-[#243653]">{t("inventory.page.noMatch")}</p><p className="mt-1 text-xs text-[#718096]">{t("inventory.page.noMatchHelp")}</p></td></tr>
                    ) : pagedInventoryRows.map((item) => {
                      const unit = inventoryUnitLabel(item);
                      const qty = inventoryDisplayQuantity(item);
                      const cost = inventoryAverageUnitCost(item);
                      const tracked = (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false;
                      const out = tracked && Number(item.stockBaseQty ?? 0) <= 0;
                      const low = tracked && !out && isLowStock(item);
                      // A product that counts each size separately gets a line per
                      // size: one blended number cannot say WHICH size ran out.
                      const packRows = item.packagingMode === "per_pack" ? inventoryStockRows(item) : [];
                      return <Fragment key={item.id}>
                        <tr onClick={() => openMovement("purchase", item)} className="cursor-pointer border-b border-[#eef2f6] text-[#243653] transition-colors last:border-0 hover:bg-[#f8fbff]">
                        <td className="px-4 py-2.5"><div className="flex min-w-[160px] items-center gap-2.5"><InventoryProductAvatar item={item} /><div className="min-w-0"><p className="truncate font-semibold text-[#13223f]">{item.name}</p><p className="truncate text-[10px] text-[#7a89a3]">{item.brand ?? t("inventory.page.unbranded")}</p></div></div></td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-[#52627d]">{item.sku ?? item.barcode ?? "-"}</td>
                        <td className="px-3 py-2.5 text-[#52627d]">{item.category ?? t("products.filter.general")}</td>
                        <td className="px-3 py-2.5 capitalize text-[#52627d]">{packRows.length > 0 ? t("inventory.page.sizesCount", { count: packRows.length }) : unit}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{tracked ? qty.toLocaleString("en-IN") : t("inventory.page.notTracked")}</td>
                        <td className="px-3 py-2.5 text-right text-[#52627d]">{fmtMoney(cost)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{fmtMoney(qty * cost)}</td>
                        <td className="px-4 py-2.5 text-center"><InventoryStatusBadge status={out ? "out" : low ? "low" : "in"} /></td>
                        </tr>
                        {packRows.map((row) => (
                          <tr key={row.key} onClick={() => openMovement("purchase", item)} className="cursor-pointer border-b border-[#eef2f6] bg-[#fbfcfe] text-[11px] text-[#52627d] transition-colors last:border-0 hover:bg-[#f8fbff]">
                            <td className="py-1.5 pl-12 pr-4"><span className="font-semibold text-[#243653]">{row.label}</span></td>
                            <td className="px-3 py-1.5 font-mono text-[10px]">{row.unit?.barcode ?? "-"}</td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5">{t("inventory.page.perSize")}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{row.quantity.toLocaleString("en-IN")}</td>
                            <td className="px-3 py-1.5 text-right">{fmtMoney(row.unitCost)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{fmtMoney(row.value)}</td>
                            <td className="px-4 py-1.5 text-center"><InventoryStatusBadge status={row.isOut ? "out" : row.isLow ? "low" : "in"} /></td>
                          </tr>
                        ))}
                      </Fragment>;
                    })}
                  </tbody>
                </table>
              </div>
              <InventoryPagination page={safeStockPage} pages={stockTotalPages} total={inventoryRows.length} onChange={setStockPage} />
            </section>

            {/* Both panels share one column on a phone, so this aside's own
                min-content set the width of the card beside it. Left at `auto`
                it demanded 384px on a 375px screen — which is what pushed the
                t("inventory.page.reorder") buttons off the edge of the stock list. */}
            <aside className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
              <section className="min-w-0 rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
                <h2 className="text-[14px] font-semibold text-[#13223f]">{t("inventory.page.locationOverview")}</h2><p className="mt-0.5 text-[11px] text-[#718096]">{t("inventory.page.locationOverviewHelp")}</p>
                <div className="mt-2 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[132px_1fr]">
                  <div className="h-[128px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: t("inventory.page.mainStore"), value: Math.max(stockStats.stockValue, 1) }]} dataKey="value" innerRadius={36} outerRadius={56} strokeWidth={0}><Cell fill="var(--brand)" /></Pie></PieChart></ResponsiveContainer></div>
                  <div><div className="flex items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" /><span className="font-semibold text-[#243653]">{t("inventory.page.mainStore")}</span></div><p className="ml-4 mt-1 text-[11px] text-[#718096]">{t("inventory.page.allTrackedStock")}</p></div>
                </div>
                <div className="flex items-center justify-between border-t border-[#edf1f6] pt-3 text-[11px]"><span className="text-[#718096]">{t("inventory.page.totalValue")}</span><span className="font-bold text-[#13223f]">{fmtMoney(stockStats.stockValue)}</span></div>
              </section>

              <section className="min-w-0 rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
                <div className="flex items-start justify-between"><div><h2 className="text-[14px] font-semibold text-[#13223f]">{t("inventory.page.lowStockAlerts")}</h2><p className="mt-0.5 text-[11px] text-[#718096]">{t("inventory.page.lowStockAlertsHelp")}</p></div><button type="button" onClick={() => setStockFilter("low")} className="tap-target text-[11px] font-semibold text-[var(--brand)]">{t("inventory.page.viewAll")}</button></div>
                <div className="mt-2 divide-y divide-[#edf1f6]">
                  {lowStockRows.length === 0 ? <p className="py-7 text-center text-xs text-[#718096]">{t("inventory.page.healthyStock")}</p> : lowStockRows.slice(0, 3).map((item) => {
                    const unit = inventoryUnitLabel(item);
                    return <div key={item.id} className="flex items-center gap-2.5 py-2.5"><InventoryProductAvatar item={item} compact /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#243653]">{item.name}</p><p className="mt-0.5 text-[10px] text-[#ff304f]">{t("inventory.page.quantityLeft", { quantity: inventoryDisplayQuantity(item), unit })}</p></div><Button variant="outline" size="sm" className="h-7 rounded-[7px] border-[#ffd7a6] bg-[#fff9ef] px-2.5 text-[10px] font-semibold text-[#f08a00]" onClick={() => openMovement("purchase", item)}>{t("inventory.page.reorder")}</Button></div>;
                  })}
                </div>
              </section>

              <section className="min-w-0 rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)] md:col-span-2 xl:col-span-1">
                <div className="flex items-start justify-between"><div><h2 className="text-[14px] font-semibold text-[#13223f]">{t("inventory.page.recentUpdates")}</h2><p className="mt-0.5 text-[11px] text-[#718096]">{t("inventory.page.recentUpdatesHelp")}</p></div><button type="button" onClick={() => setActiveTab("movements")} className="tap-target text-[11px] font-semibold text-[var(--brand)]">{t("inventory.page.viewAll")}</button></div>
                <div className="mt-2 divide-y divide-[#edf1f6]">{recentMovements.length === 0 ? <p className="py-7 text-center text-xs text-[#718096]">{t("inventory.page.noUpdates")}</p> : recentMovements.map((entry) => <RecentMovementRow key={entry.id} entry={entry} />)}</div>
              </section>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          <StatsGrid columns={3}>
            <StatCard label={t("inventory.page.purchases")} value={movementSummary.purchases} />
            <StatCard label={t("inventory.page.sales")} value={movementSummary.sales} tone="blue" />
            <StatCard label={t("inventory.page.damageShort")} value={movementSummary.damage} tone="amber" />
          </StatsGrid>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 border-b"><tr><th className="px-4 py-3 text-left">{t("inventory.col.product")}</th><th className="px-4 py-3 text-left">{t("inventory.page.type")}</th><th className="px-4 py-3 text-right">{t("inventory.page.qtyDelta")}</th><th className="px-4 py-3 text-left">{t("inventory.page.supplierNote")}</th><th className="px-4 py-3 text-center">{t("inventory.page.sync")}</th><th className="px-4 py-3 text-right">{t("inventory.page.time")}</th></tr></thead>
              <tbody>
                {movementRows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{t("inventory.page.noMovements")}</td></tr> : movementRows.map((entry) => {
                  const type = entry.action ?? entry.type ?? "movement";
                  const qty = Number(entry.quantityDelta ?? entry.quantity_delta ?? 0);
                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{entry.productName ?? "-"}</td>
                      <td className="px-4 py-3"><Badge variant={movementClass(type)}>{movementLabel(type, t)}</Badge></td>
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
            <StatCard label={t("inventory.page.purchaseBills")} value={movementSummary.purchases} />
            <StatCard label={t("inventory.page.supplierPaid")} value={fmtMoney(movementSummary.purchasePaidTotal)} tone="green" />
            <StatCard label={t("inventory.page.supplierDue")} value={fmtMoney(movementSummary.purchaseDueTotal)} tone="amber" />
          </StatsGrid>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inventory.page.purchaseBill")}</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inventory.movement.supplier")}</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inventory.col.product")}</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("inventory.page.billAmount")}</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("inventory.page.paid")}</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("inventory.page.due")}</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">{t("inventory.col.status")}</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("inventory.col.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movementRows.filter((entry) => (entry.action ?? entry.type) === "purchase").length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">{t("inventory.page.noPurchaseBills")}</td></tr>
                  ) : movementRows.filter((entry) => (entry.action ?? entry.type) === "purchase").map((entry) => (
                    <tr key={`purchase-bill-${entry.id}`} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3"><p className="font-semibold">{entry.purchaseBillNo ?? entry.purchase_bill_no ?? t("inventory.page.localPurchase")}</p><p className="text-xs text-muted-foreground">{t("inventory.page.supplierBillLabel", { value: entry.supplierBillNo ?? entry.supplier_bill_no ?? t("products.import.notSet") })}</p></td>
                      <td className="px-4 py-3">{entry.supplierName ?? entry.supplier_name ?? t("inventory.page.noSupplier")}</td>
                      <td className="px-4 py-3">{entry.productName ?? entry.productId ?? entry.product_id ?? t("inventory.col.product")}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtMoney(purchaseTotal(entry))}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmtMoney(purchasePaid(entry))}</td>
                      <td className="px-4 py-3 text-right text-orange-700">{fmtMoney(purchaseDue(entry))}</td>
                      <td className="px-4 py-3 text-center"><Badge variant={purchaseDue(entry) > 0 ? "destructive" : "secondary"}>{purchaseStatus(entry, t)}</Badge></td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{format(safeDate(entry.createdAt ?? entry.created_at), "d MMM, h:mm a")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("inventory.page.purchaseBillsHelp")}</p>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-4"><TrendingUp size={18} className="mb-2" /><p className="font-semibold">{t("inventory.page.fastMovers")}</p><p className="mt-1 text-xs text-muted-foreground">{t("inventory.page.fastMoversHelp")}</p></div>
            <div className="rounded-lg border bg-card p-4"><TrendingDown size={18} className="mb-2" /><p className="font-semibold">{t("inventory.page.slowMovers")}</p><p className="mt-1 text-xs text-muted-foreground">{t("inventory.page.slowMoversHelp")}</p></div>
            <div className="rounded-lg border bg-card p-4"><BarChart3 size={18} className="mb-2" /><p className="font-semibold">{t("inventory.page.deadStock")}</p><p className="mt-1 text-xs text-muted-foreground">{t("inventory.page.deadStockHelp")}</p></div>
          </div>
        </TabsContent>

        <TabsContent value="batch" className="space-y-4">
          <div className="rounded-lg border bg-card p-4 flex gap-4">
            <CalendarClock className="text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">{t("inventory.page.batchSupport")}</h3><Badge>{t("inventory.page.higherPlan")}</Badge></div>
              <p className="mt-1 text-sm text-muted-foreground">{t("inventory.page.batchSupportHelp")}</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("inventory.page.movementEntryTitle", { movement: movementLabel(form.movementType, t) })}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid md:grid-cols-2 gap-3">
              <div><Label>{t("inventory.page.movementType")}</Label><Select value={form.movementType} onValueChange={(value) => setForm((current) => ({ ...current, movementType: value as MovementType }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="purchase">{t("inventory.page.purchase")}</SelectItem><SelectItem value="sale">{t("inventory.page.manualSale")}</SelectItem><SelectItem value="damage">{t("inventory.page.damage")}</SelectItem><SelectItem value="correction">{t("inventory.page.correction")}</SelectItem></SelectContent></Select></div>
              <div><Label>{t("inventory.page.productRequired")}</Label><Select value={form.productId} onValueChange={(value) => { const product = (products.data ?? []).find((row: Product) => row.id === value); setForm((current) => ({ ...current, productId: value, unit: product ? inventoryMovementUnit(product) : current.unit, costPrice: String(product?.averageCostPrice ?? product?.costPrice ?? product?.costPerRateUnit ?? current.costPrice), minPrice: String(product?.minimumSellingPrice ?? product?.minPricePerRateUnit ?? current.minPrice), sellingPrice: String(product?.sellingPrice ?? product?.defaultPricePerRateUnit ?? current.sellingPrice) })); }}><SelectTrigger className="mt-1"><SelectValue placeholder={t("inventory.page.selectProduct")} /></SelectTrigger><SelectContent>{(products.data ?? []).map((product: Product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <div><Label>{form.movementType === "correction" ? t("inventory.page.newStockDelta") : t("inventory.col.quantity")}</Label><Input type="number" step="0.01" className="mt-1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></div>
              <div><Label>{t("inventory.col.unit")}</Label><Select value={form.unit} onValueChange={(value) => setForm((current) => ({ ...current, unit: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{movementUnitOptions.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}</SelectContent></Select>{unitMismatchWarning ? <p className="mt-1 text-xs text-orange-700">{unitMismatchWarning}</p> : null}</div>
              <div><Label>{t("inventory.page.totalBillAmount")}</Label><Input type="number" step="0.01" className="mt-1" value={form.billAmount} onChange={(event) => setForm((current) => ({ ...current, billAmount: event.target.value }))} disabled={form.movementType !== "purchase"} /></div>
            </div>
            {form.movementType === "purchase" ? (
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>{t("inventory.movement.supplier")}</Label><Select value={form.supplierId} onValueChange={(value) => setForm((current) => ({ ...current, supplierId: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("inventory.page.noSupplier")}</SelectItem>{(suppliers.data ?? []).map((supplier: Supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>{t("inventory.page.supplierNameIfUnsaved")}</Label><Input className="mt-1" value={form.supplierName} onChange={(event) => setForm((current) => ({ ...current, supplierName: event.target.value }))} /></div>
              </div>
            ) : null}
            {form.movementType === "purchase" ? (
              <div className="rounded-xl border bg-muted/40 p-3 space-y-3">
                <div className="flex items-center gap-2"><Wallet size={16} /><p className="font-medium text-sm">{t("inventory.page.supplierPaymentTracking")}</p></div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>{t("inventory.page.supplierBillNo")}</Label><Input className="mt-1" value={form.supplierBillNo} onChange={(event) => setForm((current) => ({ ...current, supplierBillNo: event.target.value }))} placeholder={t("restaurant.addons.optional")} /></div>
                  <div><Label>{t("inventory.page.paymentStatus")}</Label><Select value={form.purchasePaymentStatus} onValueChange={(value) => setForm((current) => ({ ...current, purchasePaymentStatus: value as MovementForm["purchasePaymentStatus"], purchasePaidAmount: value === "paid" ? String(purchaseBillAmount || "") : value === "due" ? "0" : current.purchasePaidAmount }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="paid">{t("inventory.page.paid")}</SelectItem><SelectItem value="partial">{t("inventory.page.partial")}</SelectItem><SelectItem value="due">{t("inventory.page.due")}</SelectItem></SelectContent></Select></div>
                  <div><Label>{t("inventory.page.paymentMode")}</Label><Select value={form.purchasePaymentMode} onValueChange={(value) => setForm((current) => ({ ...current, purchasePaymentMode: value as MovementForm["purchasePaymentMode"] }))} disabled={form.purchasePaymentStatus === "due"}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{t("inventory.page.cash")}</SelectItem><SelectItem value="upi">{t("inventory.page.upiBank")}</SelectItem></SelectContent></Select></div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>{t("inventory.page.paidAmount")}</Label><Input type="number" step="0.01" className="mt-1" value={form.purchasePaymentStatus === "paid" ? String(purchaseBillAmount || "") : form.purchasePaidAmount} onChange={(event) => setForm((current) => ({ ...current, purchasePaidAmount: event.target.value, purchasePaymentStatus: current.purchasePaymentStatus === "paid" ? "partial" : current.purchasePaymentStatus }))} disabled={form.purchasePaymentStatus !== "partial"} /></div>
                  <div><Label>{t("inventory.page.dueAmount")}</Label><Input className="mt-1" value={fmtMoney(purchaseDueAmount)} readOnly /></div>
                  <div><Label>{t("inventory.page.dueDate")}</Label><Input type="date" className="mt-1" value={form.purchaseDueDate} onChange={(event) => setForm((current) => ({ ...current, purchaseDueDate: event.target.value }))} disabled={purchaseDueAmount <= 0} /></div>
                </div>
                <p className="text-xs text-muted-foreground">{t("inventory.page.purchaseBillHelp")}</p>
              </div>
            ) : null}
            {form.movementType === "purchase" ? (
              <div className="rounded-xl border bg-muted/40 p-3 space-y-4">
                <div className="flex items-center gap-2"><ClipboardList size={16} /><p className="font-medium text-sm">{t("inventory.page.costingTitle")}</p></div>
                <div className="grid gap-2 rounded-lg border bg-background p-3 text-sm sm:grid-cols-3">
                  <div><p className="text-xs text-muted-foreground">{t("inventory.page.currentAvgCost")}</p><p className="font-bold">{fmtMoney(currentAverageCost)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("inventory.page.purchaseUnitCost")}</p><p className="font-bold">{fmtMoney(purchaseUnitCost || 0)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t("inventory.page.newAvgAfterSave")}</p><p className="font-bold text-primary">{fmtMoney(projectedAverageCost || 0)}</p></div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div><Label>{t("inventory.page.costPricePerUnit")}</Label><Input type="number" step="0.01" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} placeholder={t("inventory.page.autoFromBill")} /></div>
                  <div><Label>{t("inventory.page.minMargin")}</Label><Input type="number" step="0.01" value={form.minMarginPercent} onChange={(event) => setForm((current) => ({ ...current, minMarginPercent: event.target.value }))} placeholder="e.g. 5" /><p className="mt-1 text-xs text-muted-foreground">{t("inventory.page.suggestion", { value: fmtMoney(minMarginSuggestion || 0) })}</p></div>
                  <div><Label>{t("inventory.page.sellingMargin")}</Label><Input type="number" step="0.01" value={form.sellingMarginPercent} onChange={(event) => setForm((current) => ({ ...current, sellingMarginPercent: event.target.value }))} placeholder="e.g. 12" /><p className="mt-1 text-xs text-muted-foreground">{t("inventory.page.suggestion", { value: fmtMoney(sellingMarginSuggestion || 0) })}</p></div>
                </div>
                <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3"><div><Label>{t("inventory.page.minPrice")}</Label><Input type="number" step="0.01" value={form.minPrice} onChange={(event) => setForm((current) => ({ ...current, minPrice: event.target.value }))} /></div><div><Label>{t("inventory.page.sellingPrice")}</Label><Input type="number" step="0.01" value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></div><Button type="button" variant="outline" className="self-end" onClick={applyMarginPrices}>{t("inventory.page.applyMargin")}</Button></div>
              </div>
            ) : null}
            {form.movementType === "correction" || form.movementType === "damage" ? <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 flex gap-2"><ShieldAlert size={16} /> {t("inventory.page.pinRequiredNote", { movement: form.movementType === "damage" ? t("inventory.page.damageWriteOff") : t("inventory.page.correction") })}</div> : null}
            <div><Label>{t("inventory.page.reasonNote")}</Label><Input className="mt-1" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder={t("inventory.page.correctionReason")} />{form.movementType === "correction" || form.movementType === "damage" ? <p className="mt-1 text-xs text-orange-700">{t("inventory.page.ownerPinAfterSave")}</p> : null}</div>
            <div className="sticky bottom-0 z-10 -mx-4 flex gap-3 border-t bg-background/95 px-4 py-3 pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>{t("inventory.cancel")}</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={isSaving}>{isSaving ? <Loader2 size={14} className="animate-spin" /> : t("customers.detail.saveLocally")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <OwnerPinModal
        open={ownerPinOpen}
        onCancel={() => setOwnerPinOpen(false)}
        title={t("products.toast.ownerApprovalRequired")}
        description={t("inventory.page.correctionPinHelp")}
        confirmLabel={t("customers.detail.saveCorrection")}
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

type InventoryTone = "blue" | "violet" | "amber" | "rose" | "green" | "orange";

const INVENTORY_TONES: Record<InventoryTone, string> = {
  blue: "border-[var(--brand-border)] bg-[#eaf2ff] text-[var(--brand)]",
  violet: "border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb]",
  amber: "border-[#ffdca8] bg-[#fff2df] text-[#f08a00]",
  rose: "border-[#ffcfd7] bg-[#ffecef] text-[#ff304f]",
  green: "border-[#c8f1d5] bg-[#e7faee] text-[#11a84b]",
  orange: "border-[#ffd7ae] bg-[#fff3e7] text-[#ff7a00]",
};

function InventoryMetricCard({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: InventoryTone; icon: ReactNode }) {
  return (
    <div className="min-h-[108px] rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium text-[#6d7c98]">{label}</p><p className="mt-2 text-[21px] font-bold leading-none text-[#13223f]">{value}</p></div><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${INVENTORY_TONES[tone]}`}>{icon}</span></div>
      <p className={`mt-3 text-[10px] font-medium ${tone === "green" ? "text-[#16a34a]" : "text-[#718096]"}`}>{detail}</p>
    </div>
  );
}

function InventoryActionCard({ label, detail, tone, icon, onClick }: { label: string; detail: string; tone: InventoryTone; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-[82px] w-full items-center gap-3 rounded-[16px] border border-[#e2e8f1] bg-white px-3.5 text-left shadow-[0_4px_14px_rgba(30,55,90,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_8px_20px_rgba(30,55,90,0.07)]">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border ${INVENTORY_TONES[tone]}`}>{icon}</span>
      <span className="min-w-0"><span className="block text-[13px] font-bold leading-4 text-[#13223f]">{label}</span><span className="mt-1 block text-[11px] leading-4 text-[#6d7c98]">{detail}</span></span>
    </button>
  );
}

function InventoryFilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (value: string) => void; placeholder: string; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 rounded-[8px] border-[#dfe6ef] text-[11px] font-medium"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">{placeholder}</SelectItem>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function InventoryProductAvatar({ item, compact = false }: { item: InventoryItem; compact?: boolean }) {
  const size = compact ? "h-8 w-8 rounded-[7px]" : "h-9 w-9 rounded-[8px]";
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden border border-[#e4eaf2] bg-[#f7f9fc] text-xs font-bold text-[var(--brand)] ${size}`}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-contain" /> : item.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function InventoryStatusBadge({ status }: { status: "in" | "low" | "out" }) {
  const { t } = useAppLanguage();
  const style = status === "in" ? "border-[#c7ecd4] bg-[#eaf9ef] text-[#169447]" : status === "low" ? "border-[#ffddb1] bg-[#fff5e8] text-[#ed8a00]" : "border-[#ffcdd4] bg-[#fff0f2] text-[#f2384f]";
  return <span className={`inline-flex rounded-[6px] border px-2 py-1 text-[10px] font-semibold ${style}`}>{status === "in" ? t("inventory.stock.inStock") : status === "low" ? t("inventory.stock.lowStock") : t("inventory.stock.outOfStock")}</span>;
}

function InventoryPagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  const { t } = useAppLanguage();
  const first = total === 0 ? 0 : (page - 1) * STOCK_ROWS_PER_PAGE + 1;
  const last = Math.min(page * STOCK_ROWS_PER_PAGE, total);
  const visible = Array.from({ length: Math.min(pages, 3) }, (_, index) => Math.min(Math.max(1, page - 1) + index, pages)).filter((value, index, rows) => rows.indexOf(value) === index);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[#e8edf4] px-4 py-3 sm:flex-row">
      <p className="text-[10px] text-[#718096]">{t("inventory.page.showingRange", { first, last, total: total.toLocaleString("en-IN") })}</p>
      {/* Real 44px boxes rather than `.tap-target` overlays: these buttons sit
          4px apart, and at that spacing each overlay would reach across into its
          neighbour's visible box and take the tap. Density comes back for a
          mouse via `lg:mouse:`. */}
      <div className="flex items-center gap-1.5 lg:mouse:gap-1"><button type="button" aria-label={t("products.previousPage")} disabled={page === 1} onClick={() => onChange(page - 1)} className="grid h-11 w-11 place-items-center rounded-[7px] border border-[#dfe6ef] text-[#52627d] disabled:opacity-35 lg:mouse:h-8 lg:mouse:w-8"><ChevronLeft size={14} /></button>{visible.map((number) => <button type="button" key={number} aria-label={t("inventory.page.pageNumber", { number })} aria-current={number === page ? "page" : undefined} onClick={() => onChange(number)} className={`grid h-11 min-w-11 place-items-center rounded-[7px] px-2 text-[11px] font-semibold lg:mouse:h-8 lg:mouse:min-w-8 ${number === page ? "bg-[var(--brand)] text-white" : "border border-[#dfe6ef] text-[#52627d]"}`}>{number}</button>)}<button type="button" aria-label={t("products.nextPage")} disabled={page === pages} onClick={() => onChange(page + 1)} className="grid h-11 w-11 place-items-center rounded-[7px] border border-[#dfe6ef] text-[#52627d] disabled:opacity-35 lg:mouse:h-8 lg:mouse:w-8"><ChevronRight size={14} /></button></div>
      <p className="text-[10px] text-[#718096]">{t("inventory.page.rowsPerPage", { count: STOCK_ROWS_PER_PAGE })}</p>
    </div>
  );
}

function RecentMovementRow({ entry }: { entry: MovementEntry }) {
  const { t } = useAppLanguage();
  const type = entry.action ?? entry.type ?? "correction";
  const quantity = Number(entry.quantityDelta ?? entry.quantity_delta ?? 0);
  const positive = quantity > 0;
  const tone = type === "damage" || type === "sale" ? "rose" : type === "correction" ? "orange" : "green";
  const icon = type === "damage" ? <ShieldAlert size={13} /> : type === "sale" ? <PackageX size={13} /> : type === "correction" ? <Wrench size={13} /> : <PackagePlus size={13} />;
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border ${INVENTORY_TONES[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#243653]">{movementLabel(type, t)}</p><p className="truncate text-[10px] text-[#718096]">{entry.productName ?? t("inventory.page.inventoryItem")} - {format(safeDate(entry.createdAt ?? entry.created_at), "d MMM, h:mm a")}</p></div>
      <span className={`text-[11px] font-semibold ${positive ? "text-[#16a34a]" : "text-[#ff304f]"}`}>{positive ? "+" : ""}{quantity} {entry.unit ?? ""}</span>
    </div>
  );
}
