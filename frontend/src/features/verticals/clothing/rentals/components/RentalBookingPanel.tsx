import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Check, Loader2, Minus, Plus, Search, Shirt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, useMoneyDraft } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { getRentalAvailability } from "@/features/verticals/clothing/rentals/api";
import type { RentalBooking, RentalBookingInput, RentalIdProofType } from "@/types/api";

/** Local YYYY-MM-DD — never toISOString(), which shifts the day backwards east of UTC. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function daysInclusive(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

const ID_PROOFS: Array<{ key: RentalIdProofType; label: string }> = [
  { key: "aadhaar", label: "Aadhaar" },
  { key: "pan", label: "PAN" },
  { key: "driving_licence", label: "Driving licence" },
  { key: "voter_id", label: "Voter ID" },
  { key: "other", label: "Other" },
];

interface DraftItem {
  productId: string | null;
  name: string;
  unit: string;
  qty: number;
  ratePerDay: number;
}

export function RentalBookingPanel({ open, editing, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean;
  editing: RentalBooking | null;
  saving: boolean;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  onSubmit: (data: RentalBookingInput) => void;
}) {
  const today = dayKey(new Date());
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [idProofType, setIdProofType] = useState<RentalIdProofType | "">("");
  const [idProofNumber, setIdProofNumber] = useState("");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [depositAmount, setDepositAmount] = useState("0");
  const [advancePaid, setAdvancePaid] = useState("0");
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reloading the form from the record each time the panel opens keeps a half-typed
  // walk-in from leaking into the next booking.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setItemSearch("");
    if (editing) {
      setCustomerName(editing.customerName);
      setCustomerPhone(editing.customerPhone);
      setCustomerAddress(editing.customerAddress ?? "");
      setIdProofType(editing.idProofType ?? "");
      setIdProofNumber(editing.idProofNumber ?? "");
      setFromDate(editing.fromDateKey);
      setToDate(editing.toDateKey);
      setItems(editing.items.map((i) => ({
        productId: i.productId ?? null,
        name: i.name,
        unit: i.unit,
        qty: Number(i.qty) || 1,
        ratePerDay: Number(i.ratePerDay) || 0,
      })));
      setDepositAmount(String(editing.depositAmount ?? 0));
      setAdvancePaid(String(editing.advancePaid ?? 0));
      setNotes(editing.notes ?? "");
      return;
    }
    const fresh = dayKey(new Date());
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setIdProofType("");
    setIdProofNumber("");
    setFromDate(fresh);
    setToDate(fresh);
    setItems([]);
    setDepositAmount("0");
    setAdvancePaid("0");
    setNotes("");
  }, [open, editing]);

  // Picking a start date after the return date is a slip, not a choice — carry the
  // return date along instead of rejecting it later.
  useEffect(() => {
    if (toDate < fromDate) setToDate(fromDate);
  }, [fromDate, toDate]);

  const validWindow = Boolean(fromDate && toDate && toDate >= fromDate);
  const availabilityQ = useQuery({
    queryKey: ["rentals", "availability", fromDate, toDate, editing?.id ?? null],
    queryFn: () => getRentalAvailability(fromDate, toDate, editing?.id),
    enabled: open && validWindow,
  });

  const days = daysInclusive(fromDate, toDate);
  const rentAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.qty * item.ratePerDay * days, 0),
    [items, days],
  );

  const catalogue = availabilityQ.data?.items ?? [];
  const chosen = useMemo(() => new Map(items.filter((i) => i.productId).map((i) => [i.productId as string, i])), [items]);
  /** productId → photo, so a chosen line can show the garment without storing a copy of it. */
  const imageFor = useMemo(
    () => new Map(catalogue.filter((row) => row.imageUrl).map((row) => [row.productId, row.imageUrl as string])),
    [catalogue],
  );

  const visible = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    return catalogue
      // Fully-booked garments stay listed but disabled, so the counter can say
      // "it's out until the 14th" instead of "I can't find it".
      .filter((row) => (term ? row.name.toLowerCase().includes(term) || (row.category ?? "").toLowerCase().includes(term) : true))
      .slice(0, 60);
  }, [catalogue, itemSearch]);

  function addItem(productId: string) {
    const row = catalogue.find((r) => r.productId === productId);
    if (!row) return;
    setError(null);
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (existing) {
        if (existing.qty + 1 > row.available) return prev;
        return prev.map((i) => (i.productId === productId ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { productId, name: row.name, unit: row.unit, qty: 1, ratePerDay: row.pricePerDay }];
    });
  }

  function setQty(productId: string | null, qty: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty } : i))
        .filter((i) => i.qty > 0),
    );
  }

  function setRate(productId: string | null, ratePerDay: number) {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, ratePerDay } : i)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerName.trim()) return setError("Enter the renter's name.");
    if (!/^\d{10}$/.test(customerPhone.replace(/\D/g, "").slice(-10))) return setError("Enter a 10-digit mobile number.");
    if (!customerAddress.trim()) return setError("Enter the renter's address.");
    if (!validWindow) return setError("Check the booking dates.");
    if (items.length === 0) return setError("Add at least one item to rent.");
    setError(null);

    onSubmit({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerAddress: customerAddress.trim(),
      idProofType: idProofType || null,
      idProofNumber: idProofNumber.trim() || null,
      fromDate,
      toDate,
      items: items.map((i) => ({
        productId: i.productId,
        name: i.name,
        unit: i.unit,
        qty: i.qty,
        ratePerDay: i.ratePerDay,
        amount: Math.round(i.qty * i.ratePerDay * days * 100) / 100,
      })),
      rentAmount: Math.round(rentAmount * 100) / 100,
      depositAmount: Number(depositAmount) || 0,
      advancePaid: Number(advancePaid) || 0,
      notes: notes.trim() || null,
    });
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit rental booking" : "New rental booking"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
            {editing ? `Edit ${editing.bookingNumber}` : "New Rental Booking"}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Who is taking it, where they live, and for which days</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Renter ── */}
          <section className="space-y-3">
            <SectionTitle>Renter details</SectionTitle>
            <Fld label="Full name *">
              <Input className="h-10" placeholder="E.g., Priya Sharma" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </Fld>
            <Fld label="Mobile number *" hint="Used to remind them when the return date is near">
              <Input className="h-10" type="tel" inputMode="numeric" placeholder="10-digit mobile" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </Fld>
            <Fld label="Address *" hint="Where the outfit can be traced if it is not returned">
              <Textarea className="min-h-[70px] resize-y" placeholder="House / street, area, city" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="ID proof (optional)">
                <select
                  className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  value={idProofType}
                  onChange={(e) => setIdProofType(e.target.value as RentalIdProofType | "")}
                >
                  <option value="">None</option>
                  {ID_PROOFS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Fld>
              <Fld label="ID number">
                <Input className="h-10" placeholder="Last 4 digits are enough" value={idProofNumber} onChange={(e) => setIdProofNumber(e.target.value)} disabled={!idProofType} />
              </Fld>
            </div>
          </section>

          {/* ── Dates ── */}
          <section className="space-y-3">
            <SectionTitle>Rental dates</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Needed from *">
                <Input className="h-10" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Fld>
              <Fld label="Return by *">
                <Input className="h-10" type="date" min={fromDate} value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </Fld>
            </div>
            <p className="flex items-center gap-1.5 rounded-[10px] bg-[var(--brand-soft)] px-3 py-2 text-[11.5px] font-semibold text-[var(--brand)]">
              <CalendarRange size={13} />
              {days} day{days === 1 ? "" : "s"} — both dates included. These items stay hidden from customers until they come back.
            </p>
          </section>

          {/* ── Items ── */}
          <section className="space-y-3">
            <SectionTitle>Items to rent</SectionTitle>

            {items.length > 0 && (
              <div className="space-y-2 rounded-[12px] border border-[#e7edf7] p-3">
                {items.map((item) => (
                  <div key={item.productId ?? item.name} className="flex flex-wrap items-center gap-2">
                    {/* Resolved from the catalogue at render, not carried on the
                        draft: an existing booking being edited never had one to
                        carry, and this way both paths show the same picture. */}
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]">
                      {imageFor.get(item.productId ?? "")
                        ? <img src={imageFor.get(item.productId ?? "")!} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                        : <Shirt size={15} aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{item.name}</p>
                      <p className="text-[11px] text-[#8492ac]">{inr(item.ratePerDay)}/day × {days} day{days === 1 ? "" : "s"}</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-[8px] border border-[#e2e8f0]">
                      <button type="button" className="grid h-8 w-8 place-items-center text-[#536583] hover:bg-[#f1f4f8]" onClick={() => setQty(item.productId, item.qty - 1)} aria-label={`Reduce ${item.name}`}><Minus size={13} /></button>
                      <span className="min-w-[26px] text-center text-[12.5px] font-bold text-[var(--brand-ink)]">{item.qty}</span>
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center text-[#536583] hover:bg-[#f1f4f8] disabled:opacity-40"
                        onClick={() => item.productId && addItem(item.productId)}
                        disabled={!item.productId || item.qty >= (catalogue.find((r) => r.productId === item.productId)?.available ?? item.qty)}
                        aria-label={`Add another ${item.name}`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <LineRate
                      rate={item.ratePerDay}
                      onChange={(rate) => setRate(item.productId, rate)}
                      label={`Per-day rent for ${item.name}`}
                    />
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" onClick={() => setQty(item.productId, 0)} aria-label={`Remove ${item.name}`}><X size={14} /></button>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-[#eef2f8] pt-2 text-[12.5px]">
                  <span className="font-semibold text-[#52627e]">Rent for {days} day{days === 1 ? "" : "s"}</span>
                  <span className="font-display text-[15px] font-black text-[var(--brand-ink)]">{inr(rentAmount)}</span>
                </div>
              </div>
            )}

            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-10 pl-8" placeholder="Search your catalogue…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
            </div>

            <div className="max-h-[290px] overflow-y-auto rounded-[12px] border border-[#e7edf7]">
              {!validWindow ? (
                <p className="px-3.5 py-6 text-center text-[12px] text-[#8492ac]">Pick the dates first to see what is free.</p>
              ) : availabilityQ.isLoading ? (
                <p className="flex items-center justify-center gap-2 px-3.5 py-6 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Checking what's free…</p>
              ) : availabilityQ.isError ? (
                <p className="px-3.5 py-6 text-center text-[12px] text-rose-600">Couldn't check availability. Check your connection.</p>
              ) : visible.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[12px] text-[#8492ac]">
                  {catalogue.length === 0 ? "No products in your catalogue yet." : "Nothing matches that search."}
                </p>
              ) : (
                <ul className="divide-y divide-[#eef2f8]">
                  {visible.map((row) => {
                    const inCart = chosen.get(row.productId)?.qty ?? 0;
                    const soldOut = row.available <= 0;
                    const maxedOut = inCart >= row.available;
                    return (
                      <li key={row.productId} className={cn("flex items-center gap-3 px-3.5 py-2.5", soldOut && "opacity-60")}>
                        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]">
                          {row.imageUrl
                            ? <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
                            : <Shirt size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{row.name}</p>
                          <p className="text-[11px] text-[#8492ac]">
                            {row.owned === 0
                              ? "No stock — add it to inventory first"
                              : soldOut
                                ? `All ${row.owned} booked for these dates`
                                : `${row.available} of ${row.owned} free · ${inr(row.pricePerDay)}/day`}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 shrink-0 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold"
                          disabled={soldOut || maxedOut}
                          onClick={() => addItem(row.productId)}
                        >
                          {inCart > 0 ? <><Check size={13} /> {inCart}</> : <><Plus size={13} /> Add</>}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* ── Money ── */}
          <section className="space-y-3">
            <SectionTitle>Payment</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Security deposit (₹)" hint="Refundable at return">
                <Input className="h-10" type="number" min="0" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              </Fld>
              <Fld label="Advance paid (₹)">
                <Input className="h-10" type="number" min="0" step="0.01" value={advancePaid} onChange={(e) => setAdvancePaid(e.target.value)} />
              </Fld>
            </div>
            <div className="flex items-center justify-between rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
              <span className="text-[12px] font-semibold text-[#52627e]">Balance to collect</span>
              <span className="font-display text-[16px] font-black text-[var(--brand-ink)]">
                {inr(Math.max(0, rentAmount - (Number(advancePaid) || 0)))}
              </span>
            </div>
            <Fld label="Notes (optional)">
              <Textarea className="min-h-[60px] resize-y" placeholder="Alterations, occasion, anything to remember" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Fld>
          </section>

          {error && <p role="alert" className="rounded-[10px] bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700">{error}</p>}
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Shirt size={15} /> {editing ? "Save Changes" : "Book Now"}</>}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-black uppercase tracking-wider text-[#8492ac]">{children}</h3>;
}

function Fld({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#9aa6bb]">{hint}</p>}
    </div>
  );
}

// A hook cannot run inside the items.map callback, so each row owns its draft.
// Zero is allowed: a rent of zero is a real, if unusual, answer.
function LineRate({ rate, onChange, label }: { rate: number; onChange: (next: number) => void; label: string }) {
  const props = useMoneyDraft(rate, onChange);
  return <Input className="h-8 w-[92px]" type="number" inputMode="decimal" step="0.01" aria-label={label} {...props} />;
}
