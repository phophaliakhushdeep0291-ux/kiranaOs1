import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Plus, RefreshCw, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { cn } from "@/lib/utils";
import type { Reservation, ReservationStatus } from "../service/reservations-api";
import { createReservation, listReservations, setReservationStatus } from "../service/reservations-api";
import { listTables } from "../service/restaurant-api";
import type { RestaurantTable } from "@/types/api";

/**
 * The booking diary a host works from.
 *
 * Ordered strictly by sitting time rather than grouped by table, because the
 * question at the desk is always "who is next", never "what is table 5 doing all
 * evening". Closed bookings stay visible but muted: a party that cancelled is
 * still the answer to "why is that table empty at eight".
 *
 * The server refuses a double-booking outright, so this screen never tries to
 * predict a clash — it surfaces the refusal, which is the only version that
 * cannot disagree with the diary.
 */
const OPEN_STATUSES: ReservationStatus[] = ["booked", "seated"];

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

// Spelled out rather than built with a template literal: t() is typed against
// the English catalogue, and a computed key would compile while silently
// resolving to nothing at runtime.
const STATUS_KEY = {
  booked: "restaurant.reservations.status.booked",
  seated: "restaurant.reservations.status.seated",
  completed: "restaurant.reservations.status.completed",
  cancelled: "restaurant.reservations.status.cancelled",
  no_show: "restaurant.reservations.status.noShow",
} as const;

const STATUS_TONE: Record<ReservationStatus, string> = {
  booked: "bg-blue-50 text-blue-700 border-blue-200",
  seated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  no_show: "bg-amber-50 text-amber-800 border-amber-200",
};

export default function ReservationsPage() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const [rows, setRows] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    guestName: "",
    guestPhone: "",
    partySize: "2",
    reservedFor: localInputValue(new Date(Date.now() + 60 * 60 * 1000)),
    durationMinutes: "90",
    tableId: "",
    note: "",
  }));

  const refresh = useCallback(async () => {
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
      const [reservations, floor] = await Promise.all([
        listReservations({ from: from.toISOString(), to: to.toISOString() }),
        listTables().catch(() => [] as RestaurantTable[]),
      ]);
      setRows(reservations);
      setTables(floor);
    } catch (loadError) {
      toast({
        title: t("restaurant.reservations.loadFailed"),
        description: loadError instanceof Error ? loadError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upcoming = useMemo(() => rows.filter((row) => OPEN_STATUSES.includes(row.status)), [rows]);
  const closed = useMemo(() => rows.filter((row) => !OPEN_STATUSES.includes(row.status)), [rows]);

  async function submit() {
    setError("");
    if (!form.guestName.trim()) {
      setError(t("restaurant.reservations.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await createReservation({
        guestName: form.guestName.trim(),
        guestPhone: form.guestPhone.trim() || null,
        partySize: Number(form.partySize) || 2,
        reservedFor: new Date(form.reservedFor).toISOString(),
        durationMinutes: Number(form.durationMinutes) || 90,
        tableId: form.tableId || null,
        note: form.note.trim() || null,
      });
      setOpen(false);
      setForm((current) => ({ ...current, guestName: "", guestPhone: "", note: "" }));
      await refresh();
      toast({ title: t("restaurant.reservations.booked") });
    } catch (saveError) {
      // The clash message names the party already holding the table, so it is
      // shown as-is rather than replaced with a generic failure.
      setError(saveError instanceof Error ? saveError.message : t("restaurant.reservations.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function move(row: Reservation, status: Exclude<ReservationStatus, "booked">) {
    try {
      await setReservationStatus(row.id, status);
      await refresh();
    } catch (moveError) {
      toast({
        title: t("restaurant.reservations.updateFailed"),
        description: moveError instanceof Error ? moveError.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title={t("restaurant.reservations.title")}
        description={t("restaurant.reservations.subtitle")}
        actions={(
          <span className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => void refresh()}>
              <RefreshCw size={14} /> {t("restaurant.reservations.refresh")}
            </Button>
            <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setOpen(true)}>
              <Plus size={14} /> {t("restaurant.reservations.newBooking")}
            </Button>
          </span>
        )}
      />

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> {t("restaurant.reservations.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-3 text-[13px] font-black text-[var(--brand-ink)]">
              {t("restaurant.reservations.upcoming", { count: String(upcoming.length) })}
            </h2>
            {upcoming.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">{t("restaurant.reservations.noneUpcoming")}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-black text-[var(--brand-ink)]">{row.guestName}</span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[row.status])}>
                          {t(STATUS_KEY[row.status])}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-slate-500">
                        {t("restaurant.reservations.line", {
                          day: dayLabel(row.reservedFor),
                          time: timeLabel(row.reservedFor),
                          people: String(row.partySize),
                          table: row.table ? row.table.name : t("restaurant.reservations.noTableYet"),
                        })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {row.status === "booked" && (
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void move(row, "seated")}>
                          <CheckCircle2 size={13} /> {t("restaurant.reservations.seat")}
                        </Button>
                      )}
                      {row.status === "seated" && (
                        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => void move(row, "completed")}>
                          <CheckCircle2 size={13} /> {t("restaurant.reservations.complete")}
                        </Button>
                      )}
                      {row.status === "booked" && (
                        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => void move(row, "no_show")}>
                          <UserX size={13} /> {t("restaurant.reservations.noShow")}
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs text-rose-600" onClick={() => void move(row, "cancelled")}>
                        <X size={13} /> {t("restaurant.reservations.cancel")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {closed.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-4 py-3 text-[13px] font-black text-slate-500">
                {t("restaurant.reservations.closed", { count: String(closed.length) })}
              </h2>
              <ul className="divide-y divide-slate-100">
                {closed.slice(0, 20).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px] text-slate-500">
                    <span className="truncate">{row.guestName} · {timeLabel(row.reservedFor)}</span>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[row.status])}>
                      {t(STATUS_KEY[row.status])}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("restaurant.reservations.newBooking")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="reservation-name">{t("restaurant.reservations.guestName")}</Label>
              <Input id="reservation-name" className="mt-1" value={form.guestName} onChange={(event) => setForm({ ...form, guestName: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="reservation-phone">{t("restaurant.reservations.phone")}</Label>
                <Input id="reservation-phone" className="mt-1" value={form.guestPhone} onChange={(event) => setForm({ ...form, guestPhone: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="reservation-party">{t("restaurant.reservations.partySize")}</Label>
                <Input id="reservation-party" className="mt-1" inputMode="numeric" value={form.partySize} onChange={(event) => setForm({ ...form, partySize: event.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="reservation-time">{t("restaurant.reservations.when")}</Label>
                <Input id="reservation-time" type="datetime-local" className="mt-1" value={form.reservedFor} onChange={(event) => setForm({ ...form, reservedFor: event.target.value })} />
              </div>
              <div>
                <Label htmlFor="reservation-duration">{t("restaurant.reservations.duration")}</Label>
                <Input id="reservation-duration" className="mt-1" inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="reservation-table">{t("restaurant.reservations.table")}</Label>
              <select
                id="reservation-table"
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={form.tableId}
                onChange={(event) => setForm({ ...form, tableId: event.target.value })}
              >
                <option value="">{t("restaurant.reservations.decideLater")}</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>{table.name} · {table.seats}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-[12px] font-bold text-rose-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("restaurant.reservations.close")}</Button>
            <Button type="button" disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="animate-spin" size={14} /> : <CalendarClock size={14} />}
              <span className="ml-1.5">{t("restaurant.reservations.save")}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
