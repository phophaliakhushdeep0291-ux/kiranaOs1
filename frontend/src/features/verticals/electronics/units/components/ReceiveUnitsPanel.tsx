import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, Search, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import { useListProducts } from "@/features/core/products/queries";
import type { ProductUnitCondition, ReceiveProductUnitsInput } from "@/types/api";

export const CONDITIONS: Array<{ key: ProductUnitCondition; label: string }> = [
  { key: "new", label: "New" },
  { key: "open_box", label: "Open box" },
  { key: "refurbished", label: "Refurbished" },
];

interface DraftUnit {
  imei: string;
  imei2: string;
  serialNumber: string;
  condition: ProductUnitCondition;
}

function emptyUnit(overrides: Partial<DraftUnit> = {}): DraftUnit {
  return { imei: "", imei2: "", serialNumber: "", condition: "new", ...overrides };
}

function hasIdentity(unit: DraftUnit) {
  return Boolean(unit.imei.trim() || unit.serialNumber.trim());
}

export function ReceiveUnitsPanel({ open, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  onSubmit: (data: ReceiveProductUnitsInput) => void;
}) {
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [costPrice, setCostPrice] = useState("0");
  const [warrantyMonths, setWarrantyMonths] = useState("12");
  const [purchaseBillId, setPurchaseBillId] = useState("");
  const [units, setUnits] = useState<DraftUnit[]>([emptyUnit()]);
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProductId("");
    setProductSearch("");
    setCostPrice("0");
    setWarrantyMonths("12");
    setPurchaseBillId("");
    setUnits([emptyUnit()]);
    setBulk("");
  }, [open]);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];
  const chosen = catalogue.find((product) => product.id === productId) ?? null;

  const matches = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) =>
        product.name.toLowerCase().includes(term)
        || (product.brand ?? "").toLowerCase().includes(term)
        || (product.sku ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, productSearch]);

  /**
   * A shop receiving twenty handsets scans them into one box rather than
   * tabbing through twenty forms. One code per line becomes one unit.
   */
  function applyBulk() {
    const codes = bulk
      .split(/[\n,;\t]/)
      .map((code) => code.trim())
      .filter(Boolean);
    if (codes.length === 0) return;
    setError(null);
    setUnits((prev) => {
      const existing = prev.filter(hasIdentity);
      // A 15-digit code is an IMEI; anything else is treated as a serial, which
      // is what a laptop or an appliance carries.
      const added = codes.map((code) =>
        (/^\d{15}$/.test(code) ? emptyUnit({ imei: code }) : emptyUnit({ serialNumber: code })));
      return [...existing, ...added];
    });
    setBulk("");
  }

  function patchUnit(index: number, patch: Partial<DraftUnit>) {
    setUnits((prev) => prev.map((unit, i) => (i === index ? { ...unit, ...patch } : unit)));
  }

  function removeUnit(index: number) {
    setUnits((prev) => (prev.length === 1 ? [emptyUnit()] : prev.filter((_, i) => i !== index)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const filled = units.filter(hasIdentity);
    if (!productId) return setError("Choose which product these units are.");
    if (filled.length === 0) return setError("Add at least one IMEI or serial number.");

    // Catching a repeated scan here saves a round trip and names the code.
    const seen = new Set<string>();
    for (const unit of filled) {
      for (const code of [unit.imei.trim(), unit.imei2.trim(), unit.serialNumber.trim()]) {
        if (!code) continue;
        const key = code.toUpperCase();
        if (seen.has(key)) return setError(`${code} is entered twice — scanned once too often?`);
        seen.add(key);
      }
    }
    setError(null);

    onSubmit({
      productId,
      purchaseBillId: purchaseBillId.trim() || null,
      costPrice: Number(costPrice) || 0,
      warrantyMonths: Number(warrantyMonths) || 0,
      units: filled.map((unit) => ({
        imei: unit.imei.trim() || null,
        imei2: unit.imei2.trim() || null,
        serialNumber: unit.serialNumber.trim() || null,
        condition: unit.condition,
      })),
    });
  }

  const readyCount = units.filter(hasIdentity).length;

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label="Add units to stock"
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">Add units to stock</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Scan each IMEI or serial as you open the box</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Which product ── */}
          <section className="space-y-3">
            <SectionTitle>Which product</SectionTitle>
            {chosen ? (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-[#e7edf7] bg-[#f7f9fd] px-3.5 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Smartphone size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{chosen.name}</p>
                  {chosen.brand && <p className="truncate text-[11px] text-[#8492ac]">{chosen.brand}</p>}
                </div>
                <button type="button" className="text-[11.5px] font-bold text-[var(--brand)] hover:underline" onClick={() => { setProductId(""); setProductSearch(""); }}>
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <Input className="h-10 pl-8" placeholder="Search your catalogue…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                {productSearch.trim() && (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                    {productsQ.isLoading ? (
                      <p className="flex items-center justify-center gap-2 px-3.5 py-4 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Loading…</p>
                    ) : matches.length === 0 ? (
                      <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">Nothing matches. Add the model to your catalogue first.</p>
                    ) : (
                      <ul className="divide-y divide-[#eef2f8]">
                        {matches.map((product) => (
                          <li key={product.id}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]"
                              onClick={() => { setProductId(product.id); setProductSearch(""); }}
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Smartphone size={15} /></span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                                {product.brand && <span className="block truncate text-[11px] text-[#8492ac]">{product.brand}</span>}
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
            )}

            <div className="grid grid-cols-3 gap-3">
              <Fld label="Cost each (₹)">
                <Input className="h-10" type="number" min="0" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
              </Fld>
              <Fld label="Warranty (months)">
                <Input className="h-10" type="number" min="0" max="120" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} />
              </Fld>
              <Fld label="Purchase bill">
                <Input className="h-10" placeholder="Optional" value={purchaseBillId} onChange={(e) => setPurchaseBillId(e.target.value)} />
              </Fld>
            </div>
            <p className="rounded-[10px] bg-[var(--brand-soft)] px-3 py-2 text-[11.5px] font-semibold text-[var(--brand)]">
              The warranty clock starts when a unit is sold, not now — this is the cover the box promises.
            </p>
          </section>

          {/* ── Scanning them in ── */}
          <section className="space-y-3">
            <SectionTitle>Scan or paste the codes</SectionTitle>
            <Fld label="Paste many at once" hint="One per line. A 15-digit code is read as an IMEI, anything else as a serial.">
              <Textarea
                className="min-h-[70px] resize-y font-mono text-[12px]"
                placeholder={"351234567890123\n351234567890125"}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
              />
            </Fld>
            <Button type="button" variant="outline" className="h-9 w-full gap-1.5 rounded-[9px] text-[12px] font-bold" disabled={!bulk.trim()} onClick={applyBulk}>
              <Boxes size={14} /> Add these as units
            </Button>

            <div className="space-y-2.5">
              {units.map((unit, index) => (
                <div key={index} className="space-y-2 rounded-[12px] border border-[#e7edf7] p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      className="h-9 flex-1 font-mono text-[12px]"
                      placeholder="IMEI"
                      inputMode="numeric"
                      value={unit.imei}
                      onChange={(e) => patchUnit(index, { imei: e.target.value })}
                      aria-label={`IMEI for unit ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50"
                      onClick={() => removeUnit(index)}
                      aria-label={`Remove unit ${index + 1}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input className="h-9 font-mono text-[12px]" placeholder="IMEI 2 (dual SIM)" inputMode="numeric" value={unit.imei2} onChange={(e) => patchUnit(index, { imei2: e.target.value })} aria-label={`Second IMEI for unit ${index + 1}`} />
                    <Input className="h-9 font-mono text-[12px]" placeholder="Serial number" value={unit.serialNumber} onChange={(e) => patchUnit(index, { serialNumber: e.target.value })} aria-label={`Serial number for unit ${index + 1}`} />
                    <select
                      className="h-9 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                      value={unit.condition}
                      onChange={(e) => patchUnit(index, { condition: e.target.value as ProductUnitCondition })}
                      aria-label={`Condition for unit ${index + 1}`}
                    >
                      {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" className="h-9 w-full gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => setUnits((prev) => [...prev, emptyUnit()])}>
              <Plus size={14} /> Add another unit
            </Button>
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
                : <><Boxes size={15} /> Add {readyCount || ""} Unit{readyCount === 1 ? "" : "s"}</>}
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
