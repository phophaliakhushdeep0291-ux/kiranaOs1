import { useAppLanguage } from "@/features/core/settings/i18n";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, useMoneyDraft, useQuantityDraft } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { readNumber } from "@/lib/offline/actions/utils";
import { cn } from "@/lib/utils";
import { BillPaymentMode, type BillInput, type Product } from "@/types/api";
import {
  addItemsToFinalizedBillLocalFirst,
  billInputFromBill,
  computeBillInputTotal,
  editFinalizedBillLocalFirst,
} from "@/features/core/bills/edit-actions";

type AnyRow = Record<string, unknown>;
type Mode = "edit" | "addon";
type PayChoice = "cash" | "upi" | "credit";

interface EditLine {
  key: string;
  productId?: string;
  name: string;
  quantity: number;
  ratePerRateUnit: number;
  enteredUnit: string;
  gstRate: number;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface EditBillDialogProps {
  open: boolean;
  mode: Mode;
  bill: AnyRow;
  itemRows: AnyRow[];
  onClose: () => void;
  onDone: () => void;
}

export function EditBillDialog({ open, mode, bill, itemRows, onClose, onDone }: EditBillDialogProps) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const seed = useMemo(() => billInputFromBill(bill, itemRows), [bill, itemRows]);
  const hasCustomer = Boolean(seed.customerId || (seed.customerName && seed.customerName !== "Walk-in"));
  const gstMode = seed.gstMode ?? "inclusive";

  const [lines, setLines] = useState<EditLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [pay, setPay] = useState<PayChoice>("cash");
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit") {
      setLines(seed.items.map((item, index) => ({
        key: `seed_${index}`,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        ratePerRateUnit: item.ratePerRateUnit,
        enteredUnit: item.enteredUnit,
        gstRate: item.gstRate ?? 0,
      })));
      setDiscount(seed.discount ?? 0);
      setPay(readNumber(bill.creditAmount, 0) > 0 && hasCustomer ? "credit" : "cash");
    } else {
      setLines([]);
      setDiscount(0);
      setPay("cash");
    }
    setSearch("");
    setPinOpen(false);
  }, [open, mode, seed, bill, hasCustomer]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const dbRows = await offlineDB.getAll<Product>("products").catch(() => []);
      const cached = readInstantCache<Product[]>("products", []);
      const merged = [...cached, ...dbRows.filter((p) => !cached.some((c) => c.id === p.id))].filter((p) => p?.name);
      if (active) setProducts(merged);
    })();
    return () => { active = false; };
  }, [open]);

  const inputItems = useMemo(
    () => lines
      .filter((line) => line.name.trim() && line.quantity > 0)
      .map((line) => ({
        productId: line.productId,
        name: line.name.trim(),
        quantity: line.quantity,
        enteredUnit: line.enteredUnit || "piece",
        ratePerRateUnit: line.ratePerRateUnit,
        gstRate: line.gstRate,
      })),
    [lines],
  );
  const total = computeBillInputTotal(inputItems, discount, gstMode);
  const discountProps = useMoneyDraft(discount, setDiscount);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [] as Product[];
    return products.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 6);
  }, [search, products]);

  function addProduct(product: Product) {
    setLines((prev) => [...prev, {
      key: `prod_${product.id}_${Date.now()}`,
      productId: product.id,
      name: product.name,
      quantity: 1,
      ratePerRateUnit: readNumber(product.defaultPricePerRateUnit ?? product.sellingPrice, 0),
      enteredUnit: str(product.rateUnit ?? product.baseUnit ?? product.unit) || "piece",
      gstRate: readNumber((product as unknown as AnyRow).gstRate, 0),
    }]);
    setSearch("");
  }

  function addBlankLine() {
    setLines((prev) => [...prev, { key: `blank_${Date.now()}`, name: "", quantity: 1, ratePerRateUnit: 0, enteredUnit: "piece", gstRate: 0 }]);
  }

  function updateLine(key: string, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function buildBillInput(): BillInput {
    const payments = pay === "credit"
      ? [{ mode: BillPaymentMode.credit, amount: total }]
      : total > 0
        ? [{ mode: pay === "upi" ? BillPaymentMode.upi : BillPaymentMode.cash, amount: total }]
        : [];
    return {
      billType: seed.billType,
      gstMode,
      customerId: seed.customerId,
      customerName: seed.customerName,
      customerMobile: seed.customerMobile,
      discount,
      items: inputItems,
      actualAmount: total,
      buyerPaidAmount: pay === "credit" ? 0 : total,
      payments,
    };
  }

  function validate(): string | null {
    if (inputItems.length === 0) return "Add at least one item.";
    if (pay === "credit" && !hasCustomer) return "An udhar bill needs a customer — this bill is walk-in.";
    return null;
  }

  async function saveAddon() {
    const problem = validate();
    if (problem) { toast({ title: t("billing.bills.edit.cannotSave"), description: problem, variant: "destructive" }); return; }
    setSaving(true);
    try {
      await addItemsToFinalizedBillLocalFirst({ originalBillId: str(bill.id), addOn: buildBillInput() });
      toast({ title: t("billing.bills.edit.addonCreated"), description: t("billing.bills.edit.addonCreatedHelp") });
      onDone();
      onClose();
    } catch (error) {
      toast({ title: t("billing.bills.edit.addonFailed"), description: errMsg(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function requestSaveEdit() {
    const problem = validate();
    if (problem) { toast({ title: t("billing.bills.edit.cannotSave"), description: problem, variant: "destructive" }); return; }
    setPinOpen(true);
  }

  async function confirmEdit(ownerPin: string, reason: string) {
    setSaving(true);
    try {
      await editFinalizedBillLocalFirst({ originalBillId: str(bill.id), ownerPin, reason, replacement: buildBillInput() });
      toast({ title: t("billing.bills.edit.billEdited"), description: t("billing.bills.edit.billEditedHelp") });
      setPinOpen(false);
      onDone();
      onClose();
    } catch (error) {
      toast({ title: t("billing.bills.edit.editFailed"), description: errMsg(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{mode === "edit" ? t("billing.bills.editBill") : "Add items to bill"}</DialogTitle>
            <DialogDescription>
              {mode === "edit"
                ? "Finalized bills stay immutable. Saving voids this bill and creates a corrected one — owner PIN required."
                : "This adds a separate bill for the extra items. The original bill is left unchanged."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search a product to add…"
                className="pl-9"
              />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-md">
                  {matches.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{product.name}</span>
                      <span className="text-muted-foreground">{money(readNumber(product.defaultPricePerRateUnit ?? product.sellingPrice, 0))}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto">
              {lines.length === 0 ? (
                <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                  {mode === "edit" ? "All items removed — add at least one." : "Search above or add a blank line to start."}
                </p>
              ) : (
                lines.map((line) => (
                  <div key={line.key} className="grid grid-cols-[1fr_64px_84px_auto] items-center gap-2">
                    <Input
                      value={line.name}
                      onChange={(event) => updateLine(line.key, { name: event.target.value })}
                      placeholder="Item name"
                      className="h-9"
                    />
                    <BillLineQuantity
                      quantity={line.quantity}
                      onChange={(quantity) => updateLine(line.key, { quantity })}
                    />
                    <BillLineRate
                      rate={line.ratePerRateUnit}
                      onChange={(ratePerRateUnit) => updateLine(line.key, { ratePerRateUnit })}
                    />
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-600" onClick={() => removeLine(line.key)} aria-label="Remove item">
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))
              )}
              <Button variant="outline" size="sm" className="gap-1" onClick={addBlankLine}>
                <Plus size={14} /> Add line
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("billing.bills.edit.payment")}</span>
                {(["cash", "upi", "credit"] as PayChoice[]).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setPay(choice)}
                    disabled={choice === "credit" && !hasCustomer}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition",
                      pay === choice ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                      choice === "credit" && !hasCustomer ? "cursor-not-allowed opacity-40" : "",
                    )}
                  >
                    {choice === "credit" ? "Udhar" : choice.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("billing.summary.discount")}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  {...discountProps}
                  className="h-9 w-24 text-right"
                  aria-label={t("billing.summary.discount")}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
              <span className="text-sm font-medium">{pay === "credit" ? "Goes to udhar" : "Customer pays"}</span>
              <span className="text-lg font-bold">{money(total)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>{t("billing.bills.cancel")}</Button>
            {mode === "edit" ? (
              <Button onClick={requestSaveEdit} disabled={saving}>{t("billing.bills.edit.voidAndSave")}</Button>
            ) : (
              <Button onClick={saveAddon} disabled={saving}>{t("billing.bills.edit.createAddon")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={pinOpen}
        onCancel={() => setPinOpen(false)}
        title="Confirm bill edit"
        description="Editing voids the original bill and recreates it with your changes. Owner PIN required."
        confirmLabel="Void & recreate"
        reasonRequired
        loading={saving}
        onConfirm={({ ownerPin, reason }) => confirmEdit(ownerPin, reason)}
      />
    </>
  );
}

// One row's quantity box. A hook cannot be called inside the lines.map callback,
// so each row gets its own component to own its draft. Zero is not offered: a
// bill line at zero drops out of the total while still sitting on screen, which
// reads as the bill quietly under-counting. Removing a line is the Trash button.
function BillLineQuantity({ quantity, onChange }: { quantity: number; onChange: (next: number) => void }) {
  const props = useQuantityDraft(quantity, onChange);
  return <Input type="number" inputMode="decimal" className="h-9 text-right" aria-label="Quantity" {...props} />;
}

// A hook cannot run inside the lines.map callback, so each row owns its draft.
function BillLineRate({ rate, onChange }: { rate: number; onChange: (next: number) => void }) {
  const { t } = useAppLanguage();
  const props = useMoneyDraft(rate, onChange);
  return <Input type="number" inputMode="decimal" className="h-9 text-right" aria-label={t("billing.bills.rate")} {...props} />;
}
