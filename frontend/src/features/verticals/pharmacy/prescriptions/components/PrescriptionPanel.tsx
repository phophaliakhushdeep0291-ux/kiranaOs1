import { useEffect, useMemo, useState } from "react";
import { ClipboardPlus, Loader2, Pill, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelResizeHandle } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { useListProducts } from "@/features/core/products/queries";
import type {
  Prescription,
  PrescriptionGender,
  PrescriptionInput,
  PrescriptionScheduleType,
} from "@/types/api";

/** Local YYYY-MM-DD — never toISOString(), which shifts the day backwards east of UTC. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const SCHEDULES: Array<{ key: PrescriptionScheduleType; label: string; hint: string }> = [
  { key: "h", label: "Schedule H", hint: "Prescription-only. The register must be kept." },
  { key: "h1", label: "Schedule H1", hint: "Separate register, retained 3 years. Antibiotics, habit-forming drugs." },
  { key: "x", label: "Schedule X", hint: "Strictest. Duplicate prescription retained 2 years." },
  { key: "otc", label: "Over the counter", hint: "No prescription needed — recorded for the shop's own reference." },
  { key: "other", label: "Other", hint: "Anything that does not fit the schedules above." },
];

const GENDERS: Array<{ key: PrescriptionGender; label: string }> = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "other", label: "Other" },
];

interface DraftItem {
  productId: string | null;
  name: string;
  strength: string;
  dosage: string;
  qty: number;
  unit: string;
  batchNumber: string;
  substitutedFor: string;
}

function emptyItem(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    productId: null, name: "", strength: "", dosage: "", qty: 1,
    unit: "strip", batchNumber: "", substitutedFor: "", ...overrides,
  };
}

export function PrescriptionPanel({ open, editing, saving, width, onResizeStart, onClose, onSubmit }: {
  open: boolean;
  editing: Prescription | null;
  saving: boolean;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  onSubmit: (data: PrescriptionInput) => void;
}) {
  const [doctorName, setDoctorName] = useState("");
  const [doctorRegNo, setDoctorRegNo] = useState("");
  const [doctorClinic, setDoctorClinic] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState<PrescriptionGender | "">("");
  const [patientAddress, setPatientAddress] = useState("");
  const [scheduleType, setScheduleType] = useState<PrescriptionScheduleType>("h");
  const [prescribedOn, setPrescribedOn] = useState(dayKey(new Date()));
  const [refillsAllowed, setRefillsAllowed] = useState("0");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [notes, setNotes] = useState("");
  const [dispenseNow, setDispenseNow] = useState(true);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reloading the form from the record each time the panel opens keeps one
  // patient's details from leaking into the next entry.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setMedicineSearch("");
    if (editing) {
      setDoctorName(editing.doctorName);
      setDoctorRegNo(editing.doctorRegNo ?? "");
      setDoctorClinic(editing.doctorClinic ?? "");
      setPatientName(editing.patientName);
      setPatientPhone(editing.patientPhone ?? "");
      setPatientAge(editing.patientAge ?? "");
      setPatientGender(editing.patientGender ?? "");
      setPatientAddress(editing.patientAddress ?? "");
      setScheduleType(editing.scheduleType);
      setPrescribedOn(editing.prescribedOnKey);
      setRefillsAllowed(String(editing.refillsAllowed ?? 0));
      setItems(editing.items.map((item) => emptyItem({
        productId: item.productId ?? null,
        name: item.name,
        strength: item.strength ?? "",
        dosage: item.dosage ?? "",
        qty: Number(item.qty) || 1,
        unit: item.unit || "strip",
        batchNumber: item.batchNumber ?? "",
        substitutedFor: item.substitutedFor ?? "",
      })));
      setNotes(editing.notes ?? "");
      // An existing entry is being corrected, not dispensed — hand-over is its
      // own action, so a correction must never silently mark it as given.
      setDispenseNow(false);
      return;
    }
    setDoctorName("");
    setDoctorRegNo("");
    setDoctorClinic("");
    setPatientName("");
    setPatientPhone("");
    setPatientAge("");
    setPatientGender("");
    setPatientAddress("");
    setScheduleType("h");
    setPrescribedOn(dayKey(new Date()));
    setRefillsAllowed("0");
    setItems([emptyItem()]);
    setNotes("");
    setDispenseNow(true);
  }, [open, editing]);

  const productsQ = useListProducts({ limit: 500 }, { query: { enabled: open } });
  const catalogue = productsQ.data ?? [];

  const matches = useMemo(() => {
    const term = medicineSearch.trim().toLowerCase();
    if (!term) return [];
    return catalogue
      .filter((product) =>
        product.name.toLowerCase().includes(term)
        || (product.brand ?? "").toLowerCase().includes(term)
        || (product.sku ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [catalogue, medicineSearch]);

  function addFromCatalogue(productId: string) {
    const product = catalogue.find((row) => row.id === productId);
    if (!product) return;
    setMedicineSearch("");
    setError(null);
    setItems((prev) => {
      const line = emptyItem({
        productId: product.id,
        name: product.name,
        unit: product.displayUnit || product.rateUnit || "strip",
      });
      // The first line starts blank; filling it beats appending below it.
      const blankIndex = prev.findIndex((item) => !item.name.trim());
      if (blankIndex === -1) return [...prev, line];
      return prev.map((item, index) => (index === blankIndex ? line : item));
    });
  }

  function patchItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length === 1 ? [emptyItem()] : prev.filter((_, i) => i !== index)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const filled = items.filter((item) => item.name.trim());
    if (!doctorName.trim()) return setError("Enter the prescribing doctor's name.");
    if (!patientName.trim()) return setError("Enter the patient's name.");
    if (!prescribedOn) return setError("Enter the date written on the prescription.");
    if (filled.length === 0) return setError("Add at least one medicine.");
    if (filled.some((item) => !(item.qty > 0))) return setError("Every medicine needs a quantity above zero.");
    setError(null);

    onSubmit({
      doctorName: doctorName.trim(),
      doctorRegNo: doctorRegNo.trim() || null,
      doctorClinic: doctorClinic.trim() || null,
      patientName: patientName.trim(),
      patientPhone: patientPhone.trim() || null,
      patientAge: patientAge.trim() || null,
      patientGender: patientGender || null,
      patientAddress: patientAddress.trim() || null,
      scheduleType,
      prescribedOn,
      refillsAllowed: Number(refillsAllowed) || 0,
      items: filled.map((item) => ({
        productId: item.productId,
        name: item.name.trim(),
        strength: item.strength.trim() || null,
        dosage: item.dosage.trim() || null,
        qty: item.qty,
        unit: item.unit.trim() || "strip",
        batchNumber: item.batchNumber.trim() || null,
        substitutedFor: item.substitutedFor.trim() || null,
      })),
      notes: notes.trim() || null,
      ...(editing ? {} : { dispenseNow }),
    });
  }

  const schedule = SCHEDULES.find((entry) => entry.key === scheduleType);

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-[80] flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog"
      aria-label={editing ? "Correct prescription entry" : "New prescription entry"}
      aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[var(--brand-ink)]">
            {editing ? `Correct ${editing.registerNumber}` : "Record a prescription"}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">
            {editing
              ? "Corrections are kept in the audit trail alongside what the entry said before."
              : "Who prescribed it, for whom, and what is being handed over"}
          </p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Prescriber ── */}
          <section className="space-y-3">
            <SectionTitle>Prescribing doctor</SectionTitle>
            <Fld label="Doctor's name *">
              <Input className="h-10" placeholder="E.g., Dr A. Sharma" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Registration no." hint="What an inspection checks first">
                <Input className="h-10" placeholder="E.g., MCI-45231" value={doctorRegNo} onChange={(e) => setDoctorRegNo(e.target.value)} />
              </Fld>
              <Fld label="Clinic / hospital">
                <Input className="h-10" placeholder="E.g., City Clinic" value={doctorClinic} onChange={(e) => setDoctorClinic(e.target.value)} />
              </Fld>
            </div>
          </section>

          {/* ── Patient ── */}
          <section className="space-y-3">
            <SectionTitle>Patient</SectionTitle>
            <Fld label="Patient's name *">
              <Input className="h-10" placeholder="E.g., Ramesh Kumar" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            </Fld>
            <div className="grid grid-cols-3 gap-3">
              <Fld label="Mobile">
                <Input className="h-10" type="tel" inputMode="numeric" placeholder="10-digit" value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} />
              </Fld>
              <Fld label="Age" hint="Or “6 months”">
                <Input className="h-10" placeholder="E.g., 42" value={patientAge} onChange={(e) => setPatientAge(e.target.value)} />
              </Fld>
              <Fld label="Gender">
                <select
                  className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  value={patientGender}
                  onChange={(e) => setPatientGender(e.target.value as PrescriptionGender | "")}
                >
                  <option value="">—</option>
                  {GENDERS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </Fld>
            </div>
            <Fld label="Address" hint="Required in the register for Schedule H1 and X">
              <Textarea className="min-h-[60px] resize-y" placeholder="House / street, area, city" value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} />
            </Fld>
          </section>

          {/* ── The slip ── */}
          <section className="space-y-3">
            <SectionTitle>The prescription</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Dated *" hint="The date written on the slip">
                <Input className="h-10" type="date" max={dayKey(new Date())} value={prescribedOn} onChange={(e) => setPrescribedOn(e.target.value)} />
              </Fld>
              <Fld label="Repeats allowed" hint="Times it may be dispensed again">
                <Input className="h-10" type="number" min="0" max="24" value={refillsAllowed} onChange={(e) => setRefillsAllowed(e.target.value)} />
              </Fld>
            </div>
            <Fld label="Schedule">
              <select
                className="h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as PrescriptionScheduleType)}
              >
                {SCHEDULES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Fld>
            {schedule && (
              <p className="rounded-[10px] bg-[var(--brand-soft)] px-3 py-2 text-[11.5px] font-semibold text-[var(--brand)]">{schedule.hint}</p>
            )}
          </section>

          {/* ── Medicines ── */}
          <section className="space-y-3">
            <SectionTitle>Medicines dispensed</SectionTitle>

            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                className="h-10 pl-8"
                placeholder="Search your medicines…"
                value={medicineSearch}
                onChange={(e) => setMedicineSearch(e.target.value)}
              />
              {medicineSearch.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[220px] overflow-y-auto rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.10)]">
                  {productsQ.isLoading ? (
                    <p className="flex items-center justify-center gap-2 px-3.5 py-4 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Loading…</p>
                  ) : matches.length === 0 ? (
                    <p className="px-3.5 py-4 text-center text-[12px] text-[#8492ac]">
                      Nothing matches. Type the medicine name into a line below — the register does not need it to be in your catalogue.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#eef2f8]">
                      {matches.map((product) => (
                        <li key={product.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#f7f9fd]"
                            onClick={() => addFromCatalogue(product.id)}
                          >
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--brand-soft)] text-[var(--brand)]"><Pill size={15} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{product.name}</span>
                              {product.brand && <span className="block truncate text-[11px] text-[#8492ac]">{product.brand}</span>}
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

            <div className="space-y-2.5">
              {items.map((item, index) => (
                <div key={index} className="space-y-2 rounded-[12px] border border-[#e7edf7] p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      className="h-9 flex-1"
                      placeholder="Medicine name"
                      value={item.name}
                      onChange={(e) => patchItem(index, { name: e.target.value, productId: null })}
                      aria-label={`Medicine ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-rose-500 hover:bg-rose-50"
                      onClick={() => removeItem(index)}
                      aria-label={`Remove medicine ${index + 1}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input className="h-9" placeholder="500 mg" value={item.strength} onChange={(e) => patchItem(index, { strength: e.target.value })} aria-label={`Strength for medicine ${index + 1}`} />
                    <Input className="h-9" type="number" min="0" step="0.5" value={item.qty} onChange={(e) => patchItem(index, { qty: Number(e.target.value) || 0 })} aria-label={`Quantity for medicine ${index + 1}`} />
                    <Input className="h-9" placeholder="strip" value={item.unit} onChange={(e) => patchItem(index, { unit: e.target.value })} aria-label={`Unit for medicine ${index + 1}`} />
                    <Input className="h-9" placeholder="Batch no." value={item.batchNumber} onChange={(e) => patchItem(index, { batchNumber: e.target.value })} aria-label={`Batch number for medicine ${index + 1}`} />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input className="h-9" placeholder="Dosage — 1-0-1 for 5 days" value={item.dosage} onChange={(e) => patchItem(index, { dosage: e.target.value })} aria-label={`Dosage for medicine ${index + 1}`} />
                    <Input className="h-9" placeholder="Substituted for (brand on slip)" value={item.substitutedFor} onChange={(e) => patchItem(index, { substitutedFor: e.target.value })} aria-label={`Substituted brand for medicine ${index + 1}`} />
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-9 w-full gap-1.5 rounded-[9px] text-[12px] font-bold"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              <Plus size={14} /> Add another medicine
            </Button>
          </section>

          {/* ── Close-out ── */}
          <section className="space-y-3">
            <SectionTitle>Notes</SectionTitle>
            <Fld label="Anything to remember (optional)">
              <Textarea className="min-h-[60px] resize-y" placeholder="Allergies, counselling given, follow-up date…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Fld>

            {!editing && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3">
                <input
                  type="checkbox"
                  className="mt-[3px] h-4 w-4 accent-[var(--brand)]"
                  checked={dispenseNow}
                  onChange={(e) => setDispenseNow(e.target.checked)}
                />
                <span>
                  <span className="block text-[12.5px] font-bold text-[var(--brand-ink)]">Handing it over now</span>
                  <span className="mt-0.5 block text-[11px] text-[#8492ac]">
                    Leave this off to record a slip the patient has left for collection later.
                  </span>
                </span>
              </label>
            )}
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
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><ClipboardPlus size={15} /> {editing ? "Save Correction" : "Record Entry"}</>}
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
