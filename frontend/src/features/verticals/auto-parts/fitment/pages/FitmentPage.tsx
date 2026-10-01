import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getActiveLocationId, LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";
import { createFitmentLookupContext } from "@/features/verticals/auto-parts/fitment/lookup-context";
import {
  createCrossReference, createFitment, deleteCrossReference, deleteFitment, findByPartNumber, findPartsForVehicle, getFitmentSummary,
  getVehicleOptions, listFitments,
} from "@/features/verticals/auto-parts/fitment/api";
import type { FittingPart, PartCrossReference, PartCrossReferenceInput, PartCrossReferenceKind, PartFitment, PartFitmentInput, PartNumberLookup } from "@/types/api";

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
  const [partNumber, setPartNumber] = useState("");
  const [numberResult, setNumberResult] = useState<PartNumberLookup | null>(null);
  const [searched, setSearched] = useState<{ make: string; model: string; variant: string; year: string } | null>(null);
  const [results, setResults] = useState<FittingPart[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [addingNumber, setAddingNumber] = useState(false);
  const [removingReference, setRemovingReference] = useState<PartCrossReference | null>(null);
  const [removing, setRemoving] = useState<PartFitment | null>(null);
  const [locationId, setLocationId] = useState(getActiveLocationId);
  const [lookupContext] = useState(createFitmentLookupContext);
  const handoffPending = useRef(false);
  const [selling, setSelling] = useState(false);

  useEffect(() => {
    const changeStore = () => {
      lookupContext.invalidate();
      setLocationId(getActiveLocationId());
      setResults(null); setSearched(null); setNumberResult(null);
      setAdding(false); setAddingNumber(false); setRemoving(null); setRemovingReference(null);
    };
    window.addEventListener(LOCATION_CHANGED_EVENT, changeStore);
    return () => { window.removeEventListener(LOCATION_CHANGED_EVENT, changeStore); lookupContext.invalidate(); };
  }, [lookupContext]);

  /**
   * Hand a found part to the till.
   *
   * The whole point of the book: "Mahindra 575 DI, 2018 — clutch plate" ends on
   * a bill, not on a screen the counter then has to remember and retype. Billing
   * prices it, because billing owns pricing.
   */
  const sellPart = useCallback(async (part: { productId: string; productName: string }) => {
    // Both result lists share a synchronous lock before the disabled state renders.
    if (handoffPending.current) return;
    handoffPending.current = true;
    setSelling(true);
    try {
      await queueProductsForBilling([{ productId: part.productId, name: part.productName }]);
      navigate("/billing");
    } catch {
      toast({ title: t("shopType.fitment.sellFailed"), description: t("shopType.fitment.sellRetry"), variant: "destructive" });
    } finally {
      handoffPending.current = false;
      setSelling(false);
    }
  }, [navigate, t, toast]);

  const summaryQ = useQuery({ queryKey: ["fitment", "summary", locationId], queryFn: getFitmentSummary });
  const makesQ = useQuery({ queryKey: ["fitment", "vehicles"], queryFn: () => getVehicleOptions() });
  const modelsQ = useQuery({
    queryKey: ["fitment", "vehicles", make],
    queryFn: () => getVehicleOptions(make),
    enabled: Boolean(make),
  });
  const variantsQ = useQuery({
    queryKey: ["fitment", "vehicles", make, model],
    queryFn: () => getVehicleOptions(make, model),
    enabled: Boolean(make && model),
  });
  const allFitmentsQ = useQuery({ queryKey: ["fitment", "list"], queryFn: () => listFitments() });

  const invalidate = () => { setResults(null); setSearched(null); void queryClient.invalidateQueries({ queryKey: ["fitment"] }); };

  function failure(title: string) {
    return (err: unknown) =>
      toast({ title, description: err instanceof Error ? err.message : t("shopType.fitment.book.retryHelp"), variant: "destructive" });
  }

  const searchMut = useMutation({
    mutationFn: (query: { make: string; model: string; variant: string; year: string; search: string }) => lookupContext.run(() => findPartsForVehicle(query)),
    onMutate: () => { setResults(null); setSearched(null); },
    onSuccess: (result, query) => { if (result.current) { setResults(result.value); setSearched(query); } },
    onError: failure("Could not search"),
  });
  const numberMut = useMutation({
    mutationFn: (number: string) => lookupContext.run(() => findByPartNumber(number)),
    onMutate: () => setNumberResult(null),
    onSuccess: (result) => { if (result.current) setNumberResult(result.value); },
    onError: failure("Could not look up the part number"),
  });
  const addNumberMut = useMutation({
    mutationFn: (data: PartCrossReferenceInput) => createCrossReference(data),
    onSuccess: (reference) => {
      invalidate();
      setAddingNumber(false);
      setPartNumber(reference.partNumber);
      numberMut.mutate(reference.partNumber);
      toast({ title: t("shopType.fitment.number.saved") });
    },
    onError: failure(t("shopType.fitment.number.saveFailed")),
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

  const removeReferenceMut = useMutation({
    mutationFn: (id: string) => deleteCrossReference(id),
    onSuccess: () => {
      invalidate(); setRemovingReference(null); setNumberResult(null);
      if (partNumber.trim()) numberMut.mutate(partNumber.trim());
      toast({ title: t("shopType.fitment.number.removed") });
    },
    onError: failure(t("shopType.fitment.number.removeFailed")),
  });

  const summary = summaryQ.data;
  const canManage = isOnline && !summaryQ.isError && summary?.canManage === true;
  const makes = makesQ.data?.makes ?? [];
  const models = modelsQ.data?.models ?? [];
  const variants = variantsQ.data?.variants ?? [];

  const recent = useMemo(() => (allFitmentsQ.data ?? []).slice(0, visibleCount), [allFitmentsQ.data, visibleCount]);

  return (
    <div className="app-docked-page">
      <div className="space-y-4">
        {isOnline && summary?.canManage === false && (
          <p role="status" className="rounded-[12px] border bg-slate-50 px-4 py-3 text-[12px] text-slate-700">{t("shopType.fitment.readOnly")}</p>
        )}
        {isOnline && !summaryQ.isPending && (summaryQ.isError || summary?.canManage === undefined) && (
          <div role="alert" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
            <p>{t("shopType.fitment.accessUnavailable")}</p>
            <Button variant="outline" className="mt-2 h-11" onClick={() => void summaryQ.refetch()}>{t("shopType.fitment.book.retry")}</Button>
          </div>
        )}
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Offline — you can still look up what fits a vehicle from this device's saved list. Shelf counts and prices need a connection, and recording a new fitment does too.
          </div>
        )}

        {/* ── The counter question ── */}
        <form
          className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]"
          onSubmit={(e) => { e.preventDefault(); if (make.trim()) searchMut.mutate({ make, model, variant, year, search: partSearch }); }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><Car size={16} /></span>
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">What fits this vehicle?</h3>
              <p className="text-[11.5px] text-[#64748b]">Pick the make, then narrow as far as the customer can tell you.</p>
            </div>
          </div>

          <fieldset disabled={searchMut.isPending} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
                onChange={(e) => { setModel(e.target.value); setVariant(""); }}
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
          </fieldset>

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

        {results && <VehicleResults results={results} searched={searched} onSell={sellPart} selling={selling} sellLabel={t("shopType.fitment.sell")} />}

        <form
          className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]"
          onSubmit={(e) => { e.preventDefault(); if (partNumber.trim()) numberMut.mutate(partNumber.trim()); }}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-[14px] font-black text-[var(--brand-ink)]">{t("shopType.fitment.number.title")}</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">{t("shopType.fitment.number.help")}</p>
            </div>
            <Button type="button" variant="outline" className="h-11 gap-2" disabled={!canManage} onClick={() => setAddingNumber(true)}>
              <Plus size={15} /> {t("shopType.fitment.number.record")}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              aria-label={t("shopType.fitment.number.label")}
              className="h-11 min-w-[180px] flex-1"
              placeholder={t("shopType.fitment.number.placeholder")}
              value={partNumber}
              disabled={numberMut.isPending}
              onChange={(e) => { setPartNumber(e.target.value); setNumberResult(null); }}
            />
            <Button type="submit" className="h-11 gap-2" disabled={!isOnline || !partNumber.trim() || numberMut.isPending}>
              {numberMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} {t("shopType.fitment.number.lookup")}
            </Button>
          </div>
          {!isOnline && <p className="mt-2 text-[11.5px] text-amber-800">{t("shopType.fitment.number.offline")}</p>}
          {numberResult && <PartNumberResults result={numberResult} onSell={sellPart} selling={selling} onRemove={setRemovingReference} canRemove={canManage} />}
        </form>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={<Layers size={16} />} label="Fitments recorded" value={summary ? String(summary.fitments) : "—"} tone="blue" />
          <Kpi icon={<Car size={16} />} label="Makes covered" value={summary ? String(summary.makes) : "—"} tone="violet" />
          <Kpi icon={<Package size={16} />} label="Parts mapped" value={summary ? String(summary.mappedParts) : "—"} tone="green" />
          <Kpi
            icon={<CircleAlert size={16} />}
            label="Parts not yet mapped"
            value={summary ? String(summary.unmappedParts) : "—"}
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
            <Button disabled={!canManage} onClick={() => setAdding(true)} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 lg:mouse:h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
              <Plus size={15} /> Record Fitment
            </Button>
          </div>

          {allFitmentsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : allFitmentsQ.isError ? (
            <div role="alert" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">{t("shopType.fitment.book.unavailable")}</p>
              <p className="text-[12px] text-[#64748b]">{t("shopType.fitment.book.retryHelp")}</p>
              <Button type="button" variant="outline" className="h-11" onClick={() => void allFitmentsQ.refetch()}>{t("shopType.fitment.book.retry")}</Button>
            </div>
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
              <table className="trade-mobile-table w-full text-[13px]">
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
                      <td data-label="Part" className="px-5 py-3 align-top">
                        <p className="font-bold text-[var(--brand-ink)]">{fitment.productName}</p>
                        {fitment.inCatalogue === false && <p className="text-[11px] text-[#64748b]">{t("shopType.fitment.catalogueRemoved")}</p>}
                      </td>
                      <td data-label="Fits" className="px-5 py-3 align-top">
                        <p className="font-semibold text-[var(--brand-ink)]">{fitment.make} {fitment.model}</p>
                        <p className="mt-0.5 text-[11px] text-[#8492ac]">{fitment.variant || "All variants"}</p>
                      </td>
                      <td data-label="Years" className="px-5 py-3 align-top">
                        <span className="rounded-[7px] bg-[#f1f5fa] px-2 py-[3px] text-[11px] font-bold text-[#52627e]">{fitment.yearLabel}</span>
                      </td>
                      <td data-label={t("workflow.register.actions")} className="px-5 py-3 text-right align-top">
                        <button disabled={!canManage} onClick={() => setRemoving(fitment)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-rose-500 hover:bg-rose-50 disabled:opacity-40" aria-label={`Remove ${fitment.productName} from ${fitment.make} ${fitment.model}`}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(allFitmentsQ.data?.length ?? 0) > visibleCount && <Button type="button" variant="outline" className="m-3 h-11" onClick={() => setVisibleCount((count) => count + 40)}>{t("shopType.fitment.more")}</Button>}
            </div>
          )}
        </div>
      </div>

      {adding && <AddFitmentDialog
        open={adding}
        saving={addMut.isPending}
        canSave={canManage}
        knownMakes={makes}
        onClose={() => setAdding(false)}
        onSubmit={(data) => { if (canManage) addMut.mutate(data); }}
      />}
      {addingNumber && <AddPartNumberDialog
        open={addingNumber}
        saving={addNumberMut.isPending}
        canSave={canManage}
        onClose={() => setAddingNumber(false)}
        onSubmit={(data) => { if (canManage) addNumberMut.mutate(data); }}
      />}

      <Dialog open={removingReference !== null} onOpenChange={(open) => { if (!open && !removeReferenceMut.isPending) setRemovingReference(null); }}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle>{t("shopType.fitment.number.removeTitle")}</DialogTitle></DialogHeader>
          <p className="text-[13px]">{removingReference?.partNumber} · {removingReference?.productName}</p>
          <p className="text-[12px] text-[#64748b]">{t("shopType.fitment.number.removeHelp")}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={removeReferenceMut.isPending} onClick={() => setRemovingReference(null)}>{t("shopType.fitment.number.cancel")}</Button>
            <Button disabled={!canManage || removeReferenceMut.isPending} onClick={() => canManage && removingReference && removeReferenceMut.mutate(removingReference.id)}>{t("shopType.fitment.number.remove")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Remove this fitment?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            "{removing?.productName}" will stop showing up when anyone searches for a {removing?.make} {removing?.model}. The part itself stays in your catalogue.
          </p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setRemoving(null)}>Keep it</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={!canManage || removeMut.isPending} onClick={() => canManage && removing && removeMut.mutate(removing.id)}>
              {removeMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PartNumberResults({ result, onSell, selling, onRemove, canRemove }: {
  result: PartNumberLookup;
  onSell: (part: { productId: string; productName: string }) => void;
  selling: boolean;
  onRemove: (reference: PartCrossReference) => void;
  canRemove: boolean;
}) {
  const { t } = useAppLanguage();
  if (result.products.length === 0 && result.references.length === 0) {
    return <p role="status" className="mt-3 rounded-[9px] bg-[#f7f9fd] px-3 py-3 text-[12px] text-[#52627e]">{t("shopType.fitment.number.noMatch", { number: result.partNumber })}</p>;
  }

  return (
    <div className="mt-3 space-y-3" role="region" aria-label={t("shopType.fitment.number.results", { number: result.partNumber })}>
      {result.products.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{t("shopType.fitment.number.catalogue")}</p>
          <ul className="mt-1 divide-y divide-[#eef2f8] rounded-[9px] border border-[#e6ecf4]">
            {result.products.map((part) => (
              <li key={part.productId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[var(--brand-ink)]">{part.productName}</p>
                  <p className="text-[11.5px] text-[#64748b]">{part.stockQty > 0 ? t("shopType.fitment.number.inStock", { count: part.stockQty }) : t("shopType.fitment.number.outOfStock")}{part.price > 0 ? ` · ${inr(part.price)}` : ""}</p>
                </div>
                <Button type="button" variant="outline" className="h-11 gap-1.5" disabled={selling} onClick={() => onSell(part)}>{selling ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />} {t("shopType.fitment.sell")}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.references.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{t("shopType.fitment.number.references")}</p>
          <ul className="mt-1 divide-y divide-[#eef2f8] rounded-[9px] border border-[#e6ecf4]">
            {result.references.map((reference) => (
              <li key={reference.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-[13px] font-bold text-[var(--brand-ink)]">{reference.productName}</p>
                  {reference.inCatalogue === false && <p className="text-[11px] text-[#64748b]">{t("shopType.fitment.catalogueRemoved")}</p>}</div>
                  <Button type="button" variant="ghost" className="h-11" disabled={!canRemove} aria-label={t("shopType.fitment.number.removeNamed", { number: reference.partNumber })} onClick={() => onRemove(reference)}><Trash2 size={14} /></Button>
                </div>
                <p className="text-[11.5px] text-[#64748b]">
                  {reference.kind === "oem" ? t("shopType.fitment.reference.oem")
                    : reference.kind === "supersedes" ? t("shopType.fitment.reference.supersedes")
                      : reference.kind === "superseded_by" ? t("shopType.fitment.reference.supersededBy")
                        : t("shopType.fitment.reference.alternative")}
                  {reference.brand ? ` · ${reference.brand}` : ""} · {t("shopType.fitment.number.verify")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VehicleResults({ results, searched, onSell, selling, sellLabel }: {
  results: FittingPart[];
  searched: { make: string; model: string; variant: string; year: string } | null;
  onSell: (part: FittingPart) => void;
  selling: boolean;
  sellLabel: string;
}) {
  const { t } = useAppLanguage();
  const label = [searched?.make, searched?.model, searched?.variant, searched?.year].filter(Boolean).join(" ");
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
          {results.some((part) => part.stockKnown === false) ? t("shopType.fitment.stockUnknown") : inStock.length > 0 ? `${inStock.length} of them on the shelf right now.` : "None of them are in stock at the moment."}
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
                    disabled={selling}
                    onClick={() => onSell(part)}
                  >
                    {selling ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />} {sellLabel}
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

function AddPartNumberDialog({ open, saving, canSave, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  canSave: boolean;
  onClose: () => void;
  onSubmit: (data: PartCrossReferenceInput) => void;
}) {
  const { t } = useAppLanguage();
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [kind, setKind] = useState<PartCrossReferenceKind>("oem");
  const [error, setError] = useState<string | null>(null);
  const productsQ = useListProducts(
    { search: productSearch.trim(), limit: 20 },
    { query: { enabled: open && Boolean(productSearch.trim()) } },
  );
  const catalogue = productsQ.data ?? [];
  const chosen = catalogue.find((product) => product.id === productId) ?? null;
  const matches = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return catalogue.filter((product) =>
      product.name.toLowerCase().includes(term)
      || (product.sku ?? "").toLowerCase().includes(term)).slice(0, 8);
  }, [catalogue, productSearch]);

  function reset() {
    setProductId(""); setProductSearch(""); setPartNumber(""); setBrand("");
    setKind("oem"); setError(null);
  }

  function submit() {
    if (!productId) return setError(t("shopType.fitment.number.choosePart"));
    if (!partNumber.trim()) return setError(t("shopType.fitment.number.required"));
    setError(null);
    onSubmit({ productId, partNumber: partNumber.trim(), brand: brand.trim() || null, kind });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose(); } }}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader><DialogTitle>{t("shopType.fitment.number.record")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {chosen ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-[#e7edf7] bg-[#f7f9fd] px-3 py-2.5">
              <Package size={16} className="text-[var(--brand)]" />
              <p className="min-w-0 flex-1 truncate text-[13px] font-bold">{chosen.name}</p>
              <Button type="button" variant="ghost" className="h-11" onClick={() => { setProductId(""); setProductSearch(""); }}>{t("shopType.fitment.number.change")}</Button>
            </div>
          ) : (
            <div className="relative">
              <Label>{t("shopType.fitment.number.choosePart")}</Label>
              <Input className="mt-1.5 h-11" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder={t("shopType.fitment.number.partSearch")} />
              {productSearch.trim() && (
                <div className="absolute z-30 mt-1 max-h-[200px] w-full overflow-y-auto rounded-[10px] border bg-white shadow-lg">
                  {matches.length ? matches.map((product) => (
                    <button key={product.id} type="button" className="block min-h-11 w-full border-b px-3 py-2 text-left text-[12.5px] font-bold last:border-0 hover:bg-[#f7f9fd]" onClick={() => setProductId(product.id)}>{product.name}{product.sku ? ` · ${product.sku}` : ""}</button>
                  )) : <p className="px-3 py-4 text-[12px] text-[#64748b]">{t("shopType.fitment.number.noParts")}</p>}
                </div>
              )}
            </div>
          )}
          <Fld label={t("shopType.fitment.number.label")}>
            <Input className="h-11" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder={t("shopType.fitment.number.placeholder")} />
          </Fld>
          <div className="grid grid-cols-2 gap-3">
            <Fld label={t("shopType.fitment.number.kind")}>
              <select className="h-11 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px]" value={kind} onChange={(e) => setKind(e.target.value as PartCrossReferenceKind)}>
                <option value="oem">{t("shopType.fitment.reference.oem")}</option>
                <option value="alternative">{t("shopType.fitment.reference.alternative")}</option>
                <option value="supersedes">{t("shopType.fitment.reference.supersedes")}</option>
                <option value="superseded_by">{t("shopType.fitment.reference.supersededBy")}</option>
              </select>
            </Fld>
            <Fld label={t("shopType.fitment.number.brand")}>
              <Input className="h-11" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Fld>
          </div>
          {error && <p role="alert" className="rounded-[9px] bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
          {!canSave && <p role="status" className="text-[12px] text-amber-800">{t("shopType.fitment.editUnavailable")}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => { reset(); onClose(); }}>{t("shopType.fitment.number.cancel")}</Button>
            <Button type="button" className="h-11 flex-1" disabled={!canSave || saving} onClick={submit}>{saving ? <Loader2 size={15} className="animate-spin" /> : t("shopType.fitment.number.save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddFitmentDialog({ open, saving, canSave, knownMakes, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  canSave: boolean;
  knownMakes: string[];
  onClose: () => void;
  onSubmit: (data: PartFitmentInput) => void;
}) {
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variant, setVariant] = useState("");
  const { t } = useAppLanguage();
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const productsQ = useListProducts(
    { search: productSearch.trim(), limit: 20 },
    { query: { enabled: open && Boolean(productSearch.trim()) } },
  );
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
    if ([from, to].some((value) => value !== null && (!Number.isInteger(value) || value < 1900 || value > 2100))) return setError(t("shopType.fitment.invalidYear"));
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
                          <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]" onClick={() => setProductId(product.id)}>
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
          {!canSave && <p role="status" className="text-[12px] text-amber-800">{t("shopType.fitment.editUnavailable")}</p>}

          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button
              className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              disabled={!canSave || saving}
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
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[#9aa6bb]">{hint}</span>}
    </label>
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
