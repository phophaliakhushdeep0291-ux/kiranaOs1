import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { patchProductLocalFirst } from "@/features/core/products/local-actions";
import { computeBulkPatch, intentHasEffect, type BulkEditIntent, type BulkPriceMode, type BulkStockMode } from "@/features/core/products/bulk-edit";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/types/api";
import { useAppLanguage } from "@/features/core/settings/i18n";

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Array<Product & Record<string, unknown>>;
  requiresOwnerPin: boolean;
  onDone: () => void;
}

const EMPTY: BulkEditIntent = { priceMode: "none", priceValue: 0, stockMode: "none", stockValue: 0 };

export function BulkEditDialog({ open, onOpenChange, products, requiresOwnerPin, onDone }: BulkEditDialogProps) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [intent, setIntent] = useState<BulkEditIntent>(EMPTY);
  const [ownerPin, setOwnerPin] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const patches = products.map((product) => computeBulkPatch(product, intent));
    return {
      changing: patches.filter((p) => !p.noop).length,
      floored: patches.filter((p) => p.flooredToMinimum).length,
    };
  }, [products, intent]);

  const hasEffect = intentHasEffect(intent);

  function reset() {
    setIntent(EMPTY);
    setOwnerPin("");
  }

  async function apply() {
    if (!hasEffect) return;
    if (requiresOwnerPin && !/^\d{4}$/.test(ownerPin)) {
      toast({ title: t("products.bulk.ownerPinRequired"), description: t("products.bulk.ownerPinHint"), variant: "destructive" });
      return;
    }
    setBusy(true);
    let changed = 0;
    let failed = 0;
    try {
      for (const product of products) {
        const { patch, noop } = computeBulkPatch(product, intent);
        if (noop) continue;
        try {
          await patchProductLocalFirst(product.id, patch, ownerPin || undefined, t("products.bulk.title"));
          changed += 1;
        } catch {
          failed += 1;
        }
      }
      toast({
        title: failed === 0 ? `Updated ${changed} product${changed === 1 ? "" : "s"}` : `Updated ${changed}, ${failed} failed`,
        description: failed === 0 ? t("products.bulk.savedLocally") : "Some products could not be updated — check their minimum price or required fields.",
        variant: failed === 0 ? "default" : "destructive",
      });
      onOpenChange(false);
      reset();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); if (!next) reset(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk edit {products.length} product{products.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Change selling price and stock across every selected product at once. A price that would fall below a product's minimum is raised to that minimum instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3">
            <Label className="text-xs font-bold uppercase text-muted-foreground">Selling price</Label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <Select value={intent.priceMode} onValueChange={(v) => setIntent((s) => ({ ...s, priceMode: v as BulkPriceMode }))}>
                <SelectTrigger data-testid="bulk-price-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Leave unchanged</SelectItem>
                  <SelectItem value="increase_pct">Increase by %</SelectItem>
                  <SelectItem value="decrease_pct">Decrease by %</SelectItem>
                  <SelectItem value="increase_flat">Increase by ₹</SelectItem>
                  <SelectItem value="decrease_flat">Decrease by ₹</SelectItem>
                  <SelectItem value="set">Set to ₹</SelectItem>
                </SelectContent>
              </Select>
              <Input
                data-testid="bulk-price-value"
                type="number"
                inputMode="decimal"
                className="w-28"
                disabled={intent.priceMode === "none"}
                value={intent.priceValue === 0 ? "" : intent.priceValue}
                placeholder={intent.priceMode.includes("pct") ? "%" : "₹"}
                onChange={(e) => setIntent((s) => ({ ...s, priceValue: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <Label className="text-xs font-bold uppercase text-muted-foreground">Stock (base units)</Label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <Select value={intent.stockMode} onValueChange={(v) => setIntent((s) => ({ ...s, stockMode: v as BulkStockMode }))}>
                <SelectTrigger data-testid="bulk-stock-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Leave unchanged</SelectItem>
                  <SelectItem value="set">Set to</SelectItem>
                  <SelectItem value="increase">Increase by</SelectItem>
                  <SelectItem value="decrease">Decrease by</SelectItem>
                </SelectContent>
              </Select>
              <Input
                data-testid="bulk-stock-value"
                type="number"
                inputMode="decimal"
                className="w-28"
                disabled={intent.stockMode === "none"}
                value={intent.stockValue === 0 ? "" : intent.stockValue}
                placeholder="qty"
                onChange={(e) => setIntent((s) => ({ ...s, stockValue: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>

          {requiresOwnerPin && (
            <div>
              <Label className="text-xs" htmlFor="bulk-owner-pin">Owner PIN</Label>
              <Input id="bulk-owner-pin" data-testid="bulk-owner-pin" type="password" inputMode="numeric" maxLength={4} value={ownerPin} placeholder="4-digit" onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <p className="mt-1 text-[11px] text-muted-foreground">Required because some selling prices are near their minimum.</p>
            </div>
          )}

          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm" data-testid="bulk-preview">
            {hasEffect ? (
              <>
                <span className="font-bold">{preview.changing}</span> of {products.length} will change
                {preview.floored > 0 ? <span className="text-amber-700"> · {preview.floored} raised to their minimum price</span> : null}
              </>
            ) : (
              <span className="text-muted-foreground">Choose a price or stock change to preview.</span>
            )}
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button data-testid="bulk-apply" onClick={() => void apply()} disabled={busy || !hasEffect || preview.changing === 0}>
            {busy ? t("products.bulk.applying") : `Apply to ${preview.changing || products.length}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
