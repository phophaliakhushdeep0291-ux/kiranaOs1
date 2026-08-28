import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ChefHat, Clock, IndianRupee, LayoutGrid, Loader2, Pencil, Plus, QrCode, Receipt,
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
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY } from "@/features/core/billing/pages/open-bills";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";
import {
  buildKotTicket, buildOccupancy, loadFloorPlan, loadTableBills,
  newTableId, reconcileTableBills, saveFloorPlan, saveTableBills,
  withLiveDraft, type KotTicket, type RestaurantTable, type TableOccupancy,
} from "../service/table-store";
import { openTableInBilling, releaseTable } from "../service/open-table";
import { fireKitchenTicket, listKitchenTickets, listTables, publishFloorPlan } from "../service/restaurant-api";
import { mergeServerCodes, unpublishedTables } from "../service/table-qr";
import { TableQrDialog } from "./components/TableQrDialog";
import { GuestRequestsStrip } from "./components/GuestRequestsStrip";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { websiteFromPrefs } from "@/features/core/customer-order/restaurant-website";

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

/**
 * Publish this device's floor to the server, and bring back what each table's
 * QR sticker says.
 *
 * The till keeps owning table ids — they key the table -> open-order map, and
 * rewriting them would drop every seating currently on the floor. The server
 * owns only the thing the till cannot: a code a stranger's phone can resolve.
 *
 * A floor with tables the server has never seen is published once. That is
 * matched on the derived code, so running it again does not duplicate the room.
 * Failure here is not an error the waiter should see: the floor screen works
 * offline and only the QR codes are missing until the connection returns.
 */
async function syncFloorCodes(plan: RestaurantTable[]): Promise<RestaurantTable[]> {
  let published = await listTables().catch(() => null);
  if (!published) return plan;

  let merged = mergeServerCodes(plan, published);
  if (unpublishedTables(merged).length > 0) {
    published = await publishFloorPlan(
      plan.map((table, index) => ({
        name: table.name,
        section: table.section,
        seats: table.seats,
        sortOrder: index,
      })),
    ).catch(() => null);
    if (published) merged = mergeServerCodes(plan, published);
  }
  return merged;
}

export default function TablesPage() {
  const { prefs } = useSettingsPrefs();
  const { toast } = useToast();
  const { shop } = useAuth();
  const [, navigate] = useLocation();
  const [qrFor, setQrFor] = useState<RestaurantTable | null>(null);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
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
    const [plan, heldRaw, draft, mapRaw, kot] = await Promise.all([
      loadFloorPlan(),
      offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
      offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
      loadTableBills(),
      // Every till's tickets, not this one's: the "already fired" tally below
      // is only right if it can see what the other counter has already sent.
      listKitchenTickets({ includeServed: true }).catch(() => [] as KotTicket[]),
    ]);
    // The table open at the till lives in the draft, not the parked set.
    const held = withLiveDraft(Array.isArray(heldRaw) ? heldRaw : [], draft);
    const map = reconcileTableBills(mapRaw, held, draft?.activeBillId);
    // A settled table drops out of the map here; persist so it stays freed.
    if (Object.keys(map).length !== Object.keys(mapRaw).length) void saveTableBills(map);
    setTables(plan);
    setHeldBills(held);
    setTableBills(map);
    setTickets(kot);
    setLoading(false);

    // The floor paints first and the QR codes arrive a moment later. A waiter
    // opening this screen mid-service is looking for a free table, not a
    // sticker, and must never wait on the network to see one.
    const withCodes = await syncFloorCodes(plan);
    if (withCodes.some((table, index) => table.code !== plan[index]?.code)) {
      setTables(withCodes);
      void saveFloorPlan(withCodes);
    }
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
    try {
      await openTableInBilling(row.table);
    } catch (error) {
      // A full till refuses the seating rather than evicting another table's
      // running order. The waiter has to be told, or the tap looks broken and
      // they try again on a busier floor.
      toast({
        title: `Could not open ${row.table.name}`,
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
      return;
    }
    navigate("/billing");
  }

  async function sendToKitchen(row: TableOccupancy) {
    if (row.pendingKotLines.length === 0 || !row.bill) return;
    const lines = row.pendingKotLines;
    try {
      // The ticket number comes back from the server: two tills firing at the
      // same moment would otherwise both pick the same one, and the kitchen
      // would get two different tickets called #14.
      //
      // The idempotency key is this device's own ticket id, so a send retried
      // after a dropped reply lands once rather than putting the dish on twice.
      const ticket = await fireKitchenTicket({
        tableId: row.table.id,
        tableName: row.table.name,
        billId: row.bill.id,
        lines,
        idempotencyKey: buildKotTicket(row.table, row.bill.id, lines, tickets).id,
      });
      setTickets([ticket, ...tickets]);
      toast({
        title: `KOT #${ticket.ticketNo} sent`,
        description: `${ticket.lines.length} item${ticket.lines.length === 1 ? "" : "s"} from ${row.table.name} are with the kitchen.`,
      });
    } catch {
      // Deliberately not saved locally as a consolation. A ticket the kitchen
      // screen cannot see is not a sent ticket, and a success toast over one
      // would be exactly the bug this whole change removes.
      toast({
        title: "The kitchen did not get that",
        description: "The board is shared with the kitchen screen, so sending needs a connection. Check the network — nothing has been taken off the table.",
        variant: "destructive",
      });
    }
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
          <p className="mt-0.5 text-[12px] text-[#8494ad]">Use one designated billing counter for open table bills and seating. Kitchen tickets are shared online; open bills and occupied seats are not shared between counters.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold"
            data-testid="print-table-qr"
            onClick={() => setQrSheetOpen(true)}
          >
            <QrCode size={15} /> Table QR codes
          </Button>
          <Button variant="outline" className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/kitchen")}>
            <ChefHat size={15} /> Kitchen
          </Button>
          <Button className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-black" onClick={() => openForm(null)}>
            <Plus size={15} /> Add table
          </Button>
        </div>
      </header>

      <GuestRequestsStrip />

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
                onQr={() => setQrFor(row.table)}
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

      <TableQrDialog
        websiteUrl={websiteFromPrefs(prefs)}
        open={Boolean(qrFor) || qrSheetOpen}
        table={qrFor}
        tables={tables}
        shopId={shop?.id ?? ""}
        shopName={shop?.name ?? ""}
        onClose={() => { setQrFor(null); setQrSheetOpen(false); }}
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
  row, onSeat, onKot, onEdit, onQr, onRelease, onRemove,
}: {
  row: TableOccupancy;
  onSeat: () => void;
  onKot: () => void;
  onEdit: () => void;
  onQr: () => void;
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
        <Button size="sm" className="h-11 lg:mouse:h-8 flex-1 rounded-[8px] text-[12px] font-black" onClick={onSeat}>
          {occupied ? "Open order" : "Seat"}
        </Button>
        {occupied && pending > 0 ? (
          <Button size="sm" variant="outline" className="h-11 lg:mouse:h-8 gap-1 rounded-[8px] text-[12px] font-bold" onClick={onKot}>
            <ChefHat size={13} /> Fire {pending}
          </Button>
        ) : null}
        {/* Shown whether or not the table is seated: a curling sticker gets
            reprinted mid-service, and a guest asking for the QR is not a reason
            to clear their order first. Hidden only until the floor has been
            published — an unpublished table has no code to encode. */}
        {row.table.code ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8"
            aria-label={`Show QR for ${row.table.name}`}
            title={`QR for ${row.table.name}`}
            data-testid={`table-qr-${row.table.id}`}
            onClick={onQr}
          >
            <QrCode size={13} />
          </Button>
        ) : null}
        {occupied ? (
          <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Clear ${row.table.name}`} title="Clear table" onClick={onRelease}>
            <X size={14} />
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Edit ${row.table.name}`} title="Edit table" onClick={onEdit}>
              <Pencil size={13} />
            </Button>
            <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Remove ${row.table.name}`} title="Remove table" onClick={onRemove}>
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
