import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  CalendarClock, ChefHat, Clock, IndianRupee, LayoutGrid, Loader2, Pencil, Plus, QrCode, Receipt,
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
import { listReservations, type Reservation } from "../service/reservations-api";
import { mergeServerCodes, unpublishedTables } from "../service/table-qr";
import { TableQrDialog } from "./components/TableQrDialog";
import { GuestRequestsStrip } from "./components/GuestRequestsStrip";
import { GuestOrdersStrip } from "./components/GuestOrdersStrip";
import { useAuth } from "@/features/core/auth/useAuth";
import { useAppLanguage } from "@/features/core/settings/i18n";
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
  const { t } = useAppLanguage();
  const { shop } = useAuth();
  const [, navigate] = useLocation();
  const [qrFor, setQrFor] = useState<RestaurantTable | null>(null);
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [tableBills, setTableBills] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<KotTicket[]>([]);
  const [bookings, setBookings] = useState<Reservation[]>([]);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState(BLANK_TABLE);
  const [formOpen, setFormOpen] = useState(false);
  const [releasing, setReleasing] = useState<TableOccupancy | null>(null);
  const [removing, setRemoving] = useState<RestaurantTable | null>(null);
  // Re-render on a timer so "seated 12m" ages without the waiter touching it.
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const [plan, heldRaw, draft, mapRaw, kot, reservations] = await Promise.all([
      loadFloorPlan(),
      offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
      offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
      loadTableBills(),
      // Every till's tickets, not this one's: the "already fired" tally below
      // is only right if it can see what the other counter has already sent.
      listKitchenTickets({ includeServed: true }).catch(() => [] as KotTicket[]),
      // The diary, so a table booked for eight does not read Free at five to.
      // Failure is silent on purpose: the floor works offline, and a missing
      // booking must never stop a waiter seating someone standing in front
      // of them.
      listReservations({ from: new Date().toISOString(), to: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
        .catch(() => [] as Reservation[]),
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
    setBookings(reservations);
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

  /**
   * The next booking each table is holding, keyed the way the rest of this
   * screen already joins to the server: by name, falling back to the QR code.
   * The till owns its floor plan's ids and the server owns the booking, so the
   * name is the only thing both sides agree on.
   *
   * Only bookings still ahead of us count. A party that has already been seated
   * is on the floor, not in the diary, and showing their slot again would read
   * as a second sitting.
   */
  const bookingByTable = useMemo(() => {
    const now = Date.now();
    const byTable = new Map<string, Reservation>();
    const upcoming = bookings
      .filter((row) => row.status === "booked" && row.table && Date.parse(row.reservedFor) >= now)
      .sort((a, b) => a.reservedFor.localeCompare(b.reservedFor));
    for (const row of upcoming) {
      const key = row.table!.name || row.table!.code;
      if (key && !byTable.has(key)) byTable.set(key, row);
    }
    return byTable;
  }, [bookings]);

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
        title: t("restaurant.tables.seatFailed", { table: row.table.name }),
        description: error instanceof Error ? error.message : t("restaurant.tables.tryAgain"),
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
        title: t("restaurant.tables.kotSent", { number: ticket.ticketNo }),
        description: ticket.lines.length === 1
          ? t("restaurant.tables.kotSentOne", { table: row.table.name })
          : t("restaurant.tables.kotSentMany", { count: ticket.lines.length, table: row.table.name }),
      });
    } catch {
      // Deliberately not saved locally as a consolation. A ticket the kitchen
      // screen cannot see is not a sent ticket, and a success toast over one
      // would be exactly the bug this whole change removes.
      toast({
        title: t("restaurant.tables.kitchenFailed"),
        description: t("restaurant.tables.kitchenFailedHelp"),
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
      toast({ title: t("restaurant.tables.nameRequired"), description: t("restaurant.tables.nameRequiredHelp"), variant: "destructive" });
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
    toast({ title: `${releasing.table.name} cleared`, description: t("restaurant.tables.clearedHelp") });
  }

  async function confirmRemove() {
    if (!removing) return;
    await persistPlan(tables.filter((t) => t.id !== removing.id));
    setRemoving(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[#64748b]">
        <Loader2 className="mr-2 animate-spin" size={18} /> {t("restaurant.tables.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="tables-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[24px] font-black tracking-tight text-[var(--brand-ink)]">{t("restaurant.tables.title")}</h1>
          <p className="text-[13px] text-[#52627e]">
            {t("restaurant.tables.subtitle")}
          </p>
          {/* Said plainly rather than implied: the floor and its tickets live on
              this device, so a second tablet keeps its own. */}
          <p className="mt-0.5 text-[12px] text-[#8494ad]">{t("restaurant.tables.deviceNote")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold"
            data-testid="print-table-qr"
            onClick={() => setQrSheetOpen(true)}
          >
            <QrCode size={15} /> {t("restaurant.tables.qrCodes")}
          </Button>
          <Button variant="outline" className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/kitchen")}>
            <ChefHat size={15} /> {t("restaurant.tables.kitchen")}
          </Button>
          <Button className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-black" onClick={() => openForm(null)}>
            <Plus size={15} /> {t("restaurant.tables.addTable")}
          </Button>
        </div>
      </header>

      {/* Accepting a guest's QR order writes to the TABLE'S BILL, and DineIn tells
          the guest their order is "waiting for the billing counter". Until now
          the only place to accept one was the kitchen board — so the person the
          guest was told about could not see it, and the person who could see it
          is refused whenever the counter has that table open. */}
      <GuestOrdersStrip onAccepted={() => void refresh()} />
      <GuestRequestsStrip />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Utensils size={15} />} label={t("restaurant.tables.occupied")} value={String(totals.open)} />
        <Stat icon={<LayoutGrid size={15} />} label={t("restaurant.tables.free")} value={String(totals.free)} />
        <Stat icon={<IndianRupee size={15} />} label={t("restaurant.tables.onTheFloor")} value={inr(totals.running)} />
        <Stat icon={<ChefHat size={15} />} label={t("restaurant.tables.notSentToKitchen")} value={String(totals.awaitingKitchen)} />
      </div>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-[13px] text-[#64748b]">
          {t("restaurant.tables.noTables")}
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
                booking={bookingByTable.get(row.table.name) ?? bookingByTable.get(row.table.code ?? "") ?? null}
              />
            ))}
          </div>
        </section>
      ))}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? t("restaurant.tables.editTable") : t("restaurant.tables.addTable")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t("restaurant.tables.nameLabel")}</Label>
              <Input value={form.name} placeholder={t("restaurant.tables.namePlaceholder")}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("restaurant.tables.sectionLabel")}</Label>
                <Input value={form.section} placeholder={t("restaurant.tables.sectionPlaceholder")}
                  onChange={(e) => setForm({ ...form, section: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("restaurant.tables.seatsLabel")}</Label>
                <Input value={form.seats} inputMode="numeric"
                  onChange={(e) => setForm({ ...form, seats: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t("restaurant.tables.cancel")}</Button>
            <Button onClick={() => void submitForm()}>{editing ? t("restaurant.tables.save") : t("restaurant.tables.addTable")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(releasing)}
        title={`Clear ${releasing?.table.name ?? "table"}?`}
        description={`The parked order (${inr(releasing?.runningTotal ?? 0)}) is discarded without billing. Kitchen tickets already sent are not recalled.`}
        confirmLabel={t("restaurant.tables.clearTable")}
        destructive
        onConfirm={() => void confirmRelease()}
        onCancel={() => setReleasing(null)}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? "table"}?`}
        description={t("restaurant.tables.removeHelp")}
        confirmLabel={t("restaurant.tables.remove")}
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
  row, onSeat, onKot, onEdit, onQr, onRelease, onRemove, booking,
}: {
  row: TableOccupancy;
  /** The next party booked here, so a walk-in is not seated over them. */
  booking: Reservation | null;
  onSeat: () => void;
  onKot: () => void;
  onEdit: () => void;
  onQr: () => void;
  onRelease: () => void;
  onRemove: () => void;
}) {
  const { t } = useAppLanguage();
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
      {booking ? (
        <div className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold", CHIP_TONES.violet)}>
          <CalendarClock size={11} className="shrink-0" />
          <span className="truncate">
            {t("restaurant.tables.booked", {
              time: new Date(booking.reservedFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              name: booking.guestName,
              people: booking.partySize,
            })}
          </span>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[17px] font-black text-[var(--brand-ink)]">{row.table.name}</div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-[#64748b]">
            <Users size={11} /> {t("restaurant.tables.seats", { count: row.table.seats || "—" })}
          </div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", CHIP_TONES[occupied ? "amber" : "green"])}>
          {occupied ? "Seated" : "Free"}
        </span>
      </div>

      {occupied ? (
        <div className="space-y-1 text-[12px] text-[#52627e]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1"><Receipt size={12} /> {row.items === 1 ? t("restaurant.tables.itemsOne") : t("restaurant.tables.itemsMany", { count: row.items })}</span>
            <span className="font-black text-[var(--brand-ink)]">{inr(row.runningTotal)}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <Clock size={11} /> {sinceLabel(row.openedAt)}
            {pending > 0 ? (
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-black", CHIP_TONES.orange)}>
                {t("restaurant.tables.toFire", { count: pending })}
              </span>
            ) : row.tickets.length > 0 ? (
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-black", CHIP_TONES.green)}>
                {t("restaurant.tables.kitchenHasIt")}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-[#64748b]">{t("restaurant.tables.tapToStart")}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" className="h-11 lg:mouse:h-8 flex-1 rounded-[8px] text-[12px] font-black" onClick={onSeat}>
          {occupied ? "Open order" : "Seat"}
        </Button>
        {occupied && pending > 0 ? (
          <Button size="sm" variant="outline" className="h-11 lg:mouse:h-8 gap-1 rounded-[8px] text-[12px] font-bold" onClick={onKot}>
            <ChefHat size={13} /> {t("restaurant.tables.fire", { count: pending })}
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
          <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Clear ${row.table.name}`} title={t("restaurant.tables.clearTable")} onClick={onRelease}>
            <X size={14} />
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Edit ${row.table.name}`} title={t("restaurant.tables.editTable")} onClick={onEdit}>
              <Pencil size={13} />
            </Button>
            <Button size="sm" variant="ghost" className="h-11 w-11 rounded-[8px] p-0 text-[#64748b] lg:mouse:h-8 lg:mouse:w-8" aria-label={`Remove ${row.table.name}`} title={t("restaurant.tables.removeTable")} onClick={onRemove}>
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
