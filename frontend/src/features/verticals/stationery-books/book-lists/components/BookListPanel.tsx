import { useEffect, useMemo, useState } from "react";
import { BookOpen, GripVertical, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, useQuantityDraft } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { useListProducts } from "@/features/core/products/queries";
import type { BookList, BookListInput, BookListOptions } from "@/types/api";

interface DraftLine {
  productId: string | null;
  name: string;
  qty: number;
  unit: string;
  isOptional: boolean;
}

function emptyLine(overrides: Partial<DraftLine> = {}): DraftLine {
  return { productId: null, name: "", qty: 1, unit: "piece", isOptional: false, ...overrides };
}

export function BookListPanel({ open, editing, saving, options, onClose, onSubmit }: {
  open: boolean;
  editing: BookList | null;
  saving: boolean;
  options: BookListOptions;
  onClose: () => void;
  onSubmit: (data: BookListInput) => void;
}) {
  const [schoolName, setSchoolName] = useState("");
  const [className, setClassName] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { width, isResizing: _isResizing, onResizeStart } = usePanelResize("kirana:book-list-panel-width", { defaultWidth: 520 });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPick("");
    if (editing) {
      setSchoolName(editing.schoolName);
      setClassName(editing.className);
      setAcademicYear(editing.academicYear);
      setName(editing.name ?? "");
      setNotes(editing.notes ?? "");
      setIsActive(editing.isActive);
      setLines(editing.items.map((item) => emptyLine({
        productId: item.productId ?? null,
        name: item.productName ?? item.name,
        qty: Number(item.qty) || 1,
        unit: item.unit || "piece",
        isOptional: Boolean(item.isOptional),
      })));
      return;
    }
    setSchoolName("");
    setClassName("");
    // Default to the most recent year the shop has used, which is almost always
    // the one they are entering lists for.
    setAcademicYear(options.years[0] ?? "");
    setName("");
    setNotes("");
    setIsActive(true);
    setLines([emptyLine()]);
  }, [open, editing, options.years]);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];

  const matches = useMemo(() => {
    const term = pick.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) => product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, pick]);

  function addFromCatalogue(productId: string) {
    const product = catalogue.find((row) => row.id === productId);
    if (!product) return;
    setPick("");
    setError(null);
    setLines((prev) => {
      const line = emptyLine({
        productId: product.id,
        name: product.name,
        unit: product.displayUnit || product.rateUnit || "piece",
      });
      const blank = prev.findIndex((entry) => !entry.name.trim());
      if (blank === -1) return [...prev, line];
      return prev.map((entry, index) => (index === blank ? line : entry));
    });
  }

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== index)));
  }

  function move(index: number, by: number) {
    setLines((prev) => {
      const next = [...prev];
      const target = index + by;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const filled = lines.filter((line) => line.name.trim());
    if (!schoolName.trim()) return setError("Enter the school.");
    if (!className.trim()) return setError("Enter the class.");
    if (!/^\d{4}(-\d{2,4})?$/.test(academicYear.trim())) return setError("Write the academic year as 2026-27.");
    if (filled.some((line) => !(line.qty > 0))) return setError("Every line needs a quantity above zero.");
    setError(null);

    onSubmit({
      schoolName: schoolName.trim(),
      className: className.trim(),
      academicYear: academicYear.trim(),
      name: name.trim() || null,
      notes: notes.trim() || null,
      isActive,
      // Order is the document: a list is read aloud subject by subject.
      items: filled.map((line, index) => ({
        productId: line.productId,
        name: line.name.trim(),
        qty: line.qty,
        unit: line.unit.trim() || "piece",
        isOptional: line.isOptional,
        sortOrder: index,
      })),
    });
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-[100dvh] w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Edit book list" : "New book list"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
            {editing ? `Edit ${editing.label}` : "New book list"}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Type the school's list once — it answers every parent who asks for it</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <SectionTitle>Which class</SectionTitle>
            <Fld label="School *">
              <input
                list="book-list-schools"
                className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                placeholder="Delhi Public School"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
              />
              <datalist id="book-list-schools">{options.schools.map((s) => <option key={s} value={s} />)}</datalist>
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Class *">
                <input
                  list="book-list-classes"
                  className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  placeholder="Class 6"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                />
                <datalist id="book-list-classes">{options.classes.map((c) => <option key={c} value={c} />)}</datalist>
              </Fld>
              <Fld label="Academic year *" hint="Written as 2026-27">
                <input
                  list="book-list-years"
                  className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  placeholder="2026-27"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                />
                <datalist id="book-list-years">{options.years.map((y) => <option key={y} value={y} />)}</datalist>
              </Fld>
            </div>
            <Fld label="Label (optional)" hint="Only when one class has two lists — e.g. Science stream">
              <Input className="h-10" placeholder="Science stream" value={name} onChange={(e) => setName(e.target.value)} />
            </Fld>
          </section>

          <section className="space-y-3">
            <SectionTitle>What's on the list</SectionTitle>

            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-10 pl-8" placeholder="Search your stock to add a line…" value={pick} onChange={(e) => setPick(e.target.value)} />
              {pick.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                  {matches.length === 0 ? (
                    <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">
                      Nothing matches. Type the name into a line below — a list can name a book you don't stock, and it will show as one to order.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#eef2f8]">
                      {matches.map((product) => (
                        <li key={product.id}>
                          <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]" onClick={() => addFromCatalogue(product.id)}>
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><BookOpen size={15} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                              {product.sku && <span className="block truncate text-[11px] text-[#8492ac]">{product.sku}</span>}
                            </span>
                            <Plus size={14} className="shrink-0 text-[#8492ac]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#e7edf7] p-2.5">
                  <div className="flex shrink-0 flex-col">
                    <button type="button" className="grid h-4 w-5 place-items-center text-[#a3b0c6] hover:text-[#536583] disabled:opacity-30" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move line ${index + 1} up`}>▲</button>
                    <button type="button" className="grid h-4 w-5 place-items-center text-[#a3b0c6] hover:text-[#536583] disabled:opacity-30" onClick={() => move(index, 1)} disabled={index === lines.length - 1} aria-label={`Move line ${index + 1} down`}>▼</button>
                  </div>
                  <Input
                    className="h-9 min-w-[140px] flex-1"
                    placeholder="Book or item name"
                    value={line.name}
                    onChange={(e) => patchLine(index, { name: e.target.value, productId: null })}
                    aria-label={`Line ${index + 1}`}
                  />
                  <LineQuantity qty={line.qty} onChange={(qty) => patchLine(index, { qty })} label={`Quantity for line ${index + 1}`} />
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#52627e]">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--brand)]"
                      checked={line.isOptional}
                      onChange={(e) => patchLine(index, { isOptional: e.target.checked })}
                    />
                    optional
                  </label>
                  <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50" onClick={() => removeLine(index)} aria-label={`Remove line ${index + 1}`}><X size={14} /></button>
                  {line.productId === null && line.name.trim() && (
                    <p className="w-full text-[10.5px] text-amber-700">Not linked to your stock — it will show as an item to order.</p>
                  )}
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" className="h-9 w-full gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus size={14} /> Add a line
            </Button>
            <p className="flex items-start gap-1.5 text-[11px] text-[#8492ac]">
              <GripVertical size={12} className="mt-[1px] shrink-0" />
              Keep them in the order the school published — the list is read aloud that way at the counter.
            </p>
          </section>

          <section className="space-y-3">
            <SectionTitle>Notes</SectionTitle>
            <Fld label="Anything to remember (optional)">
              <Textarea className="min-h-[60px] resize-y" placeholder="Covers supplied by the school, collection dates…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Fld>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3">
              <input type="checkbox" className="mt-[3px] h-4 w-4 accent-[var(--brand)]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>
                <span className="block text-[12.5px] font-bold text-[var(--brand-ink)]">Offer this list at the counter</span>
                <span className="mt-0.5 block text-[11px] text-[#8492ac]">
                  Turn it off for a past year. It stays on the books, and next year's copy can still start from it.
                </span>
              </span>
            </label>
          </section>

          {error && <p role="alert" className="rounded-[10px] bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700">{error}</p>}
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#eef1f6] bg-white px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-12px_30px_rgba(15,35,80,0.06)]">
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className="h-11 min-w-0 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={saving}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className={cn("h-11 min-w-0 gap-2 rounded-[10px] font-black text-white hover:opacity-95")}
            >
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><BookOpen size={15} /> {editing ? "Save Changes" : "Save List"}</>}
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

// Per-row draft: a hook cannot run inside the lines.map callback. Zero is not
// offered — submit already refuses a line without a quantity above zero.
function LineQuantity({ qty, onChange, label }: { qty: number; onChange: (next: number) => void; label: string }) {
  const props = useQuantityDraft(qty, onChange);
  return <Input className="h-9 w-[64px]" type="number" inputMode="decimal" step="1" aria-label={label} {...props} />;
}
