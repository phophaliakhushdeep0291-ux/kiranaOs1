import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CircleDollarSign, Loader2, PackageOpen, Plus, RefreshCw,
  Search, Sparkles, Trash2, Trash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import { useListProducts } from "@/features/core/products/queries";
import {
  closeTester, deleteTester, getTesterCost, getTesterSummary, listTesters, openTester,
} from "@/features/verticals/beauty-cosmetics/testers/api";
import type { OpenTesterInput, TesterUnit } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDay(key?: string | null) {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "in_use", label: "On the counter" },
  { key: "replaced", label: "Replaced" },
  { key: "discarded", label: "Discarded" },
  { key: "all", label: "Everything" },
];

export default function TestersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();

  const [filter, setFilter] = useState("in_use");
  const [search, setSearch] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState<TesterUnit | null>(null);
  const [showCost, setShowCost] = useState(false);

  const testersQ = useQuery({ queryKey: ["testers"], queryFn: () => listTesters() });
  const summaryQ = useQuery({ queryKey: ["testers", "summary"], queryFn: getTesterSummary });
  const costQ = useQuery({ queryKey: ["testers", "cost"], queryFn: () => getTesterCost(), enabled: showCost });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["testers"] });
    // Opening a tester takes the unit out of sellable stock, so the shelf moved.
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) {
        return toast({
          title: "You're offline",
          description: "Opening a tester moves real stock, so it needs a connection — recorded offline it would decrement the shelf twice or not at all.",
          variant: "destructive",
        });
      }
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    };
  }

  const openMut = useMutation({
    mutationFn: (data: OpenTesterInput) => openTester(data),
    onSuccess: (tester) => {
      invalidate();
      setOpening(false);
      toast({
        title: `${tester.productName} tester opened`,
        description: tester.stockLedgerId ? "One unit taken out of sellable stock." : "Recorded without moving stock.",
      });
    },
    onError: failure("Could not open the tester"),
  });

  const closeMut = useMutation({
    mutationFn: (vars: { id: string; status: "replaced" | "discarded" }) => closeTester(vars.id, vars.status),
    onSuccess: (tester) => {
      invalidate();
      toast({
        title: tester.status === "replaced" ? "Marked replaced" : "Marked discarded",
        description: tester.status === "replaced" ? "Open the new one to keep counting what testers cost." : undefined,
      });
    },
    onError: failure("Could not update"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTester(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Tester record moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const testers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (testersQ.data ?? [])
      .filter((tester) => (filter === "all" ? true : tester.status === filter))
      .filter((tester) => (!dueOnly || tester.isDue || tester.isDueSoon))
      .filter((tester) => (!term
        || tester.productName.toLowerCase().includes(term)
        || (tester.variant ?? "").toLowerCase().includes(term)));
  }, [testersQ.data, filter, search, dueOnly]);

  const summary = summaryQ.data;

  return (
    <div className="app-docked-page">
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the testers last saved on this device. Opening one moves real stock, so it needs a connection.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Sparkles size={16} />} label="Testers on the counter" value={String(summary?.openTesters ?? 0)} tone="violet" />
          <Kpi
            icon={<AlertTriangle size={16} />}
            label="Need replacing"
            value={String(summary?.dueNow ?? 0)}
            tone={summary?.dueNow ? "rose" : "green"}
          />
          <Kpi icon={<PackageOpen size={16} />} label="Value on the counter" value={inr(summary?.valueOnCounter ?? 0)} tone="blue" />
          <Kpi icon={<CircleDollarSign size={16} />} label="Testers cost this month" value={inr(summary?.costThisMonth ?? 0)} tone="green" />
        </div>

        <button
          onClick={() => setShowCost(true)}
          className="flex w-full items-center gap-3 rounded-[12px] border border-[#e6ecf4] bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(15,35,80,0.04)] transition-colors hover:bg-[#f7f9fd]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><CircleDollarSign size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-[var(--brand-ink)]">What are testers costing you?</span>
            <span className="block text-[11.5px] text-[#64748b]">
              A counter full of shades is real money in stock that will never be sold. Tap to see which shades are eating it.
            </span>
          </span>
        </button>

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Tester register</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">
                Opening a tester takes the unit out of sellable stock, so the shelf count stays honest.
              </p>
            </div>
            <Button
              onClick={() => setOpening(true)}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 lg:mouse:h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95"
            >
              <Plus size={15} /> Open a Tester
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
              <button
                onClick={() => setDueOnly((value) => !value)}
                className={cn(
                  "inline-flex h-11 items-center rounded-[8px] px-3 text-[11.5px] font-bold transition-colors lg:mouse:h-auto lg:mouse:px-2.5 lg:mouse:py-1.5",
                  dueOnly ? "bg-rose-600 text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                )}
              >
                Due only
              </button>
            </div>
            <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[260px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-9 pl-8" placeholder="Product or shade" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {testersQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : testersQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load the register. Check your connection.</div>
          ) : testers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Sparkles size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">
                {(testersQ.data ?? []).length === 0 ? "No testers recorded yet" : "Nothing matches this filter"}
              </p>
              <p className="max-w-[440px] text-[12px] text-[#64748b]">
                {(testersQ.data ?? []).length === 0
                  ? "Record each tester as you open it. The unit comes out of sellable stock, so your shelf count stops lying — and for the first time you can see what testers cost."
                  : "Try another status, or turn off \"Due only\"."}
              </p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Tester</th>
                    <th className="px-5 py-2.5 text-left font-bold">Opened</th>
                    <th className="px-5 py-2.5 text-left font-bold">Replace by</th>
                    <th className="px-5 py-2.5 text-right font-bold">Cost</th>
                    <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {testers.map((tester, i) => (
                    <tr key={tester.id} className={i < testers.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                      <td className="px-5 py-3 align-top">
                        <p className="font-bold text-[var(--brand-ink)]">{tester.productName}</p>
                        {tester.variant && <p className="mt-0.5 text-[11.5px] text-[#52627e]">{tester.variant}</p>}
                        {!tester.stockLedgerId && (
                          <p className="mt-0.5 text-[10.5px] text-amber-700">recorded without moving stock</p>
                        )}
                      </td>
                      <td className="px-5 py-3 align-top">
                        <p className="text-[12px] text-[#344668]">{fmtDay(tester.openedOnKey)}</p>
                        <p className="mt-0.5 text-[11px] text-[#8492ac]">{tester.ageDays} day{tester.ageDays === 1 ? "" : "s"} ago</p>
                      </td>
                      <td className="px-5 py-3 align-top">
                        {!tester.isOpen ? (
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.gray)}>
                            {tester.status === "replaced" ? "Replaced" : "Discarded"} {fmtDay(tester.closedOnKey)}
                          </span>
                        ) : tester.isDue ? (
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.red)}>
                            Overdue by {Math.abs(tester.daysLeft ?? 0)}d
                          </span>
                        ) : tester.isDueSoon ? (
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.amber)}>
                            {tester.daysLeft}d left
                          </span>
                        ) : (
                          <span className="text-[12px] text-[#52627e]">{fmtDay(tester.dueOnKey)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right align-top">
                        <span className="text-[12.5px] font-semibold text-[var(--brand-ink)]">{inr(tester.costValue)}</span>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <div className="flex flex-wrap items-center justify-end gap-2 lg:mouse:gap-1.5">
                          {tester.isOpen && (
                            <>
                              <Button
                                variant="outline"
                                className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold"
                                disabled={closeMut.isPending}
                                onClick={() => closeMut.mutate({ id: tester.id, status: "replaced" })}
                              >
                                <RefreshCw size={13} /> Replaced
                              </Button>
                              <button
                                onClick={() => closeMut.mutate({ id: tester.id, status: "discarded" })}
                                className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]"
                                aria-label={`Discard the ${tester.productName} tester`}
                              >
                                <Trash size={14} />
                              </button>
                            </>
                          )}
                          <button onClick={() => setDeleting(tester)} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Delete the ${tester.productName} tester record`}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <OpenTesterDialog
        open={opening}
        saving={openMut.isPending}
        onClose={() => setOpening(false)}
        onSubmit={(data) => openMut.mutate(data)}
      />

      <Dialog open={showCost} onOpenChange={setShowCost}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">What testers cost</DialogTitle></DialogHeader>
          {costQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Adding it up…</div>
          ) : (costQ.data?.byProduct ?? []).length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[#64748b]">Nothing recorded yet.</p>
          ) : (
            <>
              <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
                <p className="text-[12px] text-[#52627e]">
                  <span className="font-display text-[18px] font-black text-[var(--brand-ink)]">{inr(costQ.data?.totalCost ?? 0)}</span>
                  {" "}across {costQ.data?.totalOpened ?? 0} tester{(costQ.data?.totalOpened ?? 0) === 1 ? "" : "s"} — stock that was never going to be sold.
                </p>
              </div>
              <ul className="max-h-[320px] space-y-1.5 overflow-y-auto">
                {(costQ.data?.byProduct ?? []).map((row) => (
                  <li key={row.productId} className="flex items-baseline justify-between gap-2 rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{row.productName}</span>
                      <span className="text-[11px] text-[#8492ac]">{row.opened} opened</span>
                    </span>
                    <span className="text-[12.5px] font-black text-[var(--brand-ink)]">{inr(row.cost)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this tester record?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            The record for {deleting?.productName}{deleting?.variant ? ` (${deleting.variant})` : ""} moves to the recycle bin.
            {deleting?.stockLedgerId
              ? " The unit it took out of stock stays out — deleting the record does not put it back, and reversing that invisibly would be worse."
              : ""}
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

function OpenTesterDialog({ open, saving, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: OpenTesterInput) => void;
}) {
  const [productId, setProductId] = useState("");
  const [pick, setPick] = useState("");
  const [variant, setVariant] = useState("");
  const [expectedDays, setExpectedDays] = useState("90");
  const [moveStock, setMoveStock] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];
  const chosen = catalogue.find((product) => product.id === productId) ?? null;

  const matches = useMemo(() => {
    const term = pick.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) => product.name.toLowerCase().includes(term) || (product.brand ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, pick]);

  function reset() {
    setProductId(""); setPick(""); setVariant(""); setExpectedDays("90");
    setMoveStock(true); setNotes(""); setError(null);
  }

  function submit() {
    if (!productId) return setError("Choose which product this tester is.");
    setError(null);
    onSubmit({
      productId,
      variant: variant.trim() || null,
      expectedDays: Number(expectedDays) || 90,
      moveStock,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Open a tester</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {chosen ? (
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[#e7edf7] bg-[#f7f9fd] px-3.5 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Sparkles size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{chosen.name}</p>
                <p className="truncate text-[11px] text-[#8492ac]">
                  {chosen.stockBaseQty ?? 0} in stock · costs {inr(Number(chosen.costPerRateUnit) || 0)}
                </p>
              </div>
              <button type="button" className="text-[11.5px] font-bold text-[var(--brand)] hover:underline" onClick={() => { setProductId(""); setPick(""); }}>Change</button>
            </div>
          ) : (
            <div className="relative">
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Which product *</Label>
              <Search size={14} className="pointer-events-none absolute left-3 top-[34px] text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-10 pl-8" placeholder="Search your stock…" value={pick} onChange={(e) => setPick(e.target.value)} />
              {pick.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[200px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                  {matches.length === 0 ? (
                    <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">Nothing matches. Add the product to your catalogue first.</p>
                  ) : (
                    <ul className="divide-y divide-[#eef2f8]">
                      {matches.map((product) => (
                        <li key={product.id}>
                          <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]" onClick={() => { setProductId(product.id); setPick(""); }}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                              <span className="block truncate text-[11px] text-[#8492ac]">{product.stockBaseQty ?? 0} in stock</span>
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
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Shade</Label>
              <Input className="h-10" placeholder="Rose 05" value={variant} onChange={(e) => setVariant(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Lasts about (days)</Label>
              <Input className="h-10" type="number" min="1" max="730" value={expectedDays} onChange={(e) => setExpectedDays(e.target.value)} />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3">
            <input type="checkbox" className="mt-[3px] h-4 w-4 accent-[var(--brand)]" checked={moveStock} onChange={(e) => setMoveStock(e.target.checked)} />
            <span>
              <span className="block text-[12.5px] font-bold text-[var(--brand-ink)]">Take one out of stock now</span>
              <span className="mt-0.5 block text-[11px] text-[#8492ac]">
                Leave this on unless you already took the unit off the shelf by hand — otherwise it would come off twice.
              </span>
            </span>
          </label>

          <div>
            <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Notes (optional)</Label>
            <Textarea className="min-h-[54px] resize-y" placeholder="Where it sits, who opened it…" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Open
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ icon, label, value, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "blue" | "violet" | "green" | "rose";
}) {
  const ring =
    tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : tone === "violet" ? "bg-violet-50 text-violet-600"
        : tone === "rose" ? "bg-rose-50 text-rose-600"
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
