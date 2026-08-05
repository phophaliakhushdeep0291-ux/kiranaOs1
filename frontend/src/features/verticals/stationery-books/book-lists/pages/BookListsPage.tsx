import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Check, CircleAlert, ClipboardList, Copy, GraduationCap, Loader2,
  Plus, Receipt, School, Search, ShoppingCart, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import { useListProducts } from "@/features/core/products/queries";
import {
  copyBookList, createBookList, deleteBookList, getBookListOptions,
  getBookListShortfall, getBookListSummary, listBookLists, updateBookList,
} from "@/features/verticals/stationery-books/book-lists/api";
import { openBookListInBilling } from "@/features/verticals/stationery-books/book-lists/service/open-list-in-billing";
import { BookListPanel } from "@/features/verticals/stationery-books/book-lists/components/BookListPanel";
import type { BookList, BookListInput } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function BookListsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isOnline } = useOfflineStatus();

  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<BookList | null>(null);
  const [copying, setCopying] = useState<BookList | null>(null);
  const [deleting, setDeleting] = useState<BookList | null>(null);
  const [showOrders, setShowOrders] = useState(false);

  const listsQ = useQuery({ queryKey: ["book-lists"], queryFn: () => listBookLists() });
  const summaryQ = useQuery({ queryKey: ["book-lists", "summary"], queryFn: getBookListSummary });
  const optionsQ = useQuery({ queryKey: ["book-lists", "options"], queryFn: getBookListOptions });
  const shortfallQ = useQuery({
    queryKey: ["book-lists", "shortfall"],
    queryFn: () => getBookListShortfall(),
    enabled: showOrders,
  });
  // Loaded for the billing handoff: a cart line needs the live product row.
  const productsQ = useListProducts({ limit: 500 });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["book-lists"] });

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) {
        return toast({ title: "You're offline", description: "Looking a list up works offline; saving one needs a connection.", variant: "destructive" });
      }
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    };
  }

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: BookListInput }) =>
      (vars.id ? updateBookList(vars.id, vars.data) : createBookList(vars.data)),
    onSuccess: (list) => {
      invalidate();
      setPanelOpen(false);
      setEditing(null);
      toast({ title: `${list.label} saved`, description: list.isComplete ? "Every book on it is in stock." : `${list.shortCount} item${list.shortCount === 1 ? "" : "s"} short.` });
    },
    onError: failure("Could not save the list"),
  });

  const copyMut = useMutation({
    mutationFn: (vars: { id: string; academicYear: string }) => copyBookList(vars.id, { academicYear: vars.academicYear }),
    onSuccess: (list) => { invalidate(); setCopying(null); toast({ title: `Copied to ${list.academicYear}` }); },
    onError: failure("Could not copy the list"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBookList(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "List moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const billMut = useMutation({
    mutationFn: (list: BookList) => openBookListInBilling(list, productsQ.data ?? []),
    onSuccess: (result) => {
      toast({
        title: `${result.added} item${result.added === 1 ? "" : "s"} on the bill`,
        description: result.skipped.length
          ? `Not added, because you don't stock ${result.skipped.length === 1 ? "it" : "them"}: ${result.skipped.join(", ")}`
          : undefined,
      });
      setLocation("/billing");
    },
    onError: () => toast({ title: "Could not open the bill", description: "Try again", variant: "destructive" }),
  });

  const lists = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (listsQ.data ?? [])
      .filter((list) => (!year || list.academicYear === year))
      .filter((list) => (!term
        || list.label.toLowerCase().includes(term)
        || list.items.some((item) => item.name.toLowerCase().includes(term))));
  }, [listsQ.data, search, year]);

  const summary = summaryQ.data;
  const years = optionsQ.data?.years ?? [];

  return (
    <div className="app-docked-page">
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Offline — showing the lists last saved on this device, with the stock counts they had then. Saving or copying a list needs a connection.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<ClipboardList size={16} />} label="Lists" value={String(summary?.lists ?? 0)} tone="blue" />
          <Kpi icon={<School size={16} />} label="Schools" value={String(summary?.schools ?? 0)} tone="violet" />
          <Kpi icon={<Check size={16} />} label="Ready to hand over" value={String(summary?.completeLists ?? 0)} tone="green" />
          <Kpi
            icon={<CircleAlert size={16} />}
            label="Lists you can't fill"
            value={String(summary?.shortLists ?? 0)}
            tone={summary?.shortLists ? "amber" : "green"}
          />
        </div>

        {summary && summary.itemsToOrder > 0 && (
          <button
            onClick={() => setShowOrders(true)}
            className="flex w-full items-center gap-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-amber-100 text-amber-700"><ShoppingCart size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-amber-900">
                {summary.itemsToOrder} item{summary.itemsToOrder === 1 ? "" : "s"} to order — {summary.unitsToOrder} unit{summary.unitsToOrder === 1 ? "" : "s"} in all
              </span>
              <span className="block text-[11.5px] text-amber-800">Across every active list. Tap to see what to buy before term starts.</span>
            </span>
          </button>
        )}

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Class book lists</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">"Class 6, DPS" — the whole set on one bill, with what you are short of named up front.</p>
            </div>
            <Button
              onClick={() => { setEditing(null); setPanelOpen(true); }}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95"
            >
              <Plus size={15} /> New List
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] px-5 py-3">
            <select
              className="h-9 rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[12px] font-semibold text-[#344668] outline-none focus:border-[var(--brand)]"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Academic year"
            >
              <option value="">Every year</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[300px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-9 pl-8" placeholder="School, class, or a book on the list" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {listsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : listsQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load the lists. Check your connection.</div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><GraduationCap size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">
                {(listsQ.data ?? []).length === 0 ? "No book lists yet" : "Nothing matches this filter"}
              </p>
              <p className="max-w-[440px] text-[12px] text-[#64748b]">
                {(listsQ.data ?? []).length === 0
                  ? "Type up a school's class list once. After that a parent says \"Class 6, DPS\" and the whole set goes on the bill — and you know what you're short of before they walk in."
                  : "Try another year, or clear the search."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#eef2f8]">
              {lists.map((list) => (
                <ListRow
                  key={list.id}
                  list={list}
                  billing={billMut.isPending}
                  onBill={() => billMut.mutate(list)}
                  onEdit={() => { setEditing(list); setPanelOpen(true); }}
                  onCopy={() => setCopying(list)}
                  onDelete={() => setDeleting(list)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <BookListPanel
        open={panelOpen}
        editing={editing}
        saving={saveMut.isPending}
        options={optionsQ.data ?? { schools: [], classes: [], years: [] }}
        onClose={() => { setPanelOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <CopyDialog
        list={copying}
        saving={copyMut.isPending}
        onClose={() => setCopying(null)}
        onConfirm={(academicYear) => copying && copyMut.mutate({ id: copying.id, academicYear })}
      />

      <Dialog open={showOrders} onOpenChange={setShowOrders}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">What to order</DialogTitle></DialogHeader>
          {shortfallQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Adding it up…</div>
          ) : (shortfallQ.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-[13px] font-semibold text-emerald-700">Every list can be filled from stock.</p>
          ) : (
            <ul className="max-h-[400px] space-y-1.5 overflow-y-auto">
              {(shortfallQ.data ?? []).map((row) => (
                <li key={row.productId ?? row.name} className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-bold text-[var(--brand-ink)]">{row.name}</span>
                    <span className="text-[12.5px] font-black text-amber-700">order {row.shortBy}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#8492ac]">
                    {row.inCatalogue ? `${row.available} in stock · ` : "Not in your catalogue · "}
                    needed by {row.lists.length} list{row.lists.length === 1 ? "" : "s"}: {row.lists.join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this list?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            {deleting?.label} and its {deleting?.itemCount} line{deleting?.itemCount === 1 ? "" : "s"} will move to the recycle bin. If the school simply stopped using it, switch it off instead — next year's copy starts from it.
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

function ListRow({ list, billing, onBill, onEdit, onCopy, onDelete }: {
  list: BookList;
  billing: boolean;
  onBill: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((value) => !value)}>
          <p className="font-bold text-[var(--brand-ink)]">{list.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#8492ac]">
            <span className="rounded-[6px] bg-[#f1f5fa] px-1.5 py-0.5 font-bold text-[#52627e]">{list.academicYear}</span>
            <span>{list.itemCount} item{list.itemCount === 1 ? "" : "s"}</span>
            {list.estimatedTotal > 0 && <span>· {inr(list.estimatedTotal)}</span>}
            {!list.isActive && <span className="text-amber-700">· archived</span>}
          </p>
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {list.isComplete ? (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.green)}>All in stock</span>
          ) : (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.amber)}>
              {list.shortCount} short
            </span>
          )}
          <Button
            variant="outline"
            className="h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold"
            disabled={billing || list.itemCount === 0}
            onClick={onBill}
          >
            <Receipt size={13} /> Put on a bill
          </Button>
          <button onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Edit ${list.label}`}><BookOpen size={14} /></button>
          <button onClick={onCopy} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Copy ${list.label} to another year`}><Copy size={14} /></button>
          <button onClick={onDelete} className="grid h-8 w-8 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Delete ${list.label}`}><Trash2 size={14} /></button>
        </div>
      </div>

      {!list.isComplete && list.missing.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-amber-800">
          Short: {list.missing.map((item) => `${item.name}${item.shortBy > 1 ? ` ×${item.shortBy}` : ""}`).join(", ")}
        </p>
      )}

      {open && (
        <ul className="mt-2.5 space-y-1 rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
          {list.items.map((item, index) => (
            <li key={item.id ?? index} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.isReady ? "bg-emerald-500" : "bg-rose-400")} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[#344668]">
                <span className="font-semibold">{item.qty}</span> × {item.productName ?? item.name}
                {item.isOptional && <span className="ml-1 text-[10.5px] text-[#8492ac]">(optional)</span>}
              </span>
              <span className={cn("text-[11px] font-semibold", item.isReady ? "text-emerald-700" : "text-rose-600")}>
                {item.inCatalogue ? (item.isReady ? `${item.available} in stock` : `${item.available} left, short ${item.shortBy}`) : "not stocked"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyDialog({ list, saving, onClose, onConfirm }: {
  list: BookList | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (academicYear: string) => void;
}) {
  const [year, setYear] = useState("");

  /** Next year, guessed from this one: "2026-27" → "2027-28". */
  const suggestion = useMemo(() => {
    if (!list) return "";
    const match = /^(\d{4})(?:-(\d{2,4}))?$/.exec(list.academicYear);
    if (!match) return "";
    const start = Number(match[1]) + 1;
    if (!match[2]) return String(start);
    const width = match[2].length;
    const end = start + 1;
    return `${start}-${width === 2 ? String(end).slice(-2) : String(end)}`;
  }, [list]);

  return (
    <Dialog open={list !== null} onOpenChange={(open) => { if (!open) { setYear(""); onClose(); } }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Copy to another year</DialogTitle></DialogHeader>
        {list && (
          <div className="space-y-3">
            <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5 text-[12px] text-[#52627e]">
              <p className="font-bold text-[var(--brand-ink)]">{list.label}</p>
              <p className="mt-0.5">{list.itemCount} line{list.itemCount === 1 ? "" : "s"} will be copied. The copy is its own list — editing it leaves this one alone.</p>
            </div>
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">New academic year</Label>
              <Input className="h-10" placeholder={suggestion || "2027-28"} value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="flex gap-2.5 pt-1">
              <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
              <Button
                className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95"
                style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
                disabled={saving || !(year.trim() || suggestion)}
                onClick={() => onConfirm(year.trim() || suggestion)}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Copy
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
  tone: "blue" | "violet" | "green" | "amber";
}) {
  const ring =
    tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : tone === "violet" ? "bg-violet-50 text-violet-600"
        : tone === "amber" ? "bg-amber-50 text-amber-600"
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
