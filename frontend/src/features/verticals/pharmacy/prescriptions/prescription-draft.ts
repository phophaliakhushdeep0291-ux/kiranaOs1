import { createCounterDraft } from "@/lib/counter-draft";
import type { Prescription, PrescriptionGender, PrescriptionScheduleType } from "@/types/api";

/** Local calendar date, including for counters east of UTC. */
export function prescriptionDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export interface DraftItem {
  productId: string | null;
  name: string;
  strength: string;
  dosage: string;
  qty: number;
  unit: string;
  batchNumber: string;
  substitutedFor: string;
}

export function emptyPrescriptionItem(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    productId: null, name: "", strength: "", dosage: "", qty: 1,
    unit: "strip", batchNumber: "", substitutedFor: "", ...overrides,
  };
}

export function prescriptionFormDraft(entry?: Prescription) {
  return {
    open: false,
    editing: entry ? { id: entry.id, registerNumber: entry.registerNumber } : null,
    doctorName: entry?.doctorName ?? "",
    doctorRegNo: entry?.doctorRegNo ?? "",
    doctorClinic: entry?.doctorClinic ?? "",
    patientName: entry?.patientName ?? "",
    patientPhone: entry?.patientPhone ?? "",
    patientAge: entry?.patientAge ?? "",
    patientGender: (entry?.patientGender ?? "") as PrescriptionGender | "",
    patientAddress: entry?.patientAddress ?? "",
    scheduleType: (entry?.scheduleType ?? "h") as PrescriptionScheduleType,
    prescribedOn: entry?.prescribedOnKey ?? prescriptionDayKey(new Date()),
    refillsAllowed: String(entry?.refillsAllowed ?? 0),
    items: entry ? entry.items.map((item) => emptyPrescriptionItem({
      productId: item.productId ?? null, name: item.name, strength: item.strength ?? "",
      dosage: item.dosage ?? "", qty: Number(item.qty) || 1, unit: item.unit || "strip",
      batchNumber: item.batchNumber ?? "", substitutedFor: item.substitutedFor ?? "",
    })) : [emptyPrescriptionItem()],
    notes: entry?.notes ?? "",
    // Correcting a recorded slip must never dispense it again.
    dispenseNow: !entry,
    medicineSearch: "",
  };
}

// Patient and medication details stay in this signed-in tab's memory. Like
// serial-sale buyer details, they must not become a week-long disk draft on a
// shared shop device. The scoped store survives navigation and counter locking;
// Cancel, a successful save, and sign-out clear it.
export const prescriptionDraft = createCounterDraft(prescriptionFormDraft);
