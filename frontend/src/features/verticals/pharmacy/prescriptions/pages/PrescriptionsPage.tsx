import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, CheckCircle2, ClipboardList, FileWarning, HandCoins, Loader2,
  Pencil, Phone, Plus, RefreshCw, Search, Stethoscope, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import {
  cancelPrescription, createPrescription, deletePrescription, dispensePrescription,
  getPrescriptionSummary, listPrescriptions, updatePrescription,
} from "@/features/verticals/pharmacy/prescriptions/api";
import { PrescriptionPanel, SCHEDULES } from "@/features/verticals/pharmacy/prescriptions/components/PrescriptionPanel";
import type { Prescription, PrescriptionInput, PrescriptionStatus } from "@/types/api";

function fmtDay(key?: string | null) {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

const STATUS_CHIP: Record<PrescriptionStatus, { label: string; tone: keyof typeof CHIP_TONES }> = {
  pending: { label: "To dispense", tone: "blue" },
  dispensed: { label: "Dispensed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

const SCHEDULE_LABEL = new Map(SCHEDULES.map((entry) => [entry.key, entry.label]));

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "To dispense" },
  { key: "dispensed", label: "Dispensed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "Whole register" },
];

export default function PrescriptionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [filter, setFilter] = useState("pending");
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Prescription | null>(null);
  const [deleting, setDeleting] = useState<Prescription | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:prescriptions-panel-width", { defaultWidth: 500 });

  const listQ = useQuery({ queryKey: ["prescriptions"], queryFn: () => listPrescriptions() });
  const summaryQ = useQuery({ queryKey: ["prescriptions", "summary"], queryFn: getPrescriptionSummary });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["prescriptions"] });

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) {
        return toast({
          title: "You're offline",
          description: "The register needs a connection so entry numbers stay unique across counters. Reconnect and try again — your typed details stay in the form.",
          variant: "destructive",
        });
      }
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    };
  }

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: PrescriptionInput }) => (vars.id ? updatePrescription(vars.id, vars.data) : createPrescription(vars.data)),
    onSuccess: (prescription) => {
      invalidate();
      setPanelOpen(false);
      setEditing(null);
      toast({ title: editing ? `${prescription.registerNumber} corrected` : `Recorded as ${prescription.registerNumber}` });
    },
    onError: failure("Could not save the entry"),
  });

  const dispenseMut = useMutation({
    mutationFn: (id: string) => dispensePrescription(id),
    onSuccess: (prescription) => {
      invalidate();
      toast({
        title: prescription.refillsUsed > 0 ? "Repeat dispensed" : "Dispensed",
        description: prescription.refillsLeft > 0 ? `${prescription.refillsLeft} repeat${prescription.refillsLeft === 1 ? "" : "s"} left on this prescription.` : undefined,
      });
    },
    onError: failure("Could not dispense"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelPrescription(id),
    onSuccess: () => { invalidate(); toast({ title: "Entry cancelled" }); },
    onError: failure("Could not cancel"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePrescription(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Entry moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const all = listQ.data ?? [];
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((row) => (filter === "all" ? true : row.status === filter))
      .filter((row) => (scheduleFilter === "all" ? true : row.scheduleType === scheduleFilter))
      .filter((row) => {
        if (!term) return true;
        return [row.patientName, row.patientPhone, row.doctorName, row.registerNumber, row.billNumber ?? "", ...row.items.map((i) => i.name)]
          .join(" ").toLowerCase().includes(term);
      });
  }, [all, filter, scheduleFilter, search]);

  const summary = summaryQ.data;

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the last register entries saved on this device. Recording and dispensing need a connection, so two counters can never write the same entry number.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<ClipboardList size={16} />} label="Waiting to dispense" value={String(summary?.pending ?? 0)} tone="blue" />
          <Kpi icon={<CheckCircle2 size={16} />} label="Dispensed today" value={String(summary?.dispensedToday ?? 0)} tone="green" />
          <Kpi icon={<HandCoins size={16} />} label="Repeats available" value={String(summary?.refillable ?? 0)} tone="violet" />
          <Kpi
            icon={<FileWarning size={16} />}
            label={`Older than ${summary?.staleAfterDays ?? 90} days`}
            value={String(summary?.stale ?? 0)}
            tone={summary?.stale ? "rose" : "green"}
          />
        </div>

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Prescription register</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">
                {summary
                  ? `${summary.regulatedThisMonth} Schedule H/H1/X ${summary.regulatedThisMonth === 1 ? "entry" : "entries"} this month, out of ${summary.thisMonth} recorded.`
                  : "Every Schedule H, H1 and X sale, as an inspection would read it."}
              </p>
            </div>
            <Button
              onClick={() => { setEditing(null); setPanelOpen(true); }}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95"
            >
              <Plus size={15} /> Record Prescription
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-bold transition-colors",
                    filter === f.key ? "bg-[var(--brand)] text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <select
              className="h-9 rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[12px] font-semibold text-[#344668] outline-none focus:border-[var(--brand)]"
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              aria-label="Filter by schedule"
            >
              <option value="all">Every schedule</option>
              {SCHEDULES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                className="h-9 pl-8"
                placeholder="Patient, doctor, entry no."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {listQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : listQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load the register. Check your connection.</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Stethoscope size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">{all.length === 0 ? "The register is empty" : "Nothing matches this filter"}</p>
              <p className="max-w-[400px] text-[12px] text-[#64748b]">
                {all.length === 0
                  ? "Record a prescription each time you dispense a Schedule H, H1 or X medicine — the doctor, the patient, and what went out."
                  : "Try another status, another schedule, or clear the search."}
              </p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Patient</th>
                    <th className="px-5 py-2.5 text-left font-bold">Prescribed by</th>
                    <th className="px-5 py-2.5 text-left font-bold">Medicines</th>
                    <th className="px-5 py-2.5 text-left font-bold">Status</th>
                    <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry, i) => {
                    const chip = STATUS_CHIP[entry.status] ?? STATUS_CHIP.pending;
                    const open = entry.status !== "cancelled";
                    return (
                      <tr key={entry.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                        <td className="px-5 py-3 align-top">
                          <p className="font-bold text-[var(--brand-ink)]">{entry.patientName}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#52627e]">
                            <Phone size={11} /> {entry.patientPhone || "—"}
                            {entry.patientAge ? ` · ${entry.patientAge}` : ""}
                          </p>
                          <span className="mt-1 inline-block rounded-[5px] bg-[#f1f5fa] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#52627e]">{entry.registerNumber}</span>
                          {entry.billNumber && (
                            <span className="ml-1 mt-1 inline-block rounded-[5px] bg-[#f1f5fa] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#52627e]">{entry.billNumber}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <p className="font-semibold text-[var(--brand-ink)]">{entry.doctorName}</p>
                          {entry.doctorRegNo && <p className="mt-0.5 text-[11px] text-[#8492ac]">Reg. {entry.doctorRegNo}</p>}
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#8492ac]">
                            <CalendarClock size={11} /> {fmtDay(entry.prescribedOnKey)}
                          </p>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <ul className="space-y-0.5">
                            {entry.items.map((item, idx) => (
                              <li key={item.id ?? idx} className="text-[12px] text-[#344668]">
                                <span className="font-semibold">{item.qty}</span> × {item.name}
                                {item.strength ? ` ${item.strength}` : ""}
                                {item.dosage && <span className="text-[#8492ac]"> · {item.dosage}</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES[chip.tone])}>{chip.label}</span>
                          {entry.isRegulated && (
                            <span className={cn("mt-1 block w-fit rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.violet)}>
                              {SCHEDULE_LABEL.get(entry.scheduleType) ?? entry.scheduleType}
                            </span>
                          )}
                          {entry.isStale && (
                            <span className={cn("mt-1 block w-fit rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.red)}>
                              {entry.ageDays} days old
                            </span>
                          )}
                          {entry.refillsLeft > 0 && (
                            <span className="mt-1 block text-[11px] font-semibold text-[#52627e]">
                              {entry.refillsLeft} repeat{entry.refillsLeft === 1 ? "" : "s"} left
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {entry.canDispense && (
                              <Button
                                variant="outline"
                                className="h-8 gap-1.5 rounded-[8px] border-emerald-200 px-2.5 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50"
                                disabled={dispenseMut.isPending}
                                onClick={() => dispenseMut.mutate(entry.id)}
                              >
                                {entry.status === "dispensed" ? <><RefreshCw size={13} /> Repeat</> : <><CheckCircle2 size={13} /> Dispense</>}
                              </Button>
                            )}
                            {open && (
                              <button onClick={() => { setEditing(entry); setPanelOpen(true); }} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Correct ${entry.registerNumber}`}><Pencil size={14} /></button>
                            )}
                            {open && (
                              <button onClick={() => cancelMut.mutate(entry.id)} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Cancel ${entry.registerNumber}`}><X size={15} /></button>
                            )}
                            <button onClick={() => setDeleting(entry)} className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Delete ${entry.registerNumber}`}><Trash2 size={14} /></button>
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

      <PrescriptionPanel
        open={panelOpen}
        editing={editing}
        saving={saveMut.isPending}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => { setPanelOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this register entry?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            {deleting?.registerNumber} for {deleting?.patientName} will move to the recycle bin.
            {deleting?.isRegulated
              ? " This is a Schedule H/H1/X entry — the register is expected to account for it, so cancel it instead unless it was recorded by mistake."
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
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 truncate font-display text-[24px] font-black leading-none text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}
