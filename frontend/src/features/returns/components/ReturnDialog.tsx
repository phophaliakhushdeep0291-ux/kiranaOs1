import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createSaleReturnLocalFirst, type RefundMode } from "@/features/returns/local-actions";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import { useListProducts } from "@/features/products/queries";
import { apiRequest } from "@/lib/api/http";
import { useOfflineStatus } from "@/features/sync";
import { BillPaymentMode, type BillInput } from "@/types/api";
import { ArrowLeftRight, Copy, Gift, Plus, Trash2 } from "lucide-react";

type ReturnRefundMode = RefundMode | "gift_card";
/** Exchanges settle in immediate tender only — udhar/store-credit stay plain returns. */
type ExchangeSettleMode = "cash" | "upi" | "bank";

interface ExchangeLine {
  productId: string;
  name: string;
  enteredUnit: string;
  ratePerRateUnit: number;
  gstRate: number;
  quantity: number;
}

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
  const productsQuery = useListProducts({ limit: 1000 });
  const [qty, setQty] = useState<Record<number, number>>({});
  const [damaged, setDamaged] = useState<Record<number, boolean>>({});
  const [refundMode, setRefundMode] = useState<ReturnRefundMode>("cash");
  const [issuedGiftCard, setIssuedGiftCard] = useState<IssuedReturnGiftCard | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeLines, setExchangeLines] = useState<ExchangeLine[]>([]);
  const [exchangeProductId, setExchangeProductId] = useState("");

  const getQty = (i: number) => (qty[i] ?? 0);
  const refundTotal = useMemo(
    () => round2(lines.reduce((sum, line, i) => sum + getQty(i) * Number(line.ratePerRateUnit || 0), 0)),
    [lines, qty],
  );
  const hasCustomer = Boolean(customerId);
  const selectedCount = lines.filter((_, i) => getQty(i) > 0).length;
  const products = productsQuery.data ?? [];
  const isExchange = exchangeOpen && exchangeLines.some((line) => line.quantity > 0);
  const exchangeTotal = useMemo(
    () => round2(exchangeLines.reduce((sum, line) => sum + line.quantity * line.ratePerRateUnit, 0)),
    [exchangeLines],
  );
  // Positive = customer pays the shop; negative = shop refunds the customer.
  const exchangeDifference = round2(exchangeTotal - refundTotal);
  // Both documents settle fully in the SAME immediate tender; the drawer nets to
  // the difference on its own, so daily close and reports stay double-entry clean.
  const settleMode: ExchangeSettleMode = refundMode === "upi" || refundMode === "bank" ? refundMode : "cash";

  function setLineQty(i: number, value: number, max: number) {
    const capped = max > 0 ? Math.max(0, Math.min(value, max)) : Math.max(0, value);
    setQty((prev) => ({ ...prev, [i]: round2(capped) }));
  }

  function addExchangeLine() {
    const product = products.find((item) => item.id === exchangeProductId);
    if (!product) return;
    setExchangeLines((current) => current.some((line) => line.productId === product.id) ? current : [...current, {
      productId: product.id,
      name: product.name,
      enteredUnit: String(product.displayUnit ?? product.unit ?? product.rateUnit ?? "piece"),
      ratePerRateUnit: round2(Number(product.defaultPricePerRateUnit ?? product.sellingPrice ?? product.mrp ?? 0)),
      gstRate: Number(product.gstRate ?? 0),
      quantity: 1,
    }]);
    setExchangeProductId("");
  }

  function setExchangeQty(productId: string, value: number) {
    setExchangeLines((current) => current.map((line) => line.productId === productId ? { ...line, quantity: Math.max(0, round2(value)) } : line));
  }

  function resetForm() {
    setQty({});
    setDamaged({});
    setOwnerPin("");
    setReason("");
    setExchangeLines([]);
    setExchangeOpen(false);
    setExchangeProductId("");
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
    const activeExchangeLines = isExchange ? exchangeLines.filter((line) => line.quantity > 0) : [];
    setBusy(true);
    try {
      if (activeExchangeLines.length > 0) {
        // Exchange = the return + a replacement sale, each fully settled in the
        // same tender. The customer only handles the difference at the counter;
        // the drawer nets to exactly that difference.
        const returned = await createSaleReturnLocalFirst({
          items,
          refundMode: settleMode,
          gstMode,
          customerId,
          customerName,
          originalBillId,
          ownerPin,
          reason: reason.trim() || "Exchange",
        });
        try {
          const paymentMode = settleMode === "upi" ? BillPaymentMode.upi : settleMode === "bank" ? BillPaymentMode.bank : BillPaymentMode.cash;
          await createBillLocalFirst({
            billType: "normal_sale",
            gstMode,
            customerId,
            customerName: customerName ?? "Walk-in",
            items: activeExchangeLines.map((line) => ({
              productId: line.productId,
              name: line.name,
              quantity: line.quantity,
              enteredUnit: line.enteredUnit,
              ratePerRateUnit: line.ratePerRateUnit,
              gstRate: line.gstRate,
            })),
            payments: [{ mode: paymentMode, amount: exchangeTotal }],
          } as BillInput);
        } catch (saleError) {
          toast({
            title: "Return saved, new items NOT billed",
            description: `${returned.billNo} recorded the return, but the replacement sale failed: ${saleError instanceof Error ? saleError.message : "unknown error"}. Bill the new items from the Billing page.`,
            variant: "destructive",
          });
          onOpenChange(false);
          resetForm();
          onDone?.();
          return;
        }
        toast({
          title: "Exchange recorded",
          description: exchangeDifference > 0
            ? `Collect ₹${exchangeDifference.toLocaleString("en-IN")} from the customer (${settleMode}).`
            : exchangeDifference < 0
              ? `Refund ₹${Math.abs(exchangeDifference).toLocaleString("en-IN")} to the customer (${settleMode}).`
              : "Even exchange — nothing to collect or refund.",
        });
      } else if (refundMode === "gift_card") {
        if (!isOnline) throw new Error("Connect to Veyra to issue secure store credit. Other refund modes remain available offline.");
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
      resetForm();
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

          {/* Exchange: the customer takes replacement items instead of (or on top of) the refund. */}
          <div className="rounded-lg border">
            <button
              type="button"
              data-testid="exchange-toggle"
              onClick={() => setExchangeOpen((current) => !current)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold"
            >
              <span className="inline-flex items-center gap-2"><ArrowLeftRight size={15} className="text-primary" />Customer takes new items (exchange)</span>
              <span className="text-xs text-muted-foreground">{exchangeOpen ? "Hide" : "Add"}</span>
            </button>
            {exchangeOpen && (
              <div className="space-y-2 border-t px-3 py-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <select
                    data-testid="exchange-product-select"
                    value={exchangeProductId}
                    onChange={(event) => setExchangeProductId(event.target.value)}
                    className="h-9 w-full rounded-lg border bg-white px-2 text-sm"
                  >
                    <option value="">Add replacement product...</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} — ₹{Number(product.defaultPricePerRateUnit ?? product.sellingPrice ?? 0).toLocaleString("en-IN")}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" className="h-9 gap-1" onClick={addExchangeLine} disabled={!exchangeProductId}><Plus size={14} />Add</Button>
                </div>
                {exchangeLines.length === 0 ? (
                  <p className="rounded-md border border-dashed p-2.5 text-center text-xs text-muted-foreground">No replacement items yet.</p>
                ) : exchangeLines.map((line) => (
                  <div key={line.productId} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{line.name}</p>
                      <p className="text-xs text-muted-foreground">₹{line.ratePerRateUnit.toLocaleString("en-IN")}/{line.enteredUnit}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setExchangeQty(line.productId, line.quantity - 1)}>−</Button>
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="h-8 w-14 text-center"
                        value={line.quantity === 0 ? "" : line.quantity}
                        placeholder="0"
                        onChange={(event) => setExchangeQty(line.productId, Number(event.target.value) || 0)}
                      />
                      <Button type="button" size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setExchangeQty(line.productId, line.quantity + 1)}>+</Button>
                      <button type="button" title={`Remove ${line.name}`} onClick={() => setExchangeLines((current) => current.filter((item) => item.productId !== line.productId))} className="ml-1 text-rose-600 hover:text-rose-700"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">{isExchange ? "Settle difference via" : "Refund via"}</Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(isExchange ? modes.filter((mode) => mode.key === "cash" || mode.key === "upi" || mode.key === "bank") : modes).map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  disabled={mode.disabled}
                  onClick={() => setRefundMode(mode.key)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-semibold",
                    (isExchange ? settleMode : refundMode) === mode.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                    mode.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {isExchange && <p className="mt-1 text-[11px] text-muted-foreground">An exchange settles in immediate tender — the return refund and the new sale both use this mode; only the difference changes hands.</p>}
            {!isExchange && !hasCustomer && <p className="mt-1 text-[11px] text-muted-foreground">Udhar refund needs a linked customer.</p>}
            {!isExchange && !isOnline && <p className="mt-1 text-[11px] text-amber-700">Store credit needs a live connection so its balance stays safe across every location.</p>}
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
          <DialogDescription>This code is shown once. Give it to the customer now; Veyra stores only a protected fingerprint.</DialogDescription>
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
