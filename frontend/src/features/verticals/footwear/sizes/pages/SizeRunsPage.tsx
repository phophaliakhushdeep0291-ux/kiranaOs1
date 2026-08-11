import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert, Footprints, Layers, Loader2, PackageX, Ruler, Search, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import { findBySize, listSizeRuns, getSizeRunSummary, setSizeProfile } from "@/features/verticals/footwear/sizes/api";
import type { ShoeSizeGender, ShoeSizeSystem, SizeLookup, SizeProfileInput, SizeRun } from "@/types/api";

const SYSTEMS: Array<{ key: ShoeSizeSystem; label: string }> = [
  { key: "uk", label: "UK / India" },
  { key: "us", label: "US" },
  { key: "eu", label: "EU" },
  { key: "cm", label: "CM" },
];

const GENDERS: Array<{ key: ShoeSizeGender; label: string }> = [
  { key: "unisex", label: "Unisex" },
  { key: "mens", label: "Men's" },
  { key: "womens", label: "Women's" },
  { key: "kids", label: "Kids" },
];

const SYSTEM_LABEL = new Map(SYSTEMS.map((s) => [s.key, s.label]));
const GENDER_LABEL = new Map(GENDERS.map((g) => [g.key, g.label]));

export default function SizeRunsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();

  const [search, setSearch] = useState("");
  const [onlyBroken, setOnlyBroken] = useState(false);
  const [askSystem, setAskSystem] = useState<ShoeSizeSystem>("uk");
  const [askGender, setAskGender] = useState<ShoeSizeGender>("unisex");
  const [askSize, setAskSize] = useState("");
  const [lookup, setLookup] = useState<SizeLookup | null>(null);
  const [profiling, setProfiling] = useState<SizeRun | null>(null);

  const runsQ = useQuery({ queryKey: ["size-runs"], queryFn: () => listSizeRuns() });
  const summaryQ = useQuery({ queryKey: ["size-runs", "summary"], queryFn: getSizeRunSummary });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["size-runs"] });

  const lookupMut = useMutation({
    mutationFn: () => findBySize(askSystem, askSize.trim(), askGender),
    onSuccess: setLookup,
    onError: (err: unknown) =>
      toast({ title: "Could not look that up", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
  });

  const profileMut = useMutation({
    mutationFn: (vars: { productId: string; data: SizeProfileInput }) => setSizeProfile(vars.productId, vars.data),
    onSuccess: () => { invalidate(); setProfiling(null); toast({ title: "Size system saved" }); },
    onError: (err: unknown) => {
      if (!isOnline) {
        return toast({ title: "You're offline", description: "Looking up sizes works offline; changing a style's size system needs a connection.", variant: "destructive" });
      }
      toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    },
  });

  const runs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (runsQ.data ?? [])
      .filter((run) => (!term || run.productName.toLowerCase().includes(term) || (run.brand ?? "").toLowerCase().includes(term)))
      .filter((run) => (!onlyBroken || run.isBroken || run.isEmpty));
  }, [runsQ.data, search, onlyBroken]);

  const summary = summaryQ.data;

  return (
    <div className="app-docked-page">
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Offline — size runs and lookups still work from this device's saved stock. Changing a style's size system needs a connection.
          </div>
        )}

        {/* ── The counter question ── */}
        <form
          className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]"
          onSubmit={(e) => { e.preventDefault(); if (askSize.trim()) lookupMut.mutate(); }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><Ruler size={16} /></span>
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">"Have you got this in an 8?"</h3>
              <p className="text-[11.5px] text-[#64748b]">Ask in whatever number the customer knows — the racks are searched in their own.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              className="h-11 lg:mouse:h-10 rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] font-semibold text-[#344668] outline-none focus:border-[var(--brand)]"
              value={askSystem}
              onChange={(e) => setAskSystem(e.target.value as ShoeSizeSystem)}
              aria-label="Size system"
            >
              {SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select
              className="h-11 lg:mouse:h-10 rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] font-semibold text-[#344668] outline-none focus:border-[var(--brand)]"
              value={askGender}
              onChange={(e) => setAskGender(e.target.value as ShoeSizeGender)}
              aria-label="Who it is for"
            >
              {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            <Input
              className="h-11 lg:mouse:h-10 w-[110px]"
              placeholder="Size"
              value={askSize}
              onChange={(e) => setAskSize(e.target.value)}
              aria-label="Size"
            />
            <Button
              type="submit"
              disabled={!askSize.trim() || lookupMut.isPending}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] px-5 font-black text-white hover:opacity-95"
            >
              {lookupMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find
            </Button>
            {lookup && (
              <Button type="button" variant="outline" className="h-11 lg:mouse:h-10 rounded-[10px] font-bold" onClick={() => { setLookup(null); setAskSize(""); }}>Clear</Button>
            )}
          </div>

          {askGender === "kids" && (
            <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-900">
              Children's sizing has no dependable chart across brands, so sizes are matched exactly and not converted.
            </p>
          )}

          {lookup && <LookupResult lookup={lookup} />}
        </form>

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Footprints size={16} />} label="Pairs on hand" value={String(summary?.totalPairs ?? 0)} tone="green" />
          <Kpi icon={<Layers size={16} />} label="Styles" value={String(summary?.styles ?? 0)} tone="blue" />
          <Kpi icon={<CircleAlert size={16} />} label="Runs with gaps" value={String(summary?.brokenRuns ?? 0)} tone={summary?.brokenRuns ? "amber" : "green"} />
          <Kpi icon={<PackageX size={16} />} label="Sold out styles" value={String(summary?.emptyRuns ?? 0)} tone={summary?.emptyRuns ? "rose" : "green"} />
        </div>

        {summary && summary.unprofiledStyles > 0 && (
          <div className="rounded-[12px] border border-[#e6ecf4] bg-white px-4 py-3 text-[12px] text-[#52627e] shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <span className="font-bold text-[var(--brand-ink)]">{summary.unprofiledStyles} style{summary.unprofiledStyles === 1 ? "" : "s"}</span> {summary.unprofiledStyles === 1 ? "has" : "have"} no size system set, so {summary.unprofiledStyles === 1 ? "it is" : "they are"} read as UK numbering. That is right for Indian stock and wrong for imports — set it on any style below.
          </div>
        )}

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Size runs</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">
                {summary && summary.missingSizes > 0
                  ? `${summary.missingSizes} size${summary.missingSizes === 1 ? "" : "s"} you cannot sell today.`
                  : "Every style with a size grid, and what is left of each run."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setOnlyBroken((value) => !value)}
                className={cn(
                  "inline-flex h-11 items-center rounded-[8px] px-3 text-[11.5px] font-bold transition-colors lg:mouse:h-auto lg:mouse:px-2.5 lg:mouse:py-1.5",
                  onlyBroken ? "bg-[var(--brand)] text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                )}
              >
                Needs attention
              </button>
              <div className="relative min-w-[180px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <Input className="h-11 lg:mouse:h-9 pl-8" placeholder="Style or brand" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          {runsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : runsQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load size runs. Check your connection.</div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Footprints size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">
                {(runsQ.data ?? []).length === 0 ? "No styles with a size grid yet" : "Nothing matches this filter"}
              </p>
              <p className="max-w-[440px] text-[12px] text-[#64748b]">
                {(runsQ.data ?? []).length === 0
                  ? "Give a style a \"Size\" variant axis on the product screen — one row per size, each holding its own pairs — and its run appears here."
                  : "Try another search, or turn off \"Needs attention\"."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#eef2f8]">
              {runs.map((run) => <RunRow key={run.productId} run={run} onProfile={() => setProfiling(run)} />)}
            </div>
          )}
        </div>
      </div>

      <ProfileDialog
        run={profiling}
        saving={profileMut.isPending}
        onClose={() => setProfiling(null)}
        onSubmit={(data) => profiling && profileMut.mutate({ productId: profiling.productId, data })}
      />
    </div>
  );
}

function LookupResult({ lookup }: { lookup: SizeLookup }) {
  const { equivalents, matches, asked } = lookup;
  return (
    <div className="mt-3 rounded-[12px] border border-[#e7edf7] bg-[#f7f9fd] px-4 py-3.5">
      {equivalents ? (
        <div className="flex flex-wrap items-center gap-2 lg:mouse:gap-1.5">
          <span className="text-[11.5px] font-semibold text-[#64748b]">Same shoe:</span>
          {SYSTEMS.map((system) => (
            <span
              key={system.key}
              className={cn(
                "rounded-[7px] px-2 py-[3px] text-[11.5px] font-bold",
                system.key === asked.system ? "bg-[var(--brand)] text-white" : "bg-white text-[#52627e]",
              )}
            >
              {system.label} {equivalents[system.key]}
            </span>
          ))}
          <span className="text-[11px] text-[#8492ac]">· indicative, varies by brand</span>
        </div>
      ) : (
        <p className="text-[12px] text-[#64748b]">
          {asked.value} is not on the {SYSTEM_LABEL.get(asked.system)} chart for {GENDER_LABEL.get(asked.gender)?.toLowerCase()},
          so styles are matched on that exact number rather than converted.
        </p>
      )}

      <div className="mt-3 border-t border-[#e2e8f0] pt-3">
        {matches.length === 0 ? (
          <p className="text-[12.5px] font-semibold text-[#52627e]">Nothing in that size is in stock right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {matches.map((match) => (
              <li key={match.productId} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{match.productName}</span>
                {match.colours.length > 0 && (
                  <span className="text-[11px] text-[#8492ac]">{match.colours.join(", ")}</span>
                )}
                <span className="rounded-[6px] bg-white px-1.5 py-0.5 text-[10.5px] font-bold text-[#52627e]">
                  {SYSTEM_LABEL.get(match.sizeSystem)} {match.sizeInStyleSystem}
                </span>
                <span className="text-[12.5px] font-black text-emerald-700">{match.pairs} pair{match.pairs === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunRow({ run, onProfile }: { run: SizeRun; onProfile: () => void }) {
  // Colour-blind readers cannot rely on red/green alone, so a gap also shows a
  // dash where the count would be and the row states the shortfall in words.
  const byColour = useMemo(() => {
    const groups = new Map<string, SizeRun["cells"]>();
    for (const cell of run.cells) {
      const key = cell.colour ?? "";
      groups.set(key, [...(groups.get(key) ?? []), cell]);
    }
    return [...groups.entries()];
  }, [run.cells]);

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-[var(--brand-ink)]">{run.productName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8492ac]">
            {run.brand && <span>{run.brand}</span>}
            <span className="rounded-[6px] bg-[#f1f5fa] px-1.5 py-0.5 font-bold text-[#52627e]">
              {SYSTEM_LABEL.get(run.sizeSystem)} · {GENDER_LABEL.get(run.gender)}
            </span>
            {!run.isProfiled && <span className="text-amber-700">assumed</span>}
            {run.widthFit && <span>width {run.widthFit}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run.isEmpty ? (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.red)}>Sold out</span>
          ) : run.isBroken ? (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.amber)}>
              {run.gaps.length} size{run.gaps.length === 1 ? "" : "s"} missing
            </span>
          ) : (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.green)}>Full run</span>
          )}
          <span className="text-[12px] font-semibold text-[#52627e]">{run.totalPairs} pairs</span>
          <button onClick={onProfile} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Set size system for ${run.productName}`}>
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {byColour.map(([colour, cells]) => (
          <div key={colour || "default"} className="flex flex-wrap items-center gap-2 lg:mouse:gap-1.5">
            {colour && <span className="w-[70px] shrink-0 truncate text-[11px] font-semibold text-[#64748b]">{colour}</span>}
            <div className="flex flex-wrap gap-1">
              {cells.map((cell) => (
                <span
                  key={`${cell.size}-${cell.colour ?? ""}`}
                  title={cell.equivalents
                    ? `UK ${cell.equivalents.uk} · US ${cell.equivalents.us} · EU ${cell.equivalents.eu} · ${cell.equivalents.cm} cm`
                    : `${cell.size} — not on the chart`}
                  className={cn(
                    "min-w-[42px] rounded-[7px] px-1.5 py-1 text-center text-[11px] font-bold",
                    cell.inStock ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-400",
                  )}
                >
                  <span className="block">{cell.size}</span>
                  <span className="block text-[10px] font-semibold opacity-80">{cell.inStock ? cell.pairs : "—"}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileDialog({ run, saving, onClose, onSubmit }: {
  run: SizeRun | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: SizeProfileInput) => void;
}) {
  const [sizeSystem, setSizeSystem] = useState<ShoeSizeSystem>("uk");
  const [gender, setGender] = useState<ShoeSizeGender>("unisex");
  const [widthFit, setWidthFit] = useState("");

  return (
    <Dialog
      open={run !== null}
      onOpenChange={(open) => {
        if (open) return;
        setSizeSystem("uk"); setGender("unisex"); setWidthFit("");
        onClose();
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Which sizing is this style in?</DialogTitle></DialogHeader>
        {run && (
          <div className="space-y-3">
            <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5 text-[12px] text-[#52627e]">
              <p className="font-bold text-[var(--brand-ink)]">{run.productName}</p>
              <p className="mt-0.5">Sizes on this style: {run.sizes.join(", ")}</p>
            </div>
            <p className="text-[11.5px] text-[#8492ac]">
              The numbers on a shoe mean nothing without the scale — a UK 8 and an EU 8 are different shoes. Setting this is what lets a customer's own number find your stock.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Size system</Label>
                <select
                  className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  value={sizeSystem}
                  onChange={(e) => setSizeSystem(e.target.value as ShoeSizeSystem)}
                >
                  {SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Worn by</Label>
                <select
                  className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as ShoeSizeGender)}
                >
                  {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Width fitting (optional)</Label>
              <Input className="h-10" placeholder="D, 2E, Narrow…" value={widthFit} onChange={(e) => setWidthFit(e.target.value)} />
            </div>
            {gender === "kids" && (
              <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-900">
                Kids sizes will not be converted between systems — the charts vary too much between brands to be trusted.
              </p>
            )}
            <div className="flex gap-2.5 pt-1">
              <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
              <Button
                className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
                style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
                disabled={saving}
                onClick={() => onSubmit({ sizeSystem, gender, widthFit: widthFit.trim() || null })}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Ruler size={15} />} Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ icon, label, value, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "rose";
}) {
  const ring =
    tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : tone === "amber" ? "bg-amber-50 text-amber-600"
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
