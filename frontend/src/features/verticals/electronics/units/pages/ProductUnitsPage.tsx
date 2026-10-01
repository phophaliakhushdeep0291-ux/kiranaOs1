import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, BadgeCheck, Boxes, CheckCircle2, ClipboardCheck, Loader2, PackageCheck, Plus, ScanLine,
  Search, ShieldAlert, ShieldCheck, Smartphone, Trash2, Undo2, Wrench, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCounterDraft } from "@/hooks/use-counter-draft";
import { receiveUnitsDraft, unitSaleDraft } from "../receive-draft";
import { SpecialistHandoffError, queueSpecialistBill } from "@/features/core/billing/specialist-handoff";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import {
  deleteProductUnit, getProductUnitSummary, listProductUnits, lookupProductUnit,
  receiveProductUnits, returnProductUnit, returnProductUnitFromService,
  sellProductUnit, sendProductUnitToService, writeOffProductUnit,
} from "@/features/verticals/electronics/units/api";
import { TRACKED_UNITS_SLOT } from "@/features/verticals/electronics/units/billing-selection";
import { CONDITIONS, ReceiveUnitsPanel } from "@/features/verticals/electronics/units/components/ReceiveUnitsPanel";
import type { ProductUnit, ProductUnitStatus, ReceiveProductUnitsInput } from "@/types/api";

/** Local YYYY-MM-DD — never toISOString(), which shifts the day backwards east of UTC. */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDay(key?: string | null) {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

const STATUS_CHIP: Record<ProductUnitStatus, { label: string; tone: keyof typeof CHIP_TONES }> = {
  in_stock: { label: "In stock", tone: "green" },
  sold: { label: "Sold", tone: "blue" },
  returned: { label: "Returned", tone: "violet" },
  rma: { label: "At service", tone: "amber" },
  lost: { label: "Lost", tone: "gray" },
  scrapped: { label: "Scrapped", tone: "gray" },
};

const CONDITION_LABEL = new Map(CONDITIONS.map((c) => [c.key, c.label]));

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "held", label: "Still ours" },
  { key: "in_stock", label: "In stock" },
  { key: "sold", label: "Sold" },
  { key: "rma", label: "At service" },
  { key: "all", label: "Everything" },
];

export default function ProductUnitsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [filter, setFilter] = useState("held");
  const [search, setSearch] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [lookedUp, setLookedUp] = useState<{ code: string; unit: ProductUnit | null } | null>(null);
  const { t } = useAppLanguage();
  const registration = useCounterDraft(receiveUnitsDraft);
  const panelOpen = registration.value.open;
  const setPanelOpen = (open: boolean) => open ? registration.update({ open }) : registration.discard();
  const saleDraft = useCounterDraft(unitSaleDraft);
  const recording = saleDraft.value.unit;
  const setRecording = (unit: ProductUnit | null) => {
    saleDraft.discard();
    if (unit) saleDraft.update({ unit, soldOn: todayKey() });
  };
  const [, navigate] = useLocation();
  const [deleting, setDeleting] = useState<ProductUnit | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:units-panel-width", { defaultWidth: 500 });

  const listQ = useQuery({ queryKey: ["product-units"], queryFn: () => listProductUnits() });
  const summaryQ = useQuery({ queryKey: ["product-units", "summary"], queryFn: getProductUnitSummary });

  const invalidate = (unit?: ProductUnit) => {
    void queryClient.invalidateQueries({ queryKey: ["product-units"] });
    setLookedUp((current) => current && unit && current.unit?.id === unit.id ? { ...current, unit } : current);
  };

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) {
        return toast({
          title: "You're offline",
          description: "Recording units needs a connection so an IMEI can never be entered twice on two counters. Reconnect and try again.",
          variant: "destructive",
        });
      }
      // A hand-off refusal arrives as a key, because it was raised outside React
      // and had no language to say it in.
      const description = err instanceof SpecialistHandoffError
        ? t(err.notice.key, err.notice.vars)
        : err instanceof Error ? err.message : t("workflow.register.tryAgain");
      toast({ title, description, variant: "destructive" });
    };
  }

  const lookupMut = useMutation({
    mutationFn: (code: string) => lookupProductUnit(code),
    onSuccess: (unit, code) => setLookedUp({ code, unit }),
    onError: failure("Could not look that up"),
  });

  const receiveMut = useMutation({
    mutationFn: (data: ReceiveProductUnitsInput) => registration.submit(() => receiveProductUnits(data)),
    onSuccess: (units) => {
      invalidate();
      setLookedUp(null);
      toast({ title: t("workflow.electronics.register.saved", { count: units.length }) });
    },
    onError: failure("Could not add these units"),
  });

  // The ordinary way a unit is sold: billing opens with this handset on the
  // bill and its serial already chosen, and the bill records the sale.
  const billMut = useMutation({
    mutationFn: (unit: ProductUnit) => queueSpecialistBill({
      source: `unit:${unit.id}`,
      items: [{ productId: unit.productId, quantity: 1, name: unit.productName }],
      billingSlotValues: {
        [TRACKED_UNITS_SLOT]: [{ id: unit.id, productId: unit.productId, label: unit.imei || unit.serialNumber || unit.id }],
      },
    }),
    onSuccess: () => navigate("/billing"),
    onError: failure(t("workflow.register.billingFailed")),
  });

  // The exception: a handset that already left on a bill saved without its
  // serial. Nothing is billed here; the register is only being caught up.
  const recordMut = useMutation({
    mutationFn: ({ id, soldOn, ...sale }: { id: string; billNumber: string; soldOn: string; customerName: string; customerPhone: string; sellingPrice: number }) =>
      // An empty date is left out, so the server falls back to today rather than refusing it.
      saleDraft.submit(() => sellProductUnit(id, { ...sale, ...(soldOn ? { soldOn } : {}) })),
    onSuccess: (unit) => {
      invalidate(unit);
      toast({
        title: t("workflow.electronics.sold.saved", { name: unit.productName }),
        description: unit.warrantyUntilKey ? t("workflow.electronics.sold.savedCover", { date: fmtDay(unit.warrantyUntilKey) }) : undefined,
      });
    },
    onError: failure(t("workflow.electronics.sold.failed")),
  });

  const returnMut = useMutation({
    mutationFn: (id: string) => returnProductUnit(id),
    onSuccess: (unit) => { invalidate(unit); toast({ title: "Taken back into stock as open box" }); },
    onError: failure("Could not take it back"),
  });

  const serviceMut = useMutation({
    mutationFn: (id: string) => sendProductUnitToService(id),
    onSuccess: (unit) => { invalidate(unit); toast({ title: "Marked as away with the service centre" }); },
    onError: failure("Could not update"),
  });

  const serviceBackMut = useMutation({
    mutationFn: (id: string) => returnProductUnitFromService(id),
    onSuccess: (unit) => { invalidate(unit); toast({ title: "Back from service" }); },
    onError: failure("Could not update"),
  });

  const writeOffMut = useMutation({
    mutationFn: (id: string) => writeOffProductUnit(id, "lost"),
    onSuccess: (unit) => { invalidate(unit); toast({ title: "Marked as lost" }); },
    onError: failure("Could not write it off"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProductUnit(id),
    onSuccess: () => { invalidate(); setLookedUp(null); setDeleting(null); toast({ title: "Unit moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const all = listQ.data ?? [];
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((unit) => {
        if (filter === "all") return true;
        if (filter === "held") return unit.isHeld;
        if (filter === "in_stock") return unit.status === "in_stock" || unit.status === "returned";
        return unit.status === filter;
      })
      .filter((unit) => {
        if (!term) return true;
        return [unit.imei, unit.imei2, unit.serialNumber, unit.productName, unit.customerName, unit.billNumber]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      });
  }, [all, filter, search]);

  const summary = summaryQ.data;

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the units last saved on this device. Lookups still work; adding stock and recording a sale need a connection.
          </div>
        )}

        {/* ── The counter question: someone puts a handset down and asks ── */}
        <form
          className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]"
          onSubmit={(e) => { e.preventDefault(); if (lookupCode.trim()) lookupMut.mutate(lookupCode.trim()); }}
        >
          <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Check a handset</Label>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <ScanLine size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                className="h-11 pl-9 font-mono"
                placeholder="Scan or type an IMEI or serial"
                value={lookupCode}
                onChange={(e) => setLookupCode(e.target.value)}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="submit"
              disabled={!lookupCode.trim() || lookupMut.isPending}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 gap-2 rounded-[10px] px-5 font-black text-white hover:opacity-95"
            >
              {lookupMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Check
            </Button>
            {lookedUp && (
              <Button type="button" variant="outline" className="h-11 rounded-[10px] font-bold" onClick={() => { setLookedUp(null); setLookupCode(""); }}>
                Clear
              </Button>
            )}
          </div>

          {lookedUp && (lookedUp.unit ? <LookupCard unit={lookedUp.unit} /> : (
            <div className="mt-3 flex items-start gap-2.5 rounded-[12px] border border-[#e7edf7] bg-[#f7f9fd] px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef2f8] text-[#64748b]"><Smartphone size={17} /></span>
              <div>
                <p className="text-[13px] font-bold text-[var(--brand-ink)]">No record of <span className="font-mono">{lookedUp.code}</span></p>
                <p className="mt-0.5 text-[12px] text-[#64748b]">This shop never recorded this unit — it was not bought here, or it went out before you started tracking IMEIs.</p>
              </div>
            </div>
          ))}
        </form>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={<Boxes size={16} />} label="On the shelf" value={String(summary?.inStock ?? 0)} tone="green" />
          <Kpi icon={<PackageCheck size={16} />} label="Sold this month" value={String(summary?.soldThisMonth ?? 0)} tone="blue" />
          <Kpi icon={<Wrench size={16} />} label="At service" value={String(summary?.atService ?? 0)} tone={summary?.atService ? "amber" : "green"} />
          <Kpi
            icon={<ShieldAlert size={16} />}
            label={`Warranty ending in ${summary?.warrantySoonDays ?? 30} days`}
            value={String(summary?.warrantyExpiringSoon ?? 0)}
            tone={summary?.warrantyExpiringSoon ? "amber" : "green"}
          />
        </div>

        {/* A bill can be saved with no serial chosen — offline, or for a box not yet
            scanned. Stock moves and the register does not know which handset went;
            this is where that shows up afterwards, without anyone having to remember. */}
        {summary?.shelfMismatches && summary.shelfMismatches.length > 0 && (
          <div role="status" className="flex items-start gap-2.5 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold">{t("workflow.electronics.mismatch.title")}</p>
              <p className="mt-0.5 text-[12px] leading-5">
                {t("workflow.electronics.mismatch.body", {
                  items: [
                    ...summary.shelfMismatches.slice(0, 3).map((row) => t("workflow.electronics.mismatch.item", { name: row.productName, registered: row.registered, stock: row.stock })),
                    ...(summary.shelfMismatches.length > 3 ? [t("workflow.electronics.mismatch.more", { count: summary.shelfMismatches.length - 3 })] : []),
                  ].join("; "),
                })}
              </p>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">IMEI &amp; serial register</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">Every unit you have handled, and where each one went.</p>
            </div>
            <Button onClick={() => setPanelOpen(true)} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 lg:mouse:h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
              <Plus size={15} /> Add Units
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex h-11 items-center rounded-[8px] px-3 text-[11.5px] font-bold transition-colors lg:mouse:h-auto lg:mouse:px-2.5 lg:mouse:py-1.5",
                    filter === f.key ? "bg-[var(--brand)] text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-9 pl-8" placeholder="IMEI, model, buyer, bill no." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {listQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : listQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load the register. Check your connection.</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Smartphone size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">{all.length === 0 ? "No units recorded yet" : "Nothing matches this filter"}</p>
              <p className="max-w-[400px] text-[12px] text-[#64748b]">
                {all.length === 0
                  ? "Scan each IMEI or serial as you open a box. Months later you will still be able to say who bought that exact handset and whether it is in warranty."
                  : "Try another status or clear the search."}
              </p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto">
              <table className="trade-mobile-table w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Unit</th>
                    <th className="px-5 py-2.5 text-left font-bold">Status</th>
                    <th className="px-5 py-2.5 text-left font-bold">Sold to</th>
                    <th className="px-5 py-2.5 text-left font-bold">Warranty</th>
                    <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((unit, i) => {
                    const chip = STATUS_CHIP[unit.status] ?? STATUS_CHIP.in_stock;
                    return (
                      <tr key={unit.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                        <td data-label="Unit" className="px-5 py-3 align-top">
                          <p className="font-bold text-[var(--brand-ink)]">{unit.productName}</p>
                          {unit.imei && <p className="mt-0.5 font-mono text-[11.5px] text-[#52627e]">IMEI {unit.imei}</p>}
                          {unit.serialNumber && <p className="mt-0.5 font-mono text-[11px] text-[#8492ac]">S/N {unit.serialNumber}</p>}
                        </td>
                        <td data-label="Status" className="px-5 py-3 align-top">
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES[chip.tone])}>{chip.label}</span>
                          {unit.condition !== "new" && (
                            <span className="mt-1 block w-fit rounded-[7px] bg-[#f1f5fa] px-2 py-[3px] text-[11px] font-bold text-[#52627e]">
                              {CONDITION_LABEL.get(unit.condition) ?? unit.condition}
                            </span>
                          )}
                        </td>
                        <td data-label="Sold to" className="px-5 py-3 align-top">
                          {unit.soldAt ? (
                            <>
                              <p className="font-semibold text-[var(--brand-ink)]">{unit.customerName || "—"}</p>
                              <p className="mt-0.5 text-[11px] text-[#8492ac]">
                                {fmtDay(unit.soldAtKey)}{unit.billNumber ? ` · ${unit.billNumber}` : ""}
                              </p>
                              {unit.sellingPrice > 0 && <p className="mt-0.5 text-[11px] text-[#8492ac]">{inr(unit.sellingPrice)}</p>}
                            </>
                          ) : <span className="text-[12px] text-[#8492ac]">—</span>}
                        </td>
                        <td data-label="Warranty" className="px-5 py-3 align-top"><WarrantyCell unit={unit} /></td>
                        <td data-label="Actions" className="px-5 py-3 align-top">
                          <div className="flex flex-wrap items-center justify-end gap-2 lg:mouse:gap-1.5">
                            {unit.canSell && (
                              <Button variant="outline" className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold" disabled={billMut.isPending} onClick={() => billMut.mutate(unit)}>
                                <CheckCircle2 size={13} /> {t("workflow.register.createBill")}
                              </Button>
                            )}
                            {unit.canSell && (
                              <Button variant="ghost" className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold text-[#536583]" onClick={() => setRecording(unit)}>
                                <ClipboardCheck size={13} /> {t("workflow.electronics.sold.action")}
                              </Button>
                            )}
                            {unit.status === "sold" && (
                              <Button variant="outline" className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] border-violet-200 px-2.5 text-[11.5px] font-bold text-violet-700 hover:bg-violet-50" disabled={returnMut.isPending} onClick={() => unit.billId ? navigate(`/bills/${unit.billId}`) : returnMut.mutate(unit.id)}>
                                <Undo2 size={13} /> Take back
                              </Button>
                            )}
                            {unit.status === "rma" ? (
                              <Button variant="outline" className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold" disabled={serviceBackMut.isPending} onClick={() => serviceBackMut.mutate(unit.id)}>
                                <BadgeCheck size={13} /> Back
                              </Button>
                            ) : unit.isHeld && (
                              <button onClick={() => serviceMut.mutate(unit.id)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Send ${unit.productName} to service`}><Wrench size={14} /></button>
                            )}
                            {unit.isHeld && (
                              <button onClick={() => writeOffMut.mutate(unit.id)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Mark ${unit.productName} lost`}><X size={15} /></button>
                            )}
                            <button onClick={() => setDeleting(unit)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Delete ${unit.productName}`}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ReceiveUnitsPanel
        key={registration.scope}
        open={panelOpen}
        saving={registration.pending || receiveMut.isPending}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => setPanelOpen(false)}
        onSubmit={(data) => receiveMut.mutate(data)}
      />

      <RecordSaleDialog
        key={saleDraft.scope}
        unit={recording}
        saving={saleDraft.pending || recordMut.isPending}
        onClose={() => setRecording(null)}
        onConfirm={(sale) => recording && recordMut.mutate({ id: recording.id, ...sale })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this unit?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            {deleting?.productName} ({deleting?.imei || deleting?.serialNumber}) will move to the recycle bin.
            {deleting?.status === "sold" ? " It has been sold — deleting it loses the record of who has it and what cover they hold." : ""}
          </p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>
              {deleteMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The answer to "what is this handset?", shown right under the scan box. */
function LookupCard({ unit }: { unit: ProductUnit }) {
  const chip = STATUS_CHIP[unit.status] ?? STATUS_CHIP.in_stock;
  return (
    <div className="mt-3 rounded-[12px] border border-[#e7edf7] bg-[#f7f9fd] px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-black text-[var(--brand-ink)]">{unit.productName}</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-[#52627e]">
            {unit.imei ? `IMEI ${unit.imei}` : ""}{unit.imei && unit.serialNumber ? " · " : ""}{unit.serialNumber ? `S/N ${unit.serialNumber}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES[chip.tone])}>{chip.label}</span>
          {unit.condition !== "new" && (
            <span className="rounded-[7px] bg-[#eef2f8] px-2 py-[3px] text-[11px] font-bold text-[#52627e]">{CONDITION_LABEL.get(unit.condition)}</span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Fact label="Sold on" value={unit.soldAt ? fmtDay(unit.soldAtKey) : "Not sold yet"} />
        <Fact label="Sold to" value={unit.soldAt ? (unit.customerName || "Not recorded") : "—"} sub={unit.customerPhone || undefined} />
        <Fact label="Bill" value={unit.billNumber || (unit.soldAt ? "Not linked" : "—")} />
      </div>

      <div className="mt-3 border-t border-[#e2e8f0] pt-3"><WarrantyCell unit={unit} large /></div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8492ac]">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-[var(--brand-ink)]">{value}</p>
      {sub && <p className="truncate text-[11px] text-[#8492ac]">{sub}</p>}
    </div>
  );
}

function WarrantyCell({ unit, large = false }: { unit: ProductUnit; large?: boolean }) {
  const size = large ? "text-[13px]" : "text-[12px]";
  if (!unit.soldAt) {
    return (
      <p className={cn(size, "text-[#8492ac]")}>
        {unit.warrantyMonths > 0 ? `${unit.warrantyMonths} months once sold` : "No cover"}
      </p>
    );
  }
  if (!unit.warrantyUntilKey) return <p className={cn(size, "text-[#8492ac]")}>No cover</p>;

  const days = unit.warrantyDaysLeft ?? 0;
  if (!unit.isUnderWarranty) {
    return (
      <div className="flex items-center gap-1.5">
        <ShieldAlert size={large ? 16 : 13} className="shrink-0 text-rose-500" />
        <span className={cn(size, "font-semibold text-rose-600")}>Cover ended {fmtDay(unit.warrantyUntilKey)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <ShieldCheck size={large ? 16 : 13} className={cn("shrink-0", unit.isWarrantyExpiringSoon ? "text-amber-500" : "text-emerald-600")} />
      <span className={cn(size, "font-semibold", unit.isWarrantyExpiringSoon ? "text-amber-700" : "text-emerald-700")}>
        In warranty to {fmtDay(unit.warrantyUntilKey)}
        <span className="ml-1 font-normal text-[#64748b]">({days} day{days === 1 ? "" : "s"} left)</span>
      </span>
    </div>
  );
}

/**
 * Catching the register up with a handset that already went out.
 *
 * Selling a unit is "Create bill": the bill reserves the serial and records the
 * sale itself. This is for the bill that was saved without one — the till was
 * offline, or the box had not been scanned — so the register can still say who
 * has that IMEI and when its cover began. It records; it does not bill, move
 * stock or take money, and the sale date can be set back to the day of the bill
 * so the warranty runs from when the customer actually took it home.
 */
export function RecordSaleDialog({ unit, saving, onClose, onConfirm }: {
  unit: ProductUnit | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (sale: { billNumber: string; soldOn: string; customerName: string; customerPhone: string; sellingPrice: number }) => void;
}) {
  const { t } = useAppLanguage();
  const draft = useCounterDraft(unitSaleDraft);
  const { billNumber, soldOn, customerName, customerPhone, sellingPrice } = draft.value;
  // Each label is tied to its field, so a screen reader names the box that has
  // focus. The bill number had no name at all; the others were read out as
  // their placeholder or their current value.
  const fieldId = useId();

  return (
    <Dialog open={unit !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">{t("workflow.electronics.sold.title")}</DialogTitle></DialogHeader>
        {unit && (
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <DialogDescription className="text-[12px] leading-5 text-[#6d7c98]">{t("workflow.electronics.sold.hint")}</DialogDescription>
            <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5 text-[12px] text-[#52627e]">
              <p className="font-bold text-[var(--brand-ink)]">{unit.productName}</p>
              <p className="mt-0.5 font-mono text-[11px]">{unit.imei || unit.serialNumber}</p>
              <p className="mt-1">
                {unit.warrantyMonths > 0 ? t("workflow.electronics.sold.cover", { months: unit.warrantyMonths }) : t("workflow.electronics.sold.noCover")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${fieldId}-bill`} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("workflow.electronics.sold.billNumber")}</Label>
                <Input id={`${fieldId}-bill`} className="h-10" value={billNumber} onChange={(e) => draft.update({ billNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${fieldId}-date`} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("workflow.electronics.sold.soldOn")}</Label>
                <Input id={`${fieldId}-date`} className="h-10" type="date" max={todayKey()} value={soldOn} onChange={(e) => draft.update({ soldOn: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${fieldId}-buyer`} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("workflow.electronics.sold.buyer")}</Label>
                <Input id={`${fieldId}-buyer`} className="h-10" placeholder={t("workflow.electronics.sold.optional")} value={customerName} onChange={(e) => draft.update({ customerName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${fieldId}-mobile`} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("workflow.electronics.sold.mobile")}</Label>
                <Input id={`${fieldId}-mobile`} className="h-10" type="tel" inputMode="numeric" placeholder={t("workflow.electronics.sold.optional")} value={customerPhone} onChange={(e) => draft.update({ customerPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor={`${fieldId}-price`} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{t("workflow.electronics.sold.price")}</Label>
              <Input id={`${fieldId}-price`} className="h-10" type="number" min="0" step="0.01" value={sellingPrice} onChange={(e) => draft.update({ sellingPrice: e.target.value })} />
            </div>
            <div className="flex gap-2.5 pt-1">
              <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>{t("workflow.electronics.sold.cancel")}</Button>
              <Button
                type="button"
                className="h-11 flex-1 gap-2 rounded-[10px] bg-emerald-600 font-black text-white hover:bg-emerald-700"
                disabled={saving}
                onClick={() => onConfirm({ billNumber, soldOn, customerName, customerPhone, sellingPrice: Number(sellingPrice) || 0 })}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {t("workflow.electronics.sold.confirm")}
              </Button>
            </div>
          </fieldset>
        )}
      </DialogContent>
    </Dialog>
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
