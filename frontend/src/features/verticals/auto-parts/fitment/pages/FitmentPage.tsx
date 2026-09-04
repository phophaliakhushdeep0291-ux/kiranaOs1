import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Car, Check, CircleAlert, Layers, Loader2, Package, Plus, Receipt, Search, Trash2, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { queueProductsForBilling } from "@/features/core/billing/pending-cart-additions";
import { useListProducts } from "@/features/core/products/queries";
import {
  createFitment, deleteFitment, findPartsForVehicle, getFitmentSummary,
  getVehicleOptions, listFitments,
} from "@/features/verticals/auto-parts/fitment/api";
import type { FittingPart, PartFitment, PartFitmentInput } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function FitmentPage() {
  const { t } = useAppLanguage();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [year, setYear] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [searched, setSearched] = useState<{ make: string; model: string; year: string } | null>(null);
  const [results, setResults] = useState<FittingPart[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PartFitment | null>(null);

  /**
   * Hand a found part to the till.
   *
   * The whole point of the book: "Mahindra 575 DI, 2018 — clutch plate" ends on
   * a bill, not on a screen the counter then has to remember and retype. Billing
   * prices it, because billing owns pricing.
   */
  const sellPart = useCallback(async (part: FittingPart) => {
    await queueProductsForBilling([{ productId: part.productId, name: part.productName }]);
    navigate("/billing");
  }, [navigate]);

  const summaryQ = useQuery({ queryKey: ["fitment", "summary"], queryFn: getFitmentSummary });
  const makesQ = useQuery({ queryKey: ["fitment", "vehicles"], queryFn: () => getVehicleOptions() });
  const modelsQ = useQuery({
    queryKey: ["fitment", "vehicles", make],
    queryFn: () => getVehicleOptions(make),
    enabled: Boolean(make),
  });
  const allFitmentsQ = useQuery({ queryKey: ["fitment", "list"], queryFn: () => listFitments() });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["fitment"] });

  function failure(title: string) {
    return (err: unknown) =>
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
  }

  const searchMut = useMutation({
    mutationFn: () => findPartsForVehicle({ make, model: model || undefined, variant: variant || undefined, year: year || undefined, search: partSearch || undefined }),
    onSuccess: (parts) => { setResults(parts); setSearched({ make, model, year }); },
    onError: failure("Could not search"),
  });

  const addMut = useMutation({
    mutationFn: (data: PartFitmentInput) => createFitment(data),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast({ title: "Fitment recorded" });
    },
    onError: failure("Could not record the fitment"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteFitment(id),
    onSuccess: () => { invalidate(); setRemoving(null); toast({ title: "Fitment removed" }); },
    onError: failure("Could not remove it"),
  });

  const summary = summaryQ.data;
  const makes = makesQ.data?.makes ?? [];
  const models = modelsQ.data?.models ?? [];
  const variants = modelsQ.data?.variants ?? [];

  const recent = useMemo(() => (allFitmentsQ.data ?? []).slice(0, 40), [allFitmentsQ.data]);

  return (
    <div className="app-docked-page">
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Offline — you can still look up what fits a vehicle from this device's saved list. Shelf counts and prices need a connection, and recording a new fitment does too.
          </div>
        )}

        {/* ── The counter question ── */}
        <form
          className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]"
          onSubmit={(e) => { e.preventDefault(); if (make) searchMut.mutate(); }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><Car size={16} /></span>
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">What fits this vehicle?</h3>
              <p className="text-[11.5px] text-[#64748b]">Pick the make, then narrow as far as the customer can tell you.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Fld label="Make *">
              <input
                list="fitment-makes"
                className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                placeholder="Maruti Suzuki"
                value={make}
                onChange={(e) => { setMake(e.target.value); setModel(""); setVariant(""); }}
              />
              <datalist id="fitment-makes">{makes.map((m) => <option key={m} value={m} />)}</datalist>
            </Fld>
            <Fld label="Model">
              <input
                list="fitment-models"
                className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                placeholder="Swift"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!make}
              />
              <datalist id="fitment-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            </Fld>
            <Fld label="Variant">
              <input
                list="fitment-variants"
                className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                placeholder="Diesel"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                disabled={!make}
              />
              <datalist id="fitment-variants">{variants.map((v) => <option key={v} value={v} />)}</datalist>
            </Fld>
            <Fld label="Year">
              <Input className="h-10" type="number" min="1900" max="2100" placeholder="2015" value={year} onChange={(e) => setYear(e.target.value)} />
            </Fld>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-10 pl-8" placeholder="Narrow by part — e.g. filter, brake" value={partSearch} onChange={(e) => setPartSearch(e.target.value)} />
            </div>
            <Button
              type="submit"
              disabled={!make || searchMut.isPending}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] px-5 font-black text-white hover:opacity-95"
            >
              {searchMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find Parts
            </Button>
            {results && (
              <Button type="button" variant="outline" className="h-11 lg:mouse:h-10 rounded-[10px] font-bold" onClick={() => { setResults(null); setSearched(null); }}>Clear</Button>
            )}
          </div>
        </form>

        {results && <VehicleResults results={results} searched={searched} onSell={sellPart} sellLabel={t("shopType.fitment.sell")} />}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Layers size={16} />} label="Fitments recorded" value={String(summary?.fitments ?? 0)} tone="blue" />
          <Kpi icon={<Car size={16} />} label="Makes covered" value={String(summary?.makes ?? 0)} tone="violet" />
          <Kpi icon={<Package size={16} />} label="Parts mapped" value={String(summary?.mappedParts ?? 0)} tone="green" />
          <Kpi
            icon={<CircleAlert size={16} />}
            label="Parts not yet mapped"
            value={String(summary?.unmappedParts ?? 0)}
            tone={summary?.unmappedParts ? "amber" : "green"}
          />
        </div>

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Fitment book</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">
                {summary && summary.unmappedParts > 0
                  ? `${summary.unmappedParts} of your ${summary.catalogueSize} parts are still invisible to a vehicle search.`
                  : "Every part you have told the app about, and the vehicles it fits."}
              </p>
            </div>
            <Button onClick={() => setAdding(true)} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 lg:mouse:h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
              <Plus size={15} /> Record Fitment
            </Button>
          </div>

          {allFitmentsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Wrench size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">Nothing mapped yet</p>
              <p className="max-w-[420px] text-[12px] text-[#64748b]">
                Record which vehicles a part fits and the counter can answer "Swift, 2015, diesel" without anyone having to remember the box.
              </p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Part</th>
                    <th className="px-5 py-2.5 text-left font-bold">Fits</th>
                    <th className="px-5 py-2.5 text-left font-bold">Years</th>
                    <th className="px-5 py-2.5 text-right font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((fitment, i) => (
                    <tr key={fitment.id} className={i < recent.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="px-5 py-3 align-top">
                        <p className="font-bold text-[var(--brand-ink)]">{fitment.productName}</p>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <p className="font-semibold text-[var(--brand-ink)]">{fitment.make} {fitment.model}</p>
                        <p className="mt-0.5 text-[11px] text-[#8492ac]">{fitment.variant || "All variants"}</p>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <span className="rounded-[7px] bg-[#f1f5fa] px-2 py-[3px] text-[11px] font-bold text-[#52627e]">{fitment.yearLabel}</span>
                      </td>
                      <td className="px-5 py-3 text-right align-top">
                        <button onClick={() => setRemoving(fitment)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Remove ${fitment.productName} from ${fitment.make} ${fitment.model}`}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AddFitmentDialog
        open={adding}
        saving={addMut.isPending}
        knownMakes={makes}
        onClose={() => setAdding(false)}
        onSubmit={(data) => addMut.mutate(data)}
      />

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Remove this fitment?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            "{removing?.productName}" will stop showing up when anyone searches for a {removing?.make} {removing?.model}. The part itself stays in your catalogue.
          </p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setRemoving(null)}>Keep it</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={removeMut.isPending} onClick={() => removing && removeMut.mutate(removing.id)}>
              {removeMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VehicleResults({ results, searched, onSell, sellLabel }: {
  results: FittingPart[];
  searched: { make: string; model: string; year: string } | null;
  onSell: (part: FittingPart) => void;
  sellLabel: string;
}) {
  const label = [searched?.make, searched?.model, searched?.year].filter(Boolean).join(" ");
  const inStock = results.filter((part) => part.stockQty > 0);

  if (results.length === 0) {
    return (
      <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-8 text-center shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f1f5fa] text-[#64748b]"><Car size={22} /></span>
        <p className="mt-2 text-[13px] font-bold text-[var(--brand-ink)]">Nothing recorded for {label || "that vehicle"}</p>
        <p className="mx-auto mt-1 max-w-[420px] text-[12px] text-[#64748b]">
          That does not mean you have nothing that fits — only that nobody has mapped it yet. Record a fitment once and it answers this question forever.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="border-b border-[#eef2f8] px-5 py-3.5">
        <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">
          {results.length} part{results.length === 1 ? "" : "s"} fit {label}
        </h3>
        <p className="mt-0.5 text-[11.5px] text-[#64748b]">
          {inStock.length > 0 ? `${inStock.length} of them on the shelf right now.` : "None of them are in stock at the moment."}
        </p>
      </div>
      <ul className="divide-y divide-[#eef2f8]">
        {results.map((part) => (
          <li key={part.productId} className="flex flex-wrap items-start gap-3 px-5 py-3">
            <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[9px]", part.stockQty > 0 ? "bg-emerald-50 text-emerald-600" : "bg-[#f1f5fa] text-[#8492ac]")}>
              {part.stockQty > 0 ? <Check size={16} /> : <Package size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[var(--brand-ink)]">{part.productName}</p>
              <p className="mt-0.5 text-[11.5px] text-[#8492ac]">
                {[part.brand, part.sku].filter(Boolean).join(" · ") || "No part number recorded"}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {part.fitments.map((fitment) => (
                  <span key={fitment.id} className="rounded-[6px] bg-[#f1f5fa] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#52627e]">
                    {fitment.variant ? `${fitment.variant} · ` : ""}{fitment.yearLabel}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right">
              {part.inCatalogue ? (
                <>
                  <p className={cn("text-[13px] font-black", part.stockQty > 0 ? "text-emerald-700" : "text-[#8492ac]")}>
                    {part.stockQty > 0 ? `${part.stockQty} in stock` : "Out of stock"}
                  </p>
                  {part.price > 0 && <p className="mt-0.5 text-[11.5px] text-[#52627e]">{inr(part.price)}</p>}
                  {/* Offered out of stock too: a parts shop takes the order and
                      fetches the box from the back, and some shops bill negative
                      stock on purpose rather than stop the counter. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 h-11 gap-1.5 rounded-[9px] text-[12px] font-black"
                    data-testid={`fitment-sell-${part.productId}`}
                    onClick={() => onSell(part)}
                  >
                    <Receipt size={13} /> {sellLabel}
                  </Button>
                </>
              ) : (
                <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.gray)}>Recorded as fitting</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddFitmentDialog({ open, saving, knownMakes, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  knownMakes: string[];
  onClose: () => void;
  onSubmit: (data: PartFitmentInput) => void;
}) {
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];
  const chosen = catalogue.find((product) => product.id === productId) ?? null;

  const matches = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) => product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, productSearch]);

  function reset() {
    setProductId(""); setProductSearch(""); setMake(""); setModel("");
    setVariant(""); setYearFrom(""); setYearTo(""); setError(null);
  }

  function submit() {
    if (!productId) return setError("Choose which part this is.");
    if (!make.trim()) return setError("Enter the make.");
    if (!model.trim()) return setError("Enter the model.");
    const from = yearFrom ? Number(yearFrom) : null;
    const to = yearTo ? Number(yearTo) : null;
    if (from && to && to < from) return setError("The last year cannot be before the first.");
    setError(null);
    onSubmit({
      productId,
      make: make.trim(),
      model: model.trim(),
      variant: variant.trim() || null,
      yearFrom: from,
      yearTo: to,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Record a fitment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {chosen ? (
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[#e7edf7] bg-[#f7f9fd] px-3.5 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Package size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{chosen.name}</p>
                {chosen.sku && <p className="truncate text-[11px] text-[#8492ac]">{chosen.sku}</p>}
              </div>
              <button type="button" className="text-[11.5px] font-bold text-[var(--brand)] hover:underline" onClick={() => { setProductId(""); setProductSearch(""); }}>Change</button>
            </div>
          ) : (
            <div className="relative">
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Which part *</Label>
              <Search size={14} className="pointer-events-none absolute left-3 top-[34px] text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-10 pl-8" placeholder="Search by name or part number" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
              {productSearch.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[200px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                  {matches.length === 0 ? (
                    <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">Nothing matches. Add the part to your catalogue first.</p>
                  ) : (
                    <ul className="divide-y divide-[#eef2f8]">
                      {matches.map((product) => (
                        <li key={product.id}>
                          <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]" onClick={() => { setProductId(product.id); setProductSearch(""); }}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                              {product.sku && <span className="block truncate text-[11px] text-[#8492ac]">{product.sku}</span>}
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

          <div className="grid grid-cols-2 gap-3">
            <Fld label="Make *">
              <input
                list="add-fitment-makes"
                className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                placeholder="Maruti Suzuki"
                value={make}
                onChange={(e) => setMake(e.target.value)}
              />
              <datalist id="add-fitment-makes">{knownMakes.map((m) => <option key={m} value={m} />)}</datalist>
            </Fld>
            <Fld label="Model *">
              <Input className="h-10" placeholder="Swift" value={model} onChange={(e) => setModel(e.target.value)} />
            </Fld>
          </div>

          <Fld label="Variant" hint="Leave blank if it fits every variant">
            <Input className="h-10" placeholder="Diesel 1.3 DDiS" value={variant} onChange={(e) => setVariant(e.target.value)} />
          </Fld>

          <div className="grid grid-cols-2 gap-3">
            <Fld label="From year" hint="Blank = since forever">
              <Input className="h-10" type="number" min="1900" max="2100" placeholder="2011" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} />
            </Fld>
            <Fld label="To year" hint="Blank = still current">
              <Input className="h-10" type="number" min="1900" max="2100" placeholder="2017" value={yearTo} onChange={(e) => setYearTo(e.target.value)} />
            </Fld>
          </div>

          {error && <p role="alert" className="rounded-[10px] bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700">{error}</p>}

          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button
              className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              disabled={saving}
              onClick={submit}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Record
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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

function Kpi({ icon, label, value, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "blue" | "violet" | "green" | "amber";
}) {
  const ring =
    tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : tone === "violet" ? "bg-violet-50 text-violet-600"
        : tone === "amber" ? "bg-amber-50 text-amber-600"
          : "bg-emerald-50 text-emerald-600";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 truncate font-display text-[24px] font-black leading-none text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}
