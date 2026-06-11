import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, X } from "lucide-react";
import { getListProductsQueryKey, useListProducts, type Product } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { getProductEmoji } from "@/features/billing/pages/components/BillingSearch";
import { fromBaseQty, isDeletedProduct, productDisplayUnit } from "@/features/products/pages/product-pricing";
import { useRecordDamage, useRecordPurchase } from "@/features/inventory/queries";

const OUT_REASONS = ["Damage", "Expiry", "Sale Return", "Theft / Missing", "Other"];

export function StockMovementDialog({ mode, open, onOpenChange }: { mode: "in" | "out"; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const products = useListProducts({ limit: 1000 }, { query: { staleTime: 60_000 } });
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState(OUT_REASONS[0]);
  const [note, setNote] = useState("");

  const list = useMemo(() => (products.data ?? []).filter((p) => !isDeletedProduct(p)), [products.data]);
  const selected = list.find((p) => p.id === productId);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)).slice(0, 8);
  }, [list, search]);

  const recordPurchase = useRecordPurchase();
  const recordDamage = useRecordDamage();
  const pending = recordPurchase.isPending || recordDamage.isPending;

  function reset() {
    setProductId(""); setSearch(""); setQty(""); setCost(""); setSupplier(""); setReason(OUT_REASONS[0]); setNote("");
  }
  function close() { reset(); onOpenChange(false); }

  function currentStock(p: Product) {
    const unit = productDisplayUnit(p);
    return `${fromBaseQty(p.stockBaseQty, unit)} ${unit}`;
  }

  function submit() {
    if (!productId || !selected) { toast({ title: "Pick a product first", variant: "destructive" }); return; }
    const quantity = Number(qty);
    if (!quantity || quantity <= 0) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return; }
    const enteredUnit = productDisplayUnit(selected);
    const onDone = (label: string) => {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: label });
      close();
    };
    if (mode === "in") {
      recordPurchase.mutate(
        { data: { productId, quantity, enteredUnit, costPerRateUnit: cost === "" ? undefined : Number(cost), supplierName: supplier.trim() || undefined, note: note.trim() || undefined } },
        { onSuccess: () => onDone(`Added ${quantity} ${enteredUnit} to ${selected.name}`), onError: (e) => toast({ title: "Could not add stock", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }) },
      );
    } else {
      recordDamage.mutate(
        { data: { productId, quantity, enteredUnit, reason, note: note.trim() || undefined } },
        { onSuccess: () => onDone(`Removed ${quantity} ${enteredUnit} from ${selected.name}`), onError: (e) => toast({ title: "Could not remove stock", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }) },
      );
    }
  }

  const unitLabel = selected ? productDisplayUnit(selected) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">
            {mode === "in" ? "New Stock In" : "New Stock Out"}
          </DialogTitle>
          <p className="text-[12px] text-[#6d7c98]">
            {mode === "in" ? "Add incoming stock to a product." : "Record stock leaving inventory (damage, expiry, return)."}
          </p>
        </DialogHeader>

        <div className="space-y-3.5">
          {/* Product picker */}
          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Product<span className="ml-0.5 text-rose-500">*</span></Label>
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

          {/* Quantity */}
          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Quantity{unitLabel ? ` (${unitLabel})` : ""}<span className="ml-0.5 text-rose-500">*</span></Label>
            <Input className="h-10" type="number" inputMode="decimal" min={0} placeholder="0" value={qty} onChange={(e) => setQty(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>

          {mode === "in" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Cost / unit (₹)</Label>
                  <Input className="h-10" type="number" inputMode="decimal" min={0} placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Supplier</Label>
                  <Input className="h-10" placeholder="optional" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-[#9aa6bb]">Cost updates the product's weighted average cost.</p>
            </>
          ) : (
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Reason<span className="ml-0.5 text-rose-500">*</span></Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Note</Label>
            <Input className="h-10" placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="mt-2 flex gap-2.5">
          <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={close}>Cancel</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending}
            style={{ background: mode === "in" ? "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" : "linear-gradient(180deg,#f43f5e 0%,#e11d48 100%)" }}
            className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
          >
            {pending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : mode === "in" ? "Add Stock" : "Remove Stock"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
