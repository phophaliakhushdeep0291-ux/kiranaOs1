import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, PackageSearch, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { changeInventoryLotStatus, listInventoryLots, type InventoryLot } from "@/features/inventory/inventory-lots-api";
import { cn } from "@/lib/utils";

type Action = { lot: InventoryLot; status: "active" | "quarantined" | "recalled" };
const DAY = 86_400_000;

export default function InventoryLotsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["inventory-lots", status], queryFn: () => listInventoryLots({ status }) });
  const now = Date.now();
  const rows = useMemo(() => (query.data ?? []).filter((lot) => `${lot.product.name} ${lot.batchNumber} ${lot.location.name}`.toLowerCase().includes(search.trim().toLowerCase())), [query.data, search]);
  const metrics = useMemo(() => ({ active: (query.data ?? []).filter((lot) => lot.status === "active" && lot.availableBaseQty > 0 && new Date(lot.expiresOn).getTime() >= now).length, expiring: (query.data ?? []).filter((lot) => lot.status === "active" && new Date(lot.expiresOn).getTime() >= now && new Date(lot.expiresOn).getTime() - now <= 30 * DAY).length, blocked: (query.data ?? []).filter((lot) => ["quarantined", "recalled"].includes(lot.status)).length, units: (query.data ?? []).filter((lot) => lot.status === "active" && new Date(lot.expiresOn).getTime() >= now).reduce((sum, lot) => sum + lot.availableBaseQty, 0) }), [query.data, now]);

  async function confirm(pin: string) {
    if (!action) return;
    setBusy(true); setError("");
    try {
      await changeInventoryLotStatus(action.lot.id, action.status, action.status === "active" ? "Released after owner review" : `${action.status} by owner from expiry control`, pin);
      await queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      toast({ title: `Batch ${action.status}`, description: `${action.lot.product.name} · ${action.lot.batchNumber}` });
      setAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update batch."); }
    finally { setBusy(false); }
  }

  const metricCards: Array<[LucideIcon, string, string | number, string]> = [
      [PackageSearch, "Saleable batches", metrics.active, "text-blue-700 bg-blue-50"],
      [CalendarClock, "Expiring in 30 days", metrics.expiring, "text-amber-700 bg-amber-50"],
      [ShieldAlert, "Blocked batches", metrics.blocked, "text-rose-700 bg-rose-50"],
      [CheckCircle2, "Saleable base units", metrics.units.toLocaleString("en-IN"), "text-emerald-700 bg-emerald-50"],
  ];

  return <PageShell>
    <div className="mb-4"><h1 className="font-display text-2xl font-black text-[#102347]">Batch & expiry control</h1><p className="mt-1 text-sm text-[#64748b]">FEFO stock, expiry risk, quarantine, and recall control for every branch.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metricCards.map(([Icon, label, value, tone]) => <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm"><div className={cn("mb-3 grid h-9 w-9 place-items-center rounded-xl", tone)}><Icon size={17} /></div><p className="text-2xl font-black text-[#102347]">{value}</p><p className="text-xs font-semibold text-[#64748b]">{label}</p></div>)}</div>
    <div className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, batch, or branch" className="sm:max-w-sm" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="quarantined">Quarantined</option><option value="recalled">Recalled</option><option value="depleted">Depleted</option></select></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-[#f6f8fc] uppercase text-[#64748b]"><tr>{["Product / batch", "Branch", "Expiry", "Available", "Status", "Control"].map((head) => <th key={head} className="px-4 py-3">{head}</th>)}</tr></thead><tbody className="divide-y">{query.isLoading ? <tr><td colSpan={6} className="p-10 text-center text-[#64748b]">Loading batch ledger…</td></tr> : rows.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-[#64748b]">No batches match this view.</td></tr> : rows.map((lot) => { const days = Math.ceil((new Date(lot.expiresOn).getTime() - now) / DAY); const risky = days <= 30; return <tr key={lot.id}><td className="px-4 py-3"><p className="font-bold text-[#102347]">{lot.product.name}</p><p className="font-mono text-[11px] text-[#64748b]">{lot.batchNumber}</p></td><td className="px-4 py-3 font-semibold">{lot.location.name}</td><td className={cn("px-4 py-3 font-semibold", risky && "text-amber-700")}><p>{new Date(lot.expiresOn).toLocaleDateString("en-IN")}</p><p className="text-[10px]">{days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days} days left`}</p></td><td className="px-4 py-3 font-black">{lot.availableBaseQty} {lot.product.baseUnit}</td><td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 font-bold capitalize", lot.status === "active" ? "bg-emerald-50 text-emerald-700" : lot.status === "depleted" ? "bg-slate-100 text-slate-600" : "bg-rose-50 text-rose-700")}>{lot.status}</span></td><td className="px-4 py-3"><div className="flex gap-2">{lot.status === "active" ? <><Button size="sm" variant="outline" className="h-8 text-amber-700" onClick={() => setAction({ lot, status: "quarantined" })}>Quarantine</Button><Button size="sm" variant="outline" className="h-8 text-rose-700" onClick={() => setAction({ lot, status: "recalled" })}>Recall</Button></> : ["quarantined", "recalled"].includes(lot.status) ? <Button size="sm" variant="outline" className="h-8" onClick={() => setAction({ lot, status: "active" })}>Release</Button> : null}</div></td></tr>; })}</tbody></table></div></div>
    <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><p>Expired, quarantined, and recalled batches are excluded from checkout. When several batches are saleable, Veyra consumes the earliest expiry first.</p></div>
    <OwnerPinModal open={Boolean(action)} title={`${action?.status === "active" ? "Release" : action?.status === "recalled" ? "Recall" : "Quarantine"} ${action?.lot.batchNumber ?? "batch"}`} description="This changes saleability across every counter in the selected branch." confirmLabel="Confirm batch control" loading={busy} error={error} onCancel={() => setAction(null)} onConfirm={({ ownerPin }) => confirm(ownerPin)} />
  </PageShell>;
}
