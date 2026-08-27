import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CheckCheck, ChefHat, Clock, Flame, LayoutGrid, Loader2, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHIP_TONES, type ChipTone } from "@/lib/chip-tones";
import { useToast } from "@/hooks/use-toast";
import {
  KOT_STATUS_FLOW, nextKotStatus, ticketAgeMinutes,
  type KotStatus, type KotTicket,
} from "../service/table-store";
import { listKitchenTickets, setKitchenTicketStatus } from "../service/restaurant-api";
import { GuestOrdersStrip } from "./components/GuestOrdersStrip";
import { GuestRequestsStrip } from "./components/GuestRequestsStrip";

/** How long a ticket may sit before the board calls it out. */
const LATE_MINUTES = 12;

const COLUMNS: Array<{ status: KotStatus; label: string; tone: ChipTone; action: string }> = [
  { status: "new", label: "New", tone: "orange", action: "Start cooking" },
  { status: "preparing", label: "Cooking", tone: "amber", action: "Mark ready" },
  { status: "ready", label: "Ready to serve", tone: "green", action: "Mark served" },
];

export default function KitchenPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<KotTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    // Served tickets are asked for because this screen shows a short "done"
    // rail of its own; the filtering below is what splits them.
    try {
      setTickets(await listKitchenTickets({ includeServed: true, fresh: true }));
      setRefreshFailed(false);
    } catch {
      // Retain the last board, but never make an outage look like an empty pass.
      setRefreshFailed(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    // A kitchen screen is left open, so it re-reads on its own — and now that
    // tickets are a shop record, what it is polling for is the till ACROSS THE
    // ROOM firing them, not another tab on this device.
    const poll = window.setInterval(() => { void refresh(); }, 5_000);
    const age = window.setInterval(() => setTick((n) => n + 1), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(age);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const open = useMemo(
    () => tickets.filter((ticket) => ticket.status !== "served"),
    [tickets],
  );
  const served = useMemo(
    () => tickets.filter((ticket) => ticket.status === "served").slice(0, 12),
    [tickets],
  );

  /**
   * Moved optimistically, then confirmed.
   *
   * A cook taps this with wet hands mid-service and looks away; waiting on a
   * round trip before the card moves would read as a dead screen. If the write
   * fails, the refresh below puts the ticket back where the server says it is
   * rather than leaving the screen quietly lying about the pass.
   */
  async function applyStatus(ids: string[], next: KotStatus) {
    if (ids.length === 0) return;
    const before = tickets;
    setTickets(tickets.map((row) => (ids.includes(row.id) ? { ...row, status: next } : row)));
    try {
      await Promise.all(ids.map((id) => setKitchenTicketStatus(id, next)));
      await refresh();
    } catch {
      setTickets(before);
      toast({
        title: "Could not update the pass",
        description: "The kitchen board is shared with the counter, so it needs a connection. Check the network and try again.",
        variant: "destructive",
      });
    }
  }

  function advance(ticket: KotTicket) {
    const next = nextKotStatus(ticket.status);
    if (next) void applyStatus([ticket.id], next);
  }

  function bumpAll(status: KotStatus) {
    const next = nextKotStatus(status);
    if (next) void applyStatus(tickets.filter((row) => row.status === status).map((row) => row.id), next);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[#64748b]">
        <Loader2 className="mr-2 animate-spin" size={18} /> Loading the pass…
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="kitchen-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[24px] font-black tracking-tight text-[var(--brand-ink)]">Kitchen</h1>
          <p className="text-[13px] text-[#52627e]">
            Tickets fired from the tables screen. Move each one along as it is cooked and served.
          </p>
          <p className="mt-0.5 text-[12px] text-[#8494ad]">Kitchen tickets are shared with the counter and refresh every five seconds while connected.</p>
        </div>
        <Button variant="outline" className="h-11 lg:mouse:h-10 gap-2 rounded-[10px] font-bold" onClick={() => navigate("/tables")}>
          <LayoutGrid size={15} /> Tables
        </Button>
      </header>
      {refreshFailed && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Kitchen connection lost. The board may be out of date; confirm new tickets with the counter. <button type="button" className="ml-2 min-h-11 underline" onClick={() => void refresh()}>Retry</button></div>}

      {/* Sits above the pass because it is not on the pass yet: a guest's order
          is a request until somebody takes it onto a table's bill. */}
      <GuestOrdersStrip onAccepted={() => void refresh()} />
      <GuestRequestsStrip />

      {open.length === 0 && !refreshFailed ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <ChefHat className="mx-auto mb-2 text-[#94a3b8]" size={26} />
          <p className="text-[14px] font-bold text-[var(--brand-ink)]">Nothing on the pass</p>
          <p className="text-[13px] text-[#64748b]">Fire an order from a table and it lands here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {COLUMNS.map((column) => {
            const rows = open.filter((ticket) => ticket.status === column.status);
            return (
              <section key={column.status} className="space-y-3" data-testid={`kot-column-${column.status}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-[#64748b]">
                    {column.label}
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px]", CHIP_TONES[column.tone])}>{rows.length}</span>
                  </h2>
                  {rows.length > 1 ? (
                    <button
                      className="text-[11px] font-black text-[var(--brand)] hover:underline"
                      onClick={() => void bumpAll(column.status)}
                    >
                      Bump all
                    </button>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {rows.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} actionLabel={column.action} onAdvance={() => void advance(ticket)} />
                  ))}
                  {rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-5 text-center text-[12px] text-[#94a3b8]">Empty</div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {served.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-[#64748b]">
            <CheckCheck size={13} /> Served
          </h2>
          <div className="flex flex-wrap gap-2">
            {served.map((ticket) => (
              <span key={ticket.id} className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", CHIP_TONES.gray)}>
                #{ticket.ticketNo} · {ticket.tableName}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TicketCard({ ticket, actionLabel, onAdvance }: { ticket: KotTicket; actionLabel: string; onAdvance: () => void }) {
  const minutes = ticketAgeMinutes(ticket);
  const late = minutes >= LATE_MINUTES && ticket.status !== "ready";
  const step = KOT_STATUS_FLOW.indexOf(ticket.status);
  return (
    <article
      data-testid={`kot-ticket-${ticket.id}`}
      className={cn("rounded-2xl border bg-white p-3.5", late && "border-[#ef4444]/50 bg-[#fff7f7]")}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[16px] font-black text-[var(--brand-ink)]">
            #{ticket.ticketNo} · {ticket.tableName}
          </div>
          <div className={cn("flex items-center gap-1 text-[11px] font-bold", late ? "text-[#ef4444]" : "text-[#64748b]")}>
            {late ? <Flame size={11} /> : <Clock size={11} />}
            {minutes === 0 ? "just now" : `${minutes}m`}
            {late ? " · running late" : ""}
          </div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", CHIP_TONES[step === 0 ? "orange" : step === 1 ? "amber" : "green"])}>
          {ticket.status === "preparing" ? "cooking" : ticket.status}
        </span>
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {ticket.lines.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-2 text-[13px]">
            <span className="min-w-0">
              <span className="font-bold text-[var(--brand-ink)]">{line.name}</span>
              {line.note ? <span className="block text-[11px] font-semibold text-[#ea580c]">{line.note}</span> : null}
            </span>
            <span className="shrink-0 font-black tabular-nums text-[var(--brand-ink)]">
              {line.qty}{line.unit && line.unit !== "piece" ? ` ${line.unit}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <Button size="sm" className="mt-3 h-9 w-full gap-1.5 rounded-[8px] text-[12px] font-black" onClick={onAdvance}>
        <Utensils size={13} /> {actionLabel}
      </Button>
    </article>
  );
}
