import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createSaleReturnLocalFirst, type RefundMode } from "@/features/returns/local-actions";
import { apiRequest } from "@/lib/api/http";
import { useOfflineStatus } from "@/features/sync";
import { Copy, Gift } from "lucide-react";

type ReturnRefundMode = RefundMode | "gift_card";

interface IssuedReturnGiftCard {
  id: string;
  code: string;
  codeLast4: string;
  balance: number;
  initialBalance: number;
}

interface CreatedReturn {
  id: string;
  billNo: string;
  issuedGiftCard?: IssuedReturnGiftCard;
}

export interface ReturnLineInput {
  billItemId?: string;
  productId?: string;
  sellingUnitId?: string;
  sellingUnitCode?: string;
  sellingUnitLabel?: string;
  conversionToBase?: number;
  name: string;
  soldQty: number; // max returnable; 0 = unlimited (standalone)
  enteredUnit: string;
  ratePerRateUnit: number;
  costPerRateUnit?: number;
  originalUnitPrice?: number;
  gstRate?: number;
}

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: ReturnLineInput[];
  customerId?: string;
  customerName?: string;
  originalBillId?: string;
  gstMode?: "inclusive" | "exclusive" | "none";
  onDone?: () => void;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function ReturnDialog({ open, onOpenChange, lines, customerId, customerName, originalBillId, gstMode = "inclusive", onDone }: ReturnDialogProps) {
  const { toast } = useToast();
  const { isOnline } = useOfflineStatus();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [damaged, setDamaged] = useState<Record<number, boolean>>({});
  const [refundMode, setRefundMode] = useState<ReturnRefundMode>("cash");
  const [issuedGiftCard, setIssuedGiftCard] = useState<IssuedReturnGiftCard | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const getQty = (i: number) => (qty[i] ?? 0);
  const refundTotal = useMemo(
    () => round2(lines.reduce((sum, line, i) => sum + getQty(i) * Number(line.ratePerRateUnit || 0), 0)),
    [lines, qty],
  );
  const hasCustomer = Boolean(customerId);
  const selectedCount = lines.filter((_, i) => getQty(i) > 0).length;

  function setLineQty(i: number, value: number, max: number) {
    const capped = max > 0 ? Math.max(0, Math.min(value, max)) : Math.max(0, value);
    setQty((prev) => ({ ...prev, [i]: round2(capped) }));
  }

  async function submit() {
    const items = lines
      .map((line, i) => ({ line, returnQty: getQty(i), isDamaged: Boolean(damaged[i]) }))
      .filter((row) => row.returnQty > 0)
      .map(({ line, returnQty, isDamaged }) => ({
        originalBillItemId: line.billItemId,
        productId: line.productId,
        sellingUnitId: line.sellingUnitId,
        sellingUnitCode: line.sellingUnitCode,
        sellingUnitLabel: line.sellingUnitLabel,
        conversionToBase: line.conversionToBase,
        name: line.name,
        quantity: returnQty,
        enteredUnit: line.enteredUnit,
        ratePerRateUnit: line.ratePerRateUnit,
        costPerRateUnit: line.costPerRateUnit,
        originalUnitPrice: line.originalUnitPrice,
        gstRate: line.gstRate ?? 0,
        damaged: isDamaged,
      }));
    if (items.length === 0) {
      toast({ title: "Nothing to return", description: "Set a return quantity for at least one item.", variant: "destructive" });
      return;
    }
    if (!/^\d{4}$/.test(ownerPin)) {
      toast({ title: "Owner PIN required", description: "Enter the 4-digit owner PIN to process a return.", variant: "destructive" });
      return;
    }
    if (refundMode === "udhar" && !hasCustomer) {
      toast({ title: "Customer required", description: "A return can only reduce udhar for a known customer.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (refundMode === "gift_card") {
        if (!isOnline) throw new Error("Connect to KiranaOS to issue secure store credit. Other refund modes remain available offline.");
        const created = await apiRequest<CreatedReturn>("/bills/returns", {
          method: "POST",
          ownerPin,
          body: JSON.stringify({
            items,
            refundMode,
            gstMode,
            customerId,
            customerName,
            returnOfBillId: originalBillId,
            reason: reason.trim() || "Customer return",
          }),
        });
        if (!created.issuedGiftCard?.code) throw new Error("Return was recorded but its store-credit code was not returned. Contact support before closing this screen.");
        setIssuedGiftCard(created.issuedGiftCard);
        toast({ title: "Store credit issued", description: `Return ${created.billNo} created for ₹${refundTotal.toLocaleString("en-IN")}. Copy the one-time code now.` });
      } else {
        await createSaleReturnLocalFirst({
          items,
          refundMode,
          gstMode,
          customerId,
          customerName,
          originalBillId,
          ownerPin,
          reason: reason.trim() || undefined,
        });
        toast({ title: "Return recorded", description: `Refund ₹${refundTotal.toLocaleString("en-IN")} via ${refundMode}. Stock and reports updated; cloud backup will run.` });
      }
      onOpenChange(false);
      setQty({});
      setDamaged({});
      setOwnerPin("");
      setReason("");
      onDone?.();
    } catch (error) {
      toast({ title: "Could not record return", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const modes: { key: ReturnRefundMode; label: string; disabled?: boolean }[] = [
    { key: "cash", label: "₹ Cash" },
    { key: "upi", label: "UPI" },
    { key: "bank", label: "Bank" },
    { key: "udhar", label: "Reduce udhar", disabled: !hasCustomer },
    { key: "gift_card", label: "Store credit", disabled: !isOnline },
  ];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return items</DialogTitle>
          <DialogDescription>
            Set how many of each item are coming back. Resellable items go back into stock; tick “Damaged” to write one off instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No items to return.</p>
          )}
          {lines.map((line, i) => {
            const max = line.soldQty;
            return (
              <div key={`${line.productId ?? line.name}-${i}`} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      ₹{Number(line.ratePerRateUnit).toLocaleString("en-IN")}/{line.enteredUnit}
                      {max > 0 ? ` · sold ${max}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setLineQty(i, getQty(i) - 1, max)}>−</Button>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="h-8 w-16 text-center"
                      value={getQty(i) === 0 ? "" : getQty(i)}
                      placeholder="0"
                      onChange={(e) => setLineQty(i, Number(e.target.value) || 0, max)}
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setLineQty(i, getQty(i) + 1, max)}>+</Button>
                  </div>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(damaged[i])}
                    onChange={(e) => setDamaged((prev) => ({ ...prev, [i]: e.target.checked }))}
                  />
                  Damaged / expired (write off — do not restock)
                </label>
              </div>
            );
          })}

          <div>
            <Label className="text-xs">Refund via</Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {modes.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  disabled={mode.disabled}
                  onClick={() => setRefundMode(mode.key)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-semibold",
                    refundMode === mode.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                    mode.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {!hasCustomer && <p className="mt-1 text-[11px] text-muted-foreground">Udhar refund needs a linked customer.</p>}
            {!isOnline && <p className="mt-1 text-[11px] text-amber-700">Store credit needs a live connection so its balance stays safe across every location.</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs" htmlFor="return-pin">Owner PIN</Label>
              <Input id="return-pin" type="password" inputMode="numeric" maxLength={4} value={ownerPin} placeholder="4-digit" onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="return-reason">Reason (optional)</Label>
              <Input id="return-reason" value={reason} placeholder="e.g. wrong item" onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-sm text-muted-foreground">{selectedCount} item{selectedCount === 1 ? "" : "s"} · Refund</span>
            <span className="text-lg font-black">₹{refundTotal.toLocaleString("en-IN")}</span>
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || refundTotal <= 0}>{busy ? "Processing…" : "Process return"}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(issuedGiftCard)} onOpenChange={(next) => { if (!next) setIssuedGiftCard(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><Gift className="h-6 w-6" /></div>
          <DialogTitle>Store credit ready</DialogTitle>
          <DialogDescription>This code is shown once. Give it to the customer now; KiranaOS stores only a protected fingerprint.</DialogDescription>
        </DialogHeader>
        {issuedGiftCard && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Redeem at any location</div>
              <div className="mt-2 font-mono text-xl font-black tracking-wider text-slate-950">{issuedGiftCard.code}</div>
              <div className="mt-2 text-sm text-slate-600">Balance ₹{issuedGiftCard.balance.toLocaleString("en-IN")}</div>
            </div>
            <Button className="w-full" onClick={() => void navigator.clipboard.writeText(issuedGiftCard.code).then(() => toast({ title: "Code copied" }))}>
              <Copy className="mr-2 h-4 w-4" /> Copy customer code
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
