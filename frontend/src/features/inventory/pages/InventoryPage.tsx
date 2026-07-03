import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  Ellipsis,
  History,
  IndianRupee,
  Layers3,
  Loader2,
  Package,
  PackageCheck,
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
import { PageShell, StatCard, StatsGrid } from "@/components/shared";
import { offlineDB } from "@/lib/offline/db";

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
    const sourceRows = inventoryRows.length > 0 ? inventoryRows : productRows.length > 0 ? productRows : localProductRows;
    return sourceRows
      .filter((item) => !(item as { deletedAt?: unknown; deleted_at?: unknown }).deletedAt && !(item as { deleted_at?: unknown }).deleted_at);
  }, [inventory.data, localProductRows, products.data]);

  const filterOptions = useMemo(() => ({
    categories: [...new Set(allInventoryRows.map((item) => item.category?.trim()).filter(Boolean) as string[])].sort(),
    brands: [...new Set(allInventoryRows.map((item) => item.brand?.trim()).filter(Boolean) as string[])].sort(),
    units: [...new Set(allInventoryRows.map((item) => (item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece").trim()).filter(Boolean))].sort(),
  }), [allInventoryRows]);

  const inventoryRows = useMemo(() => {
    const q = search.toLowerCase();
    return allInventoryRows
      .filter((item) => !q || [item.name, item.category, item.brand, item.barcode, item.sku, ...(item.aliases ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q))
      .filter((item) => categoryFilter === "all" || item.category === categoryFilter)
      .filter((item) => brandFilter === "all" || item.brand === brandFilter)
      .filter((item) => unitFilter === "all" || (item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece") === unitFilter)
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
    const stockValue = tracked.reduce((sum, item) => sum + Number(item.stockBaseQty ?? 0) * Number(item.costPerRateUnit ?? item.costPrice ?? 0) / (CONVERSION[item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece"] ?? 1), 0);
    const totalQuantity = tracked.reduce((sum, item) => sum + displayQtyFromBase(item.stockBaseQty, item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece"), 0);
    const soldLast30Days = movementRows
      .filter((row) => (row.action ?? row.type) === "sale" && safeDate(row.createdAt ?? row.created_at).getTime() >= Date.now() - 30 * 86_400_000)
      .reduce((sum, row) => sum + Math.abs(Number(row.quantityDelta ?? row.quantity_delta ?? 0)), 0);
    const localLowStock = rows.filter(isLowStock);
    const remoteLowStock = lowStock.data ?? [];
    return {
      products: rows.length,
      lowStock: (remoteLowStock.length > 0 ? remoteLowStock : localLowStock).length,
      outOfStock: tracked.filter((item) => Number(item.stockBaseQty ?? 0) <= 0).length,
      totalQuantity: round2(totalQuantity),
      stockValue: round2(stockValue),
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

  function exportInventory() {
    const header = ["Product", "SKU / Barcode", "Category", "Brand", "Unit", "Stock", "Cost Price", "Stock Value", "Status"];
    const lines = inventoryRows.map((item) => {
      const unit = item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece";
      const qty = displayQtyFromBase(item.stockBaseQty, unit);
      const cost = round2(item.averageCostPrice ?? item.costPerRateUnit ?? item.costPrice ?? 0);
      const status = Number(item.stockBaseQty ?? 0) <= 0 ? "Out of stock" : isLowStock(item) ? "Low stock" : "In stock";
      return [item.name, item.sku ?? item.barcode ?? "", item.category ?? "", item.brand ?? "", unit, qty, cost, round2(qty * cost), status];
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

  const lowStockRows = ((lowStock.data?.length ?? 0) > 0 ? lowStock.data ?? [] : allInventoryRows.filter(isLowStock))
    .filter((item) => Number(item.stockBaseQty ?? 0) > 0)
    .sort((a, b) => Number(a.stockBaseQty ?? 0) - Number(b.stockBaseQty ?? 0));
  const recentMovements = [...movementRows]
    .sort((a, b) => safeDate(b.createdAt ?? b.created_at).getTime() - safeDate(a.createdAt ?? a.created_at).getTime())
    .slice(0, 4);

  return (
    <PageShell className="space-y-4 bg-white pb-8">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <InventoryMetricCard label="Total Stock Value" value={fmtMoney(stockStats.stockValue)} detail="At current cost" tone="blue" icon={<IndianRupee size={19} />} />
        <InventoryMetricCard label="Total SKUs" value={stockStats.products.toLocaleString("en-IN")} detail={`${stockStats.totalQuantity.toLocaleString("en-IN")} units tracked`} tone="violet" icon={<Tags size={19} />} />
        <InventoryMetricCard label="Low Stock Items" value={stockStats.lowStock.toLocaleString("en-IN")} detail="Require attention" tone="amber" icon={<AlertTriangle size={19} />} />
        <InventoryMetricCard label="Out of Stock Items" value={stockStats.outOfStock.toLocaleString("en-IN")} detail="Take immediate action" tone="rose" icon={<PackageX size={19} />} />
        <InventoryMetricCard label="Stock Turnover (30D)" value={`${stockStats.turnover30}x`} detail={stockStats.turnover30 > 0 ? "Based on sold quantity" : "No sales movement yet"} tone="green" icon={<TrendingUp size={19} />} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <InventoryActionCard label="Add Stock" detail="Increase inventory" tone="blue" icon={<PackagePlus size={20} />} onClick={() => openMovement("purchase")} />
        <InventoryActionCard label="Stock Correction" detail="Adjust stock levels" tone="green" icon={<Wrench size={20} />} onClick={() => openMovement("correction")} />
        <InventoryActionCard label="Damage Entry" detail="Record damaged items" tone="orange" icon={<ShieldAlert size={20} />} onClick={() => openMovement("damage")} />
        <InventoryActionCard label="Supplier Purchase" detail="Create purchase entry" tone="violet" icon={<CircleDollarSign size={20} />} onClick={() => openMovement("purchase")} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="group flex min-h-[66px] w-full items-center gap-3 rounded-[10px] border border-[#e2e8f1] bg-white px-4 text-left shadow-[0_4px_14px_rgba(30,55,90,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_8px_20px_rgba(30,55,90,0.07)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef4ff] text-[#075fff]"><Ellipsis size={20} /></span>
              <span><span className="block text-[13px] font-semibold text-[#13223f]">More Actions</span><span className="mt-0.5 block text-[11px] text-[#6d7c98]">History, bills and insights</span></span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setActiveTab("movements")}><History size={15} className="mr-2" />Movement history</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("purchase-bills")}><ClipboardList size={15} className="mr-2" />Purchase bills</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("reports")}><BarChart3 size={15} className="mr-2" />Inventory insights</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab("batch")}><CalendarClock size={15} className="mr-2" />Batch and expiry</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InventoryTab)} className="space-y-4">
        {activeTab !== "dashboard" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#e2e8f1] bg-white px-4 py-3">
            <div><p className="text-[14px] font-semibold text-[#13223f]">{activeTab === "movements" ? "Movement History" : activeTab === "purchase-bills" ? "Purchase Bills" : activeTab === "reports" ? "Inventory Insights" : "Batch & Expiry"}</p><p className="text-[11px] text-[#718096]">Detailed inventory records and controls.</p></div>
            <Button variant="outline" className="h-9 rounded-[8px] text-[11px]" onClick={() => setActiveTab("dashboard")}><ChevronLeft size={14} className="mr-1.5" />Back to stock</Button>
          </div>
        ) : null}
        <TabsContent value="dashboard" className="mt-0 space-y-4">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.95fr)]">
            <section className="overflow-hidden rounded-[12px] border border-[#e2e8f1] bg-white shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
              <div className="border-b border-[#e8edf4] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#13223f]">Product Stock</h2>
                    <p className="mt-0.5 text-[11px] text-[#6d7c98]">Real-time stock from local data, ready to sync.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[240px] flex-1 lg:w-[340px]">
                      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a89a3]" />
                      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by product, SKU, barcode..." className="h-10 rounded-[8px] border-[#dfe6ef] bg-[#fbfcfe] pl-9 text-[12px] focus-visible:bg-white focus-visible:ring-1" />
                    </div>
                    <Button variant="outline" className="h-10 rounded-[8px] px-3 text-[12px]" onClick={() => setStockFilter(stockFilter === "all" ? "low" : "all")}><SlidersHorizontal size={14} className="mr-1.5" />Filters</Button>
                    <Button className="h-10 rounded-[8px] bg-[#075fff] px-4 text-[12px] shadow-[0_7px_16px_rgba(7,95,255,0.18)] hover:bg-[#0054e8]" onClick={exportInventory}><Download size={14} className="mr-1.5" />Export</Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <InventoryFilterSelect value={categoryFilter} onChange={setCategoryFilter} placeholder="All Categories" options={filterOptions.categories} />
                  <InventoryFilterSelect value={brandFilter} onChange={setBrandFilter} placeholder="All Brands" options={filterOptions.brands} />
                  <InventoryFilterSelect value={unitFilter} onChange={setUnitFilter} placeholder="All Units" options={filterOptions.units} />
                  <Select value={stockFilter} onValueChange={setStockFilter}>
                    <SelectTrigger className="h-9 rounded-[8px] border-[#dfe6ef] text-[11px] font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All Stock Status</SelectItem><SelectItem value="in">In Stock</SelectItem><SelectItem value="low">Low Stock</SelectItem><SelectItem value="out">Out of Stock</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-[12px]">
                  <thead><tr className="border-b border-[#e4eaf2] bg-[#f8fafc] text-[10px] font-semibold uppercase tracking-[0.02em] text-[#718096]">
                    <th className="px-4 py-3">Product</th><th className="px-3 py-3">SKU / Barcode</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Unit</th><th className="px-3 py-3 text-right">Stock</th><th className="px-3 py-3 text-right">Cost</th><th className="px-3 py-3 text-right">Total Value</th><th className="px-4 py-3 text-center">Status</th>
                  </tr></thead>
                  <tbody>
                    {inventory.isLoading ? Array.from({ length: 7 }).map((_, index) => <tr key={index}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-7 w-full" /></td></tr>) : pagedInventoryRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-16 text-center"><Package className="mx-auto text-[#a2aec0]" size={28} /><p className="mt-2 text-sm font-semibold text-[#243653]">No stock matches these filters</p><p className="mt-1 text-xs text-[#718096]">Clear a filter or add stock to continue.</p></td></tr>
                    ) : pagedInventoryRows.map((item) => {
                      const unit = item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece";
                      const qty = displayQtyFromBase(item.stockBaseQty, unit);
                      const cost = round2(item.averageCostPrice ?? item.costPerRateUnit ?? item.costPrice ?? 0);
                      const tracked = (item.stockTrackingEnabled ?? item.trackStock ?? true) !== false;
                      const out = tracked && Number(item.stockBaseQty ?? 0) <= 0;
                      const low = tracked && !out && isLowStock(item);
                      return <tr key={item.id} onClick={() => openMovement("purchase", item)} className="cursor-pointer border-b border-[#eef2f6] text-[#243653] transition-colors last:border-0 hover:bg-[#f8fbff]">
                        <td className="px-4 py-2.5"><div className="flex min-w-[160px] items-center gap-2.5"><InventoryProductAvatar item={item} /><div className="min-w-0"><p className="truncate font-semibold text-[#13223f]">{item.name}</p><p className="truncate text-[10px] text-[#7a89a3]">{item.brand ?? "Unbranded"}</p></div></div></td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-[#52627d]">{item.sku ?? item.barcode ?? "-"}</td>
                        <td className="px-3 py-2.5 text-[#52627d]">{item.category ?? "General"}</td>
                        <td className="px-3 py-2.5 capitalize text-[#52627d]">{unit}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{tracked ? qty.toLocaleString("en-IN") : "Not tracked"}</td>
                        <td className="px-3 py-2.5 text-right text-[#52627d]">{fmtMoney(cost)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{fmtMoney(qty * cost)}</td>
                        <td className="px-4 py-2.5 text-center"><InventoryStatusBadge status={out ? "out" : low ? "low" : "in"} /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <InventoryPagination page={safeStockPage} pages={stockTotalPages} total={inventoryRows.length} onChange={setStockPage} />
            </section>

            <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <section className="rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
                <h2 className="text-[14px] font-semibold text-[#13223f]">Stock Overview by Location</h2><p className="mt-0.5 text-[11px] text-[#718096]">Current stock distribution</p>
                <div className="mt-2 grid grid-cols-[132px_1fr] items-center gap-3">
                  <div className="h-[128px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: "Main Store", value: Math.max(stockStats.stockValue, 1) }]} dataKey="value" innerRadius={36} outerRadius={56} strokeWidth={0}><Cell fill="#075fff" /></Pie></PieChart></ResponsiveContainer></div>
                  <div><div className="flex items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full bg-[#075fff]" /><span className="font-semibold text-[#243653]">Main Store</span></div><p className="ml-4 mt-1 text-[11px] text-[#718096]">100% of tracked stock</p></div>
                </div>
                <div className="flex items-center justify-between border-t border-[#edf1f6] pt-3 text-[11px]"><span className="text-[#718096]">Total Value</span><span className="font-bold text-[#13223f]">{fmtMoney(stockStats.stockValue)}</span></div>
              </section>

              <section className="rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)]">
                <div className="flex items-start justify-between"><div><h2 className="text-[14px] font-semibold text-[#13223f]">Low Stock Alerts</h2><p className="mt-0.5 text-[11px] text-[#718096]">Items needing immediate attention</p></div><button type="button" onClick={() => setStockFilter("low")} className="text-[11px] font-semibold text-[#075fff]">View all</button></div>
                <div className="mt-2 divide-y divide-[#edf1f6]">
                  {lowStockRows.length === 0 ? <p className="py-7 text-center text-xs text-[#718096]">All tracked products have healthy stock.</p> : lowStockRows.slice(0, 3).map((item) => {
                    const unit = item.unit ?? item.displayUnit ?? item.rateUnit ?? "piece";
                    return <div key={item.id} className="flex items-center gap-2.5 py-2.5"><InventoryProductAvatar item={item} compact /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#243653]">{item.name}</p><p className="mt-0.5 text-[10px] text-[#ff304f]">{displayQtyFromBase(item.stockBaseQty, unit)} {unit} left</p></div><Button variant="outline" size="sm" className="h-7 rounded-[7px] border-[#ffd7a6] bg-[#fff9ef] px-2.5 text-[10px] font-semibold text-[#f08a00]" onClick={() => openMovement("purchase", item)}>Reorder</Button></div>;
                  })}
                </div>
              </section>

              <section className="rounded-[12px] border border-[#e2e8f1] bg-white p-4 shadow-[0_5px_18px_rgba(30,55,90,0.045)] md:col-span-2 xl:col-span-1">
                <div className="flex items-start justify-between"><div><h2 className="text-[14px] font-semibold text-[#13223f]">Recent Stock Updates</h2><p className="mt-0.5 text-[11px] text-[#718096]">Latest inventory movements</p></div><button type="button" onClick={() => setActiveTab("movements")} className="text-[11px] font-semibold text-[#075fff]">View all</button></div>
                <div className="mt-2 divide-y divide-[#edf1f6]">{recentMovements.length === 0 ? <p className="py-7 text-center text-xs text-[#718096]">No stock updates recorded yet.</p> : recentMovements.map((entry) => <RecentMovementRow key={entry.id} entry={entry} />)}</div>
              </section>
            </aside>
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
            <div className="sticky bottom-0 z-10 -mx-4 flex gap-3 border-t bg-background/95 px-4 py-3 pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={isSaving}>{isSaving ? <Loader2 size={14} className="animate-spin" /> : "Save locally"}</Button>
            </div>
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

type InventoryTone = "blue" | "violet" | "amber" | "rose" | "green" | "orange";

const INVENTORY_TONES: Record<InventoryTone, string> = {
  blue: "border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff]",
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
    <button type="button" onClick={onClick} className="group flex min-h-[66px] w-full items-center gap-3 rounded-[10px] border border-[#e2e8f1] bg-white px-4 text-left shadow-[0_4px_14px_rgba(30,55,90,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_8px_20px_rgba(30,55,90,0.07)]">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${INVENTORY_TONES[tone]}`}>{icon}</span>
      <span><span className="block text-[13px] font-semibold text-[#13223f]">{label}</span><span className="mt-0.5 block text-[11px] text-[#6d7c98]">{detail}</span></span>
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
    <span className={`grid shrink-0 place-items-center overflow-hidden border border-[#e4eaf2] bg-[#f7f9fc] text-xs font-bold text-[#075fff] ${size}`}>
      {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-contain" /> : item.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function InventoryStatusBadge({ status }: { status: "in" | "low" | "out" }) {
  const style = status === "in" ? "border-[#c7ecd4] bg-[#eaf9ef] text-[#169447]" : status === "low" ? "border-[#ffddb1] bg-[#fff5e8] text-[#ed8a00]" : "border-[#ffcdd4] bg-[#fff0f2] text-[#f2384f]";
  return <span className={`inline-flex rounded-[6px] border px-2 py-1 text-[10px] font-semibold ${style}`}>{status === "in" ? "In Stock" : status === "low" ? "Low Stock" : "Out of Stock"}</span>;
}

function InventoryPagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  const first = total === 0 ? 0 : (page - 1) * STOCK_ROWS_PER_PAGE + 1;
  const last = Math.min(page * STOCK_ROWS_PER_PAGE, total);
  const visible = Array.from({ length: Math.min(pages, 3) }, (_, index) => Math.min(Math.max(1, page - 1) + index, pages)).filter((value, index, rows) => rows.indexOf(value) === index);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-[#e8edf4] px-4 py-3 sm:flex-row">
      <p className="text-[10px] text-[#718096]">Showing {first} to {last} of {total.toLocaleString("en-IN")} products</p>
      <div className="flex items-center gap-1"><button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => onChange(page - 1)} className="grid h-8 w-8 place-items-center rounded-[7px] border border-[#dfe6ef] text-[#52627d] disabled:opacity-35"><ChevronLeft size={14} /></button>{visible.map((number) => <button type="button" key={number} onClick={() => onChange(number)} className={`grid h-8 min-w-8 place-items-center rounded-[7px] px-2 text-[11px] font-semibold ${number === page ? "bg-[#075fff] text-white" : "border border-[#dfe6ef] text-[#52627d]"}`}>{number}</button>)}<button type="button" aria-label="Next page" disabled={page === pages} onClick={() => onChange(page + 1)} className="grid h-8 w-8 place-items-center rounded-[7px] border border-[#dfe6ef] text-[#52627d] disabled:opacity-35"><ChevronRight size={14} /></button></div>
      <p className="text-[10px] text-[#718096]">{STOCK_ROWS_PER_PAGE} rows per page</p>
    </div>
  );
}

function RecentMovementRow({ entry }: { entry: MovementEntry }) {
  const type = entry.action ?? entry.type ?? "correction";
  const quantity = Number(entry.quantityDelta ?? entry.quantity_delta ?? 0);
  const positive = quantity > 0;
  const tone = type === "damage" || type === "sale" ? "rose" : type === "correction" ? "orange" : "green";
  const icon = type === "damage" ? <ShieldAlert size={13} /> : type === "sale" ? <PackageX size={13} /> : type === "correction" ? <Wrench size={13} /> : <PackagePlus size={13} />;
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border ${INVENTORY_TONES[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#243653]">{movementLabel(type)}</p><p className="truncate text-[10px] text-[#718096]">{entry.productName ?? "Inventory item"} - {format(safeDate(entry.createdAt ?? entry.created_at), "d MMM, h:mm a")}</p></div>
      <span className={`text-[11px] font-semibold ${positive ? "text-[#16a34a]" : "text-[#ff304f]"}`}>{positive ? "+" : ""}{quantity} {entry.unit ?? ""}</span>
    </div>
  );
}
