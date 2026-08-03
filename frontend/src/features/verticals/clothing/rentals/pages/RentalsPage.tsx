import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarDays, CalendarRange, Check, IndianRupee, Loader2, MapPin,
  Pencil, Phone, Plus, Search, Shirt, Trash2, Undo2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import {
  cancelRental, createRental, deleteRental, getRentalSummary,
  listRentals, markRentalPickedUp, markRentalReturned, updateRental,
} from "@/features/verticals/clothing/rentals/api";
import { RentalBookingPanel } from "@/features/verticals/clothing/rentals/components/RentalBookingPanel";
import type { RentalBooking, RentalBookingInput, RentalStatus } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDay(key?: string | null) {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function daysOut(booking: RentalBooking) {
  const start = Date.parse(`${booking.fromDateKey}T00:00:00`);
  const end = Date.parse(`${booking.toDateKey}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

const STATUS_CHIP: Record<RentalStatus, { label: string; tone: keyof typeof CHIP_TONES }> = {
  booked: { label: "Booked", tone: "blue" },
  picked_up: { label: "With customer", tone: "violet" },
  returned: { label: "Returned", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "open", label: "Open" },
  { key: "booked", label: "Booked" },
  { key: "picked_up", label: "With customer" },
  { key: "returned", label: "Returned" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export default function RentalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<RentalBooking | null>(null);
  const [returning, setReturning] = useState<RentalBooking | null>(null);
  const [deleting, setDeleting] = useState<RentalBooking | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:rentals-panel-width", { defaultWidth: 480 });

  const bookingsQ = useQuery({ queryKey: ["rentals"], queryFn: () => listRentals() });
  const summaryQ = useQuery({ queryKey: ["rentals", "summary"], queryFn: getRentalSummary });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["rentals"] });
    // A booking changes what the storefront may show, so drop the catalogue too.
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const offlineNotice = () => toast({
    title: "You're offline",
    description: "Bookings need a connection so two counters can't promise the same outfit. Reconnect and try again — your typed details stay in the form.",
    variant: "destructive",
  });

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) return offlineNotice();
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    };
  }

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: RentalBookingInput }) => (vars.id ? updateRental(vars.id, vars.data) : createRental(vars.data)),
    onSuccess: (booking) => {
      invalidate();
      setPanelOpen(false);
      setEditing(null);
      toast({ title: editing ? "Booking updated" : `Booking ${booking.bookingNumber} created` });
    },
    onError: failure("Could not save the booking"),
  });

  const pickupMut = useMutation({
    mutationFn: (id: string) => markRentalPickedUp(id),
    onSuccess: () => { invalidate(); toast({ title: "Marked as picked up" }); },
    onError: failure("Could not update"),
  });

  const returnMut = useMutation({
    mutationFn: (vars: { id: string; lateFee: number; damageCharge: number }) => markRentalReturned(vars.id, vars),
    onSuccess: () => { invalidate(); setReturning(null); toast({ title: "Returned — items free to rent again" }); },
    onError: failure("Could not close the booking"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelRental(id),
    onSuccess: () => { invalidate(); toast({ title: "Booking cancelled" }); },
    onError: failure("Could not cancel"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRental(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Booking moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const all = bookingsQ.data ?? [];
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((b) => {
        if (filter === "all") return true;
        if (filter === "open") return b.status === "booked" || b.status === "picked_up";
        return b.status === filter;
      })
      .filter((b) => {
        if (!term) return true;
        return [b.customerName, b.customerPhone, b.bookingNumber, ...b.items.map((i) => i.name)]
          .join(" ").toLowerCase().includes(term);
      });
  }, [all, filter, search]);

  const summary = summaryQ.data;

  function openCreate() { setEditing(null); setPanelOpen(true); }
  function openEdit(booking: RentalBooking) { setEditing(booking); setPanelOpen(true); }

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the last bookings saved on this device. New bookings and returns need a connection, so the same outfit can never be promised twice.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Shirt size={16} />} label="Out with customers" value={String(summary?.outNow ?? 0)} tone="violet" />
          <Kpi icon={<CalendarDays size={16} />} label="Due back today" value={String(summary?.dueToday ?? 0)} tone="blue" />
          <Kpi icon={<AlertTriangle size={16} />} label="Overdue" value={String(summary?.overdue ?? 0)} tone={summary?.overdue ? "rose" : "green"} />
          <Kpi icon={<IndianRupee size={16} />} label="Yet to collect" value={inr(summary?.pendingCollection ?? 0)} tone="green" />
        </div>

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Rental bookings</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">
                A booked outfit is hidden from customers for its dates and comes back the day it is returned.
              </p>
            </div>
            <Button onClick={openCreate} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95">
              <Plus size={15} /> New Booking
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
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                className="h-9 pl-8"
                placeholder="Name, mobile, booking no."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {bookingsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : bookingsQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load bookings. Check your connection.</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Shirt size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">{all.length === 0 ? "No rentals booked yet" : "Nothing matches this filter"}</p>
              <p className="max-w-[380px] text-[12px] text-[#64748b]">
                {all.length === 0
                  ? "Take a booking with the renter's name, address and mobile, and the dates the outfit is needed."
                  : "Try another status or clear the search."}
              </p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold">Renter</th>
                    <th className="px-5 py-2.5 text-left font-bold">Items</th>
                    <th className="px-5 py-2.5 text-left font-bold">Rented for</th>
                    <th className="px-5 py-2.5 text-left font-bold">Status</th>
                    <th className="px-5 py-2.5 text-right font-bold">Balance</th>
                    <th className="px-5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((booking, i) => {
                    const chip = STATUS_CHIP[booking.status] ?? STATUS_CHIP.booked;
                    const open = booking.status === "booked" || booking.status === "picked_up";
                    return (
                      <tr key={booking.id} className={i < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                        <td className="px-5 py-3 align-top">
                          <p className="font-bold text-[var(--brand-ink)]">{booking.customerName}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#52627e]"><Phone size={11} /> {booking.customerPhone || "—"}</p>
                          {booking.customerAddress && (
                            <p className="mt-0.5 flex max-w-[240px] items-start gap-1 text-[11px] text-[#8492ac]">
                              <MapPin size={11} className="mt-[2px] shrink-0" />
                              <span className="line-clamp-2">{booking.customerAddress}</span>
                            </p>
                          )}
                          <span className="mt-1 inline-block rounded-[5px] bg-[#f1f5fa] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#52627e]">{booking.bookingNumber}</span>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <ul className="space-y-0.5">
                            {booking.items.map((item, idx) => (
                              <li key={item.id ?? idx} className="text-[12px] text-[#344668]">
                                <span className="font-semibold">{item.qty}</span> × {item.name}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <p className="flex items-center gap-1.5 font-semibold text-[var(--brand-ink)]">
                            <CalendarRange size={13} className="text-[#8492ac]" />
                            {fmtDay(booking.fromDateKey)} – {fmtDay(booking.toDateKey)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#8492ac]">{daysOut(booking)} day{daysOut(booking) === 1 ? "" : "s"}</p>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES[chip.tone])}>{chip.label}</span>
                          {booking.isOverdue && (
                            <span className={cn("mt-1 block w-fit rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.red)}>Overdue</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right align-top">
                          <p className="font-bold text-[var(--brand-ink)]">{inr(booking.balanceDue)}</p>
                          {booking.depositAmount > 0 && <p className="mt-0.5 text-[11px] text-[#8492ac]">{inr(booking.depositAmount)} deposit</p>}
                        </td>
                        <td className="px-5 py-3 align-top">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {booking.status === "booked" && (
                              <Button variant="outline" className="h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold" disabled={pickupMut.isPending} onClick={() => pickupMut.mutate(booking.id)}>
                                <Check size={13} /> Picked up
                              </Button>
                            )}
                            {open && (
                              <Button variant="outline" className="h-8 gap-1.5 rounded-[8px] border-emerald-200 px-2.5 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50" onClick={() => setReturning(booking)}>
                                <Undo2 size={13} /> Return
                              </Button>
                            )}
                            {open && (
                              <button onClick={() => openEdit(booking)} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Edit booking"><Pencil size={14} /></button>
                            )}
                            {open && (
                              <button onClick={() => cancelMut.mutate(booking.id)} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label="Cancel booking"><X size={15} /></button>
                            )}
                            <button onClick={() => setDeleting(booking)} className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label="Delete booking"><Trash2 size={14} /></button>
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

      <RentalBookingPanel
        open={panelOpen}
        editing={editing}
        saving={saveMut.isPending}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => { setPanelOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <ReturnDialog
        booking={returning}
        saving={returnMut.isPending}
        onClose={() => setReturning(null)}
        onConfirm={(lateFee, damageCharge) => returning && returnMut.mutate({ id: returning.id, lateFee, damageCharge })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this booking?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            {deleting?.bookingNumber} for {deleting?.customerName} will move to the recycle bin, and its items become free to rent again.
          </p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>
              {deleteMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReturnDialog({ booking, saving, onClose, onConfirm }: {
  booking: RentalBooking | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (lateFee: number, damageCharge: number) => void;
}) {
  const [lateFee, setLateFee] = useState("0");
  const [damageCharge, setDamageCharge] = useState("0");

  return (
    <Dialog
      open={booking !== null}
      onOpenChange={(open) => {
        if (open) return;
        setLateFee("0");
        setDamageCharge("0");
        onClose();
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Take the items back</DialogTitle></DialogHeader>
        {booking && (
          <div className="space-y-3">
            <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5 text-[12px] text-[#52627e]">
              <p className="font-bold text-[var(--brand-ink)]">{booking.customerName} · {booking.bookingNumber}</p>
              <p className="mt-0.5">{booking.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
              <p className="mt-0.5">Due {fmtDay(booking.toDateKey)}{booking.isOverdue ? " · overdue" : ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Late fee (₹)</Label>
                <Input className="h-10" type="number" min="0" step="0.01" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Damage charge (₹)</Label>
                <Input className="h-10" type="number" min="0" step="0.01" value={damageCharge} onChange={(e) => setDamageCharge(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-[#8492ac]">
              The {inr(booking.depositAmount)} deposit is refundable — deduct any charges from it at the counter.
            </p>
            <div className="flex gap-2.5 pt-1">
              <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
              <Button
                className="h-11 flex-1 gap-2 rounded-[10px] bg-emerald-600 font-black text-white hover:bg-emerald-700"
                disabled={saving}
                onClick={() => onConfirm(Number(lateFee) || 0, Number(damageCharge) || 0)}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />} Mark returned
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
