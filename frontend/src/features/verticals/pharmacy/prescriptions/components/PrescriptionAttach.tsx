import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listPrescriptions } from "../api";
import type { Prescription } from "@/types/api";

/**
 * The slip authorising a Schedule H, H1 or X sale.
 *
 * Billing refuses such a sale outright without one — that refusal is the whole
 * point of classifying a medicine — so the counter needs somewhere to attach the
 * register entry before the bill will confirm. Only pending entries are offered:
 * a slip already dispensed against another bill is not authorisation for this
 * one, and the server will refuse it anyway once its refills run out.
 *
 * Rendered only when the cart actually holds a restricted medicine, so an OTC
 * counter never sees it.
 */
export function PrescriptionAttach({
  selected,
  onSelect,
  className,
}: {
  selected?: Prescription | null;
  onSelect: (prescription: Prescription | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["prescriptions", "attachable", search],
    queryFn: () => listPrescriptions({ status: "pending", search: search.trim() || undefined }),
    enabled: open,
    staleTime: 15_000,
  });

  const rows = query.data ?? [];

  if (selected) {
    return (
      <div className={cn("flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2", className)}>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black text-emerald-800">
            Rx {selected.registerNumber} · {selected.patientName}
          </p>
          <p className="truncate text-[10px] font-semibold text-emerald-700">
            Dr {selected.doctorName}
            {selected.doctorRegNo ? ` · ${selected.doctorRegNo}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label="Detach prescription"
          className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        data-testid="attach-prescription"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] font-black text-amber-800 hover:bg-amber-100"
      >
        <FileText size={12} aria-hidden="true" />
        Attach prescription
      </button>

      {open ? (
        <div className="mt-1 rounded-lg border bg-white p-1.5 shadow-sm">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Patient, phone or register number"
            aria-label="Search prescriptions"
            className="mb-1 h-8 w-full rounded-md border px-2 text-[11px] font-semibold"
          />
          <div className="max-h-44 overflow-y-auto">
            {query.isLoading ? (
              <p className="px-2 py-2 text-[10px] text-[#9aa7bd]">Loading register…</p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-2 text-[10px] text-[#9aa7bd]">
                No pending prescriptions. Record one in the register first.
              </p>
            ) : (
              rows.map((prescription) => (
                <button
                  key={prescription.id}
                  type="button"
                  onClick={() => { onSelect(prescription); setOpen(false); }}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#f3f7ff]"
                >
                  <span className="block text-[11px] font-bold text-[#13274d]">
                    {prescription.patientName}
                    <span className="ml-1 font-mono text-[10px] text-[#64748b]">{prescription.registerNumber}</span>
                  </span>
                  <span className="block text-[10px] text-[#64748b]">
                    Dr {prescription.doctorName} · {new Date(prescription.prescribedOn).toLocaleDateString("en-IN")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
