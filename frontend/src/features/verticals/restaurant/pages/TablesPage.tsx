import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ChefHat, Clock, IndianRupee, LayoutGrid, Loader2, Pencil, Plus, Receipt,
  Trash2, Users, Utensils, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { offlineDB } from "@/lib/offline/db";
import { HELD_BILLS_KEY } from "@/features/core/billing/pages/open-bills";
import type { HeldBill } from "@/features/core/billing/pages/billing-types";
import {
  buildKotTicket, buildOccupancy, loadFloorPlan, loadKotTickets, loadTableBills,
  newTableId, reconcileTableBills, saveFloorPlan, saveKotTickets, saveTableBills,
  type KotTicket, type RestaurantTable, type TableOccupancy,
} from "../service/table-store";
import { openTableInBilling, releaseTable } from "../service/open-table";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function sinceLabel(iso: string | null): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 1) return "just seated";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const BLANK_TABLE = { name: "", section: "Dining", seats: "4" };

export default function TablesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [tableBills, setTableBills] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<KotTicket[]>([]);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState(BLANK_TABLE);
  const [formOpen, setFormOpen] = useState(false);
  const [releasing, setReleasing] = useState<TableOccupancy | null>(null);
  const [removing, setRemoving] = useState<RestaurantTable | null>(null);
  // Re-render on a timer so "seated 12m" ages without the waiter touching it.
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const [plan, heldRaw, mapRaw, kot] = await Promise.all([
      loadFloorPlan(),
      offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
      loadTableBills(),
      loadKotTickets(),
    ]);
    const held = Array.isArray(heldRaw) ? heldRaw : [];
    const map = reconcileTableBills(mapRaw, held);
    // A settled table drops out of the map here; persist so it stays freed.
    if (Object.keys(map).length !== Object.keys(mapRaw).length) void saveTableBills(map);
    setTables(plan);
    setHeldBills(held);
    setTableBills(map);
    setTickets(kot);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const occupancy = useMemo(
    () => buildOccupancy(tables, heldBills, tableBills, tickets),
    [tables, heldBills, tableBills, tickets],
  );

  const sections = useMemo(() => {
    const grouped = new Map<string, TableOccupancy[]>();
    for (const row of occupancy) {
      const key = row.table.section?.trim() || "Dining";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    return [...grouped.entries()];
  }, [occupancy]);

  const busy = occupancy.filter((row) => row.bill);
  const totals = {
    open: busy.length,
    free: occupancy.length - busy.length,
    running: busy.reduce((sum, row) => sum + row.runningTotal, 0),
    awaitingKitchen: occupancy.reduce((sum, row) => sum + row.pendingKotLines.length, 0),
  };

  async function seat(row: TableOccupancy) {
    await openTableInBilling(row.table);
    navigate("/billing");
  }

  async function sendToKitchen(row: TableOccupancy) {
    if (row.pendingKotLines.length === 0) return;
    const current = await loadKotTickets();
    const ticket = buildKotTicket(row.table, row.pendingKotLines, current);
    const next = [ticket, ...current];
    await saveKotTickets(next);
    setTickets(next);
    toast({
      title: `KOT #${ticket.ticketNo} sent`,
      description: `${ticket.lines.length} item${ticket.lines.length === 1 ? "" : "s"} from ${row.table.name} are with the kitchen.`,
    });
  }

  function openForm(table: RestaurantTable | null) {
    setEditing(table);
    setForm(table
      ? { name: table.name, section: table.section, seats: String(table.seats) }
      : BLANK_TABLE);
    setFormOpen(true);
  }

  async function persistPlan(next: RestaurantTable[]) {
    setTables(next);
    await saveFloorPlan(next);
  }

  async function submitForm() {
    const name = form.name.trim();
    if (!name) {
      toast({ title: "Name the table", description: "A table needs a name the staff calls it by.", variant: "destructive" });
      return;
    }
    const seats = Math.max(0, Math.round(Number(form.seats) || 0));
    const section = form.section.trim() || "Dining";
    const next = editing
      ? tables.map((t) => (t.id === editing.id ? { ...t, name, section, seats } : t))
      : [...tables, { id: newTableId(), name, section, seats }];
    await persistPlan(next);
    setFormOpen(false);
    setEditing(null);
  }

  async function confirmRelease() {
    if (!releasing) return;
    await releaseTable(releasing.table.id);
    setReleasing(null);
    await refresh();
    toast({ title: `${releasing.table.name} cleared`, description: "The parked order was discarded and the table is free." });
  }

  async function confirmRemove() {
    if (!removing) return;
    await persistPlan(tables.filter((t) => t.id !== removing.id));
    setRemoving(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[#64748b]">
        <Loader2 className="mr-2 animate-spin" size={18} /> Loading the floor…
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="tables-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[24px] font-black tracking-tight text-[var(--brand-ink)]">Tables</h1>
          <p className="text-[13px] text-[#52627e]">
            Seat a table to open its order. It stays parked until you settle it at the counter.
          </p>
          {/* Said plainly rather than implied: the floor and its tickets live on
              this device, so a second tablet keeps its own. */}
          <p className="mt-0.5 text-[12px] text-[#8494ad]">This device's floor — tables and kitchen tickets are not shared with other devices yet.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/kitchen")}>
            <ChefHat size={15} /> Kitchen
          </Button>
          <Button className="h-10 gap-2 rounded-[10px] font-black" onClick={() => openForm(null)}>
            <Plus size={15} /> Add table
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Utensils size={15} />} label="Occupied" value={String(totals.open)} />
        <Stat icon={<LayoutGrid size={15} />} label="Free" value={String(totals.free)} />
        <Stat icon={<IndianRupee size={15} />} label="On the floor" value={inr(totals.running)} />
        <Stat icon={<ChefHat size={15} />} label="Not sent to kitchen" value={String(totals.awaitingKitchen)} />
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-[13px] text-[#64748b]">
          No tables yet. Add the first one to start seating.
        </div>
      ) : null}

      {sections.map(([section, rows]) => (
        <section key={section} className="space-y-3">
          <h2 className="text-[12px] font-black uppercase tracking-wider text-[#64748b]">{section}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {rows.map((row) => (
              <TableCard
                key={row.table.id}
                row={row}
                onSeat={() => void seat(row)}
                onKot={() => void sendToKitchen(row)}
                onEdit={() => openForm(row.table)}
                onRelease={() => setReleasing(row)}
                onRemove={() => setRemoving(row.table)}
              />
            ))}
          </div>
        </section>
      ))}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit table" : "Add table"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} placeholder="T9 / Terrace 2 / Takeaway"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Section</Label>
                <Input value={form.section} placeholder="Dining"
                  onChange={(e) => setForm({ ...form, section: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Seats</Label>
                <Input value={form.seats} inputMode="numeric"
                  onChange={(e) => setForm({ ...form, seats: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitForm()}>{editing ? "Save" : "Add table"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(releasing)}
        title={`Clear ${releasing?.table.name ?? "table"}?`}
        description={`The parked order (${inr(releasing?.runningTotal ?? 0)}) is discarded without billing. Kitchen tickets already sent are not recalled.`}
        confirmLabel="Clear table"
        destructive
        onConfirm={() => void confirmRelease()}
        onCancel={() => setReleasing(null)}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? "table"}?`}
        description="The table disappears from the floor plan. Nothing that was already billed changes."
        confirmLabel="Remove"
        destructive
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#64748b]">
        {icon} {label}
      </div>
      <div className="mt-1 font-display text-[20px] font-black text-[var(--brand-ink)]">{value}</div>
    </div>
  );
}

function TableCard({
  row, onSeat, onKot, onEdit, onRelease, onRemove,
}: {
  row: TableOccupancy;
  onSeat: () => void;
  onKot: () => void;
  onEdit: () => void;
  onRelease: () => void;
  onRemove: () => void;
}) {
  const occupied = Boolean(row.bill);
  const pending = row.pendingKotLines.length;
  return (
    <div
      data-testid={`table-card-${row.table.id}`}
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border p-3.5 transition",
        occupied ? "border-[var(--brand)]/40 bg-[#f6f9ff]" : "bg-white",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[17px] font-black text-[var(--brand-ink)]">{row.table.name}</div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-[#64748b]">
            <Users size={11} /> {row.table.seats || "—"} seats
          </div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", CHIP_TONES[occupied ? "amber" : "green"])}>
          {occupied ? "Seated" : "Free"}
        </span>
      </div>

      {occupied ? (
        <div className="space-y-1 text-[12px] text-[#52627e]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1"><Receipt size={12} /> {row.items} item{row.items === 1 ? "" : "s"}</span>
            <span className="font-black text-[var(--brand-ink)]">{inr(row.runningTotal)}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <Clock size={11} /> {sinceLabel(row.openedAt)}
            {pending > 0 ? (
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-black", CHIP_TONES.orange)}>
                {pending} to fire
              </span>
            ) : row.tickets.length > 0 ? (
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-black", CHIP_TONES.green)}>
                kitchen has it
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-[#64748b]">Tap to start an order.</p>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" className="h-8 flex-1 rounded-[8px] text-[12px] font-black" onClick={onSeat}>
          {occupied ? "Open order" : "Seat"}
        </Button>
        {occupied && pending > 0 ? (
          <Button size="sm" variant="outline" className="h-8 gap-1 rounded-[8px] text-[12px] font-bold" onClick={onKot}>
            <ChefHat size={13} /> Fire {pending}
          </Button>
        ) : null}
        {occupied ? (
          <Button size="sm" variant="ghost" className="h-8 w-8 rounded-[8px] p-0 text-[#64748b]" title="Clear table" onClick={onRelease}>
            <X size={14} />
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-8 w-8 rounded-[8px] p-0 text-[#64748b]" title="Edit table" onClick={onEdit}>
              <Pencil size={13} />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 rounded-[8px] p-0 text-[#64748b]" title="Remove table" onClick={onRemove}>
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
