import { useEffect, useMemo, useState } from "react";
import { Loader2, NotebookPen, Plus, Search, Sofa, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, useMoneyDraft, useQuantityDraft } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import { useListProducts } from "@/features/core/products/queries";
import type { FurnitureOrder, FurnitureOrderInput } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Local YYYY-MM-DD — never toISOString(), which shifts the day backwards east of UTC. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface DraftLine {
  productId: string | null;
  name: string;
  variant: string;
  qty: number;
  rate: number;
  reserveStock: boolean;
}

function emptyLine(overrides: Partial<DraftLine> = {}): DraftLine {
  return { productId: null, name: "", variant: "", qty: 1, rate: 0, reserveStock: false, ...overrides };
}

export function OrderPanel({ open, editing, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean;
  editing: FurnitureOrder | null;
  saving: boolean;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  onSubmit: (data: FurnitureOrderInput) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [promisedOn, setPromisedOn] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [discount, setDiscount] = useState("0");
  const [deliveryCharge, setDeliveryCharge] = useState("0");
  const [installCharge, setInstallCharge] = useState("0");
  const [notes, setNotes] = useState("");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPick("");
    if (editing) {
      setCustomerName(editing.customerName);
      setCustomerPhone(editing.customerPhone ?? "");
      setDeliveryAddress(editing.deliveryAddress ?? "");
      setPromisedOn(editing.promisedOnKey ?? "");
      setIsCustom(editing.isCustom);
      setLines(editing.items.map((item) => emptyLine({
        productId: item.productId ?? null,
        name: item.name,
        variant: item.variant ?? "",
        qty: Number(item.qty) || 1,
        rate: Number(item.rate) || 0,
        reserveStock: Boolean(item.reserveStock),
      })));
      setDiscount(String(editing.discount ?? 0));
      setDeliveryCharge(String(editing.deliveryCharge ?? 0));
      setInstallCharge(String(editing.installCharge ?? 0));
      setNotes(editing.notes ?? "");
      // An existing order already has a status; confirming is its own action.
      setConfirmNow(false);
      return;
    }
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setPromisedOn("");
    setIsCustom(false);
    setConfirmNow(false);
    setLines([emptyLine()]);
    setDiscount("0");
    setDeliveryCharge("0");
    setInstallCharge("0");
    setNotes("");
  }, [open, editing]);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];

  const matches = useMemo(() => {
    const term = pick.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) => product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, pick]);

  const filled = lines.filter((line) => line.name.trim());
  const itemsTotal = filled.reduce((sum, line) => sum + line.qty * line.rate, 0);
  const grandTotal = Math.max(
    0,
    itemsTotal - (Number(discount) || 0) + (Number(deliveryCharge) || 0) + (Number(installCharge) || 0),
  );

  function addFromCatalogue(productId: string) {
    const product = catalogue.find((row) => row.id === productId);
    if (!product) return;
    setPick("");
    setError(null);
    setLines((prev) => {
      // A piece off the floor holds stock by default; that is the whole reason
      // the showroom needs to know what is promised.
      const line = emptyLine({
        productId: product.id,
        name: product.name,
        rate: Number(product.defaultPricePerRateUnit) || 0,
        reserveStock: true,
      });
      const blank = prev.findIndex((entry) => !entry.name.trim());
      if (blank === -1) return [...prev, line];
      return prev.map((entry, index) => (index === blank ? line : entry));
    });
  }

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== index)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerName.trim()) return setError("Enter the customer's name.");
    if (filled.length === 0) return setError("Add at least one item.");
    if (filled.some((line) => !(line.qty > 0))) return setError("Every line needs a quantity above zero.");
    setError(null);

    onSubmit({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || null,
      deliveryAddress: deliveryAddress.trim() || null,
      ...(editing ? {} : { status: confirmNow ? "confirmed" : "quote" }),
      items: filled.map((line) => ({
        productId: line.productId,
        name: line.name.trim(),
        variant: line.variant.trim() || null,
        qty: line.qty,
        rate: line.rate,
        reserveStock: line.reserveStock,
      })),
      discount: Number(discount) || 0,
      deliveryCharge: Number(deliveryCharge) || 0,
      installCharge: Number(installCharge) || 0,
      promisedOn: promisedOn || null,
      isCustom,
      notes: notes.trim() || null,
    });
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit order" : "New order"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
            {editing ? `Edit ${editing.orderNumber}` : "New order"}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">What was agreed, and when it was promised</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <SectionTitle>Customer</SectionTitle>
            <Fld label="Name *">
              <Input className="h-10" placeholder="E.g., Ramesh Kumar" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Mobile">
                <Input className="h-10" type="tel" inputMode="numeric" placeholder="10-digit" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </Fld>
              <Fld label="Promised for" hint="What the customer was told">
                <Input className="h-10" type="date" min={dayKey(new Date())} value={promisedOn} onChange={(e) => setPromisedOn(e.target.value)} />
              </Fld>
            </div>
            <Fld label="Delivery address">
              <Textarea className="min-h-[60px] resize-y" placeholder="House / street, area, city" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </Fld>
          </section>

          <section className="space-y-3">
            <SectionTitle>What was agreed</SectionTitle>

            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-10 pl-8" placeholder="Search the showroom floor…" value={pick} onChange={(e) => setPick(e.target.value)} />
              {pick.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                  {matches.length === 0 ? (
                    <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">
                      Nothing matches. Type the piece into a line below — most made-to-order work is not in the catalogue.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#eef2f8]">
                      {matches.map((product) => (
                        <li key={product.id}>
                          <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]" onClick={() => addFromCatalogue(product.id)}>
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Sofa size={15} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                              <span className="block truncate text-[11px] text-[#8492ac]">
                                {inr(Number(product.defaultPricePerRateUnit) || 0)}
                                {product.stockBaseQty != null && ` · ${product.stockBaseQty} on the floor`}
                              </span>
                            </span>
                            <Plus size={14} className="shrink-0 text-[#8492ac]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              {lines.map((line, index) => (
                <div key={index} className="space-y-2 rounded-[12px] border border-[#e7edf7] p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      className="h-9 flex-1"
                      placeholder="Piece — e.g. Teak wardrobe"
                      value={line.name}
                      onChange={(e) => patchLine(index, { name: e.target.value, productId: null, reserveStock: false })}
                      aria-label={`Item ${index + 1}`}
                    />
                    <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" onClick={() => removeLine(index)} aria-label={`Remove item ${index + 1}`}><X size={14} /></button>
                  </div>
                  <Input
                    className="h-9"
                    placeholder="Spec — teak, 6ft, walnut finish"
                    value={line.variant}
                    onChange={(e) => patchLine(index, { variant: e.target.value })}
                    aria-label={`Spec for item ${index + 1}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <LineQuantity qty={line.qty} onChange={(qty) => patchLine(index, { qty })} label={`Quantity for item ${index + 1}`} />
                    <span className="text-[12px] text-[#8492ac]">×</span>
                    <LineRate rate={line.rate} onChange={(rate) => patchLine(index, { rate })} label={`Rate for item ${index + 1}`} />
                    <span className="ml-auto text-[12.5px] font-bold text-[var(--brand-ink)]">{inr(line.qty * line.rate)}</span>
                  </div>
                  {line.productId && (
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-[#52627e]">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                        checked={line.reserveStock}
                        onChange={(e) => patchLine(index, { reserveStock: e.target.checked })}
                      />
                      Hold this off the floor while the order is open
                    </label>
                  )}
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" className="h-9 w-full gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus size={14} /> Add another piece
            </Button>
          </section>

          <section className="space-y-3">
            <SectionTitle>Money</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Fld label="Discount (₹)">
                <Input className="h-10" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Fld>
              <Fld label="Delivery (₹)">
                <Input className="h-10" type="number" min="0" step="0.01" value={deliveryCharge} onChange={(e) => setDeliveryCharge(e.target.value)} />
              </Fld>
              <Fld label="Installation (₹)">
                <Input className="h-10" type="number" min="0" step="0.01" value={installCharge} onChange={(e) => setInstallCharge(e.target.value)} />
              </Fld>
            </div>
            <div className="flex items-center justify-between rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
              <span className="text-[12px] font-semibold text-[#52627e]">Order total</span>
              <span className="font-display text-[17px] font-black text-[var(--brand-ink)]">{inr(grandTotal)}</span>
            </div>
            <p className="text-[11px] text-[#8492ac]">
              This is not a bill and settles nothing — it is what was agreed. The bill is rung when the goods go out, and advances are taken against this total.
            </p>
          </section>

          <section className="space-y-3">
            <SectionTitle>Notes</SectionTitle>
            <Fld label="Anything to remember (optional)">
              <Textarea className="min-h-[60px] resize-y" placeholder="Finish, fabric, site access, who to call before delivery…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Fld>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3">
              <input type="checkbox" className="mt-[3px] h-4 w-4 accent-[var(--brand)]" checked={isCustom} onChange={(e) => setIsCustom(e.target.checked)} />
              <span>
                <span className="block text-[12.5px] font-bold text-[var(--brand-ink)]">Made to order</span>
                <span className="mt-0.5 block text-[11px] text-[#8492ac]">Nothing on the floor to hold — the lead time is real production time.</span>
              </span>
            </label>
            {!editing && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3">
                <input type="checkbox" className="mt-[3px] h-4 w-4 accent-[var(--brand)]" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
                <span>
                  <span className="block text-[12.5px] font-bold text-[var(--brand-ink)]">Confirmed, not just quoted</span>
                  <span className="mt-0.5 block text-[11px] text-[#8492ac]">
                    A confirmed order holds its pieces off the floor. Leave this off for a quotation the customer is taking away to think about.
                  </span>
                </span>
              </label>
            )}
          </section>

          {error && <p role="alert" className="rounded-[10px] bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700">{error}</p>}
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={saving}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><NotebookPen size={15} /> {editing ? "Save Changes" : "Create Order"}</>}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-black uppercase tracking-wider text-[#8492ac]">{children}</h3>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#9aa6bb]">{hint}</p>}
    </div>
  );
}

// A hook cannot be called inside the lines.map callback, so each row owns its
// draft here. Zero is not offered: submit already refuses a line without a
// quantity above zero, so a committed 0 could only ever block the save.
function LineQuantity({ qty, onChange, label }: { qty: number; onChange: (next: number) => void; label: string }) {
  const props = useQuantityDraft(qty, onChange);
  return <Input className="h-9 w-[70px]" type="number" inputMode="decimal" step="0.5" aria-label={label} {...props} />;
}

function LineRate({ rate, onChange, label }: { rate: number; onChange: (next: number) => void; label: string }) {
  const props = useMoneyDraft(rate, onChange);
  return <Input className="h-9 w-[110px]" type="number" inputMode="decimal" step="0.01" aria-label={label} {...props} />;
}
