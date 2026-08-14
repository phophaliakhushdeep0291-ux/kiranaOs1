import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, X } from "lucide-react";
import { getListProductsQueryKey, useListProducts, type Product } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { getProductEmoji } from "@/features/core/billing/pages/components/BillingSearch";
import { fromBaseQty, isDeletedProduct, productDisplayUnit, toBaseQty } from "@/features/core/products/pages/product-pricing";
import { activeInventorySellingUnits, findInventorySellingUnit, inventoryDisplayQuantity } from "@/features/core/inventory/stock-display";
import { useRecordPurchase, useRecordSale } from "@/features/core/inventory/queries";
import { ACTIVITY_EVENTS, trackEvent } from "@/lib/activity";
import { useAppLanguage } from "@/features/core/settings/i18n";

const OUT_REASONS = ["Counter stock out", "Expiry", "Damage", "Theft / Missing", "Other"];

function stockBaseQty(product: Product): number {
  if (product.stockBaseQty != null) {
    const base = Number(product.stockBaseQty);
    if (Number.isFinite(base)) return base;
  }
  const displayQty = Number(product.stockQuantity);
  if (!Number.isFinite(displayQty)) return 0;
  return toBaseQty(displayQty, productDisplayUnit(product));
}

export function StockMovementDialog({ mode, open, onOpenChange, initialProductId, initialUnitCode, width, onResizeStart }: { mode: "in" | "out"; open: boolean; onOpenChange: (o: boolean) => void; initialProductId?: string; initialUnitCode?: string; width: number; onResizeStart: (e: ReactMouseEvent) => void }) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const products = useListProducts({ limit: 1000 }, { query: { staleTime: 60_000 } });
  const [productId, setProductId] = useState("");
  // Which packaging is moving. A product sold as a 500 g packet AND a 5 kg bag has
  // to say which one arrived, or the quantity means nothing — and for a product
  // that counts each size separately it is the only way to move the right count.
  const [unitCode, setUnitCode] = useState("");

  useEffect(() => {
    if (open) {
      setProductId(initialProductId ?? "");
      setUnitCode(initialUnitCode ?? "");
    }
  }, [open, initialProductId, initialUnitCode]);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState(OUT_REASONS[0]);
  const [note, setNote] = useState("");

  const list = useMemo(() => (products.data ?? []).filter((p) => !isDeletedProduct(p)), [products.data]);
  const selectableProducts = useMemo(
    () => mode === "out" ? list.filter((p) => stockBaseQty(p) > 0) : list,
    [list, mode],
  );
  const selected = list.find((p) => p.id === productId);
  const packs = activeInventorySellingUnits(selected);
  const selectedPack = findInventorySellingUnit(selected, unitCode || undefined);
  const perPack = selected?.packagingMode === "per_pack";
  // For per-pack goods the shelf count of THIS size is the truth; pooled goods
  // convert the one shared pool into this size.
  const availableInPack = !selected
    ? 0
    : perPack && selectedPack
      ? Number(selectedPack.onHandQty ?? 0)
      : inventoryDisplayQuantity(selected, selectedPack?.unitCode);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return selectableProducts.filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)).slice(0, 8);
  }, [selectableProducts, search]);

  const recordPurchase = useRecordPurchase();
  const recordSale = useRecordSale();
  const pending = recordPurchase.isPending || recordSale.isPending;

  function reset() {
    setProductId(""); setUnitCode(""); setSearch(""); setQty(""); setCost(""); setSupplier(""); setReason(OUT_REASONS[0]); setNote("");
  }
  function close() { reset(); onOpenChange(false); }

  function currentStock(p: Product) {
    // A product that counts each size separately has no single "in stock" number —
    // showing one (or the pooled base total) is exactly the confusion this mode
    // exists to remove, so list the sizes.
    if (p.packagingMode === "per_pack") {
      const rows = activeInventorySellingUnits(p);
      if (rows.length > 0) return rows.map((unit) => `${Number(unit.onHandQty ?? 0)} × ${unit.name}`).join(" · ");
    }
    const unit = productDisplayUnit(p);
    return `${fromBaseQty(stockBaseQty(p), unit)} ${unit}`;
  }

  function submit() {
    if (!productId || !selected) { toast({ title: t("inventory.movement.pickProduct"), variant: "destructive" }); return; }
    const quantity = Number(qty);
    if (!quantity || quantity <= 0) { toast({ title: t("inventory.movement.invalidQuantity"), variant: "destructive" }); return; }
    if (mode === "in" && cost === "") {
      toast({ title: t("inventory.movement.enterCost"), description: t("inventory.movement.enterCostHelp"), variant: "destructive" });
      return;
    }
    // The chosen packaging IS the unit of this movement: "12" means 12 of that
    // pack, and its own conversion turns that into base units on both sides.
    const enteredUnit = selectedPack?.unitCode ?? productDisplayUnit(selected);
    const unitLabelForToast = selectedPack?.name ?? enteredUnit;
    const onDone = (label: string) => {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      // §13 INVENTORY_UPDATE — the counter behind "most frequently edited
      // products". Recorded only on success, so a rejected movement does not
      // make a product look busy.
      trackEvent(ACTIVITY_EVENTS.INVENTORY_UPDATE, {
        productId,
        productName: selected.name,
        direction: mode,
        reason: mode === "out" ? reason : undefined,
      });
      toast({ title: label });
      close();
    };
    if (mode === "in") {
      recordPurchase.mutate(
        { data: { productId, quantity, enteredUnit, sellingUnitId: selectedPack?.id, costPerRateUnit: cost === "" ? undefined : Number(cost), supplierName: supplier.trim() || undefined, note: note.trim() || undefined } },
        { onSuccess: () => onDone(`Added ${quantity} ${unitLabelForToast} to ${selected.name}`), onError: (e) => toast({ title: t("inventory.movement.addFailed"), description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }) },
      );
    } else {
      if (quantity > availableInPack) {
        toast({ title: t("inventory.movement.outExceedsStock"), description: `Available: ${currentStock(selected)}`, variant: "destructive" });
        return;
      }
      recordSale.mutate(
        { data: { productId, quantity, enteredUnit, sellingUnitId: selectedPack?.id, reason, note: note.trim() || undefined } },
        { onSuccess: () => onDone(`Removed ${quantity} ${unitLabelForToast} from ${selected.name}`), onError: (e) => toast({ title: t("inventory.movement.removeFailed"), description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }) },
      );
    }
  }

  const unitLabel = selectedPack?.name ?? (selected ? productDisplayUnit(selected) : "");

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={mode === "in" ? "New stock in" : "New stock out"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">{mode === "in" ? "New Stock In" : "New Stock Out"}</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{mode === "in" ? "Add incoming stock to a product." : "Record stock leaving inventory."}</p>
        </div>
        <button onClick={close} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
        {/* Product picker */}
        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.col.product")}<span className="ml-0.5 text-rose-500">*</span></Label>
          {selected ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-[#e3eaf3] bg-[#f8fafd] px-3 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white text-lg">
                {selected.imageUrl ? <img src={selected.imageUrl} alt="" className="h-full w-full object-contain" /> : getProductEmoji(selected.name, selected.category)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-extrabold text-[#14284e]">{selected.name}</p>
                <p className="text-[11px] text-[#6d7c98]">In stock: {currentStock(selected)}</p>
              </div>
              <button onClick={() => { setProductId(""); setSearch(""); }} className="grid h-7 w-7 place-items-center rounded-lg text-[#536383] hover:bg-[#eef1f6]" aria-label="Change product"><X size={15} /></button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
                <Input className="h-10 pl-9" placeholder="Search product by name or barcode" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
              </div>
              {matches.length > 0 && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-[10px] border border-[#e6ecf4] bg-white shadow-sm">
                  {matches.map((p) => (
                    <button key={p.id} onClick={() => { setProductId(p.id); setSearch(""); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#f7f9fd]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#f4f7fb] text-base">
                        {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-contain" /> : getProductEmoji(p.name, p.category)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-bold text-[#14284e]">{p.name}</span>
                        <span className="block text-[11px] text-[#6d7c98]">In stock: {currentStock(p)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Packaging — only worth asking when the product really has more than one */}
        {selected && packs.length > 1 ? (
          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.movement.packaging")}<span className="ml-0.5 text-rose-500">*</span></Label>
            <Select value={selectedPack?.unitCode ?? ""} onValueChange={setUnitCode}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Select pack size" /></SelectTrigger>
              <SelectContent>
                {packs.map((pack) => (
                  <SelectItem key={pack.unitCode} value={pack.unitCode}>
                    {pack.name}{perPack ? ` · ${Number(pack.onHandQty ?? 0)} in stock` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-[#9aa6bb]">
              {perPack
                ? "Each size has its own stock. Only the size you pick will change."
                : "All sizes share one stock; this only sets how the quantity is counted."}
            </p>
          </div>
        ) : null}

        {/* Quantity */}
        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Quantity{unitLabel ? ` (${unitLabel})` : ""}<span className="ml-0.5 text-rose-500">*</span></Label>
          <Input className="h-10" type="number" inputMode="decimal" min={0} placeholder="0" value={qty} onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} />
          {selected && mode === "out" ? (
            <p className="mt-1 text-[11px] text-[#9aa6bb]">Available: {availableInPack} {unitLabel}</p>
          ) : null}
        </div>

        {mode === "in" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.movement.costPerUnit")}</Label>
                <Input className="h-10" type="number" inputMode="decimal" min={0} placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.movement.supplier")}</Label>
                <Input className="h-10" placeholder="optional" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-[#9aa6bb]">{t("inventory.movement.costHelp")}</p>
          </>
        ) : (
          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.col.reason")}<span className="ml-0.5 text-rose-500">*</span></Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{OUT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("inventory.col.note")}</Label>
          <Input className="h-10" placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={close}>{t("inventory.cancel")}</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending}
            style={{ background: mode === "in" ? "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" : "linear-gradient(180deg,#f43f5e 0%,#e11d48 100%)" }}
            className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
          >
            {pending ? <><Loader2 size={16} className="animate-spin" /> {t("inventory.saving")}</> : mode === "in" ? "Add Stock" : "Remove Stock"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
