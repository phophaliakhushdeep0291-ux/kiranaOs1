import { registerBillingSlot, type BillingSlotProps } from "@/features/core/billing/billing-slots";
import { PrescriptionAttach } from "./components/PrescriptionAttach";
import type { Prescription } from "@/types/api";

/** Schedules that billing will refuse without a slip — mirrors RESTRICTED_SCHEDULES on the server. */
const RESTRICTED = ["h", "h1", "x"];

function PrescriptionSlot({ value, onChange }: BillingSlotProps) {
  return (
    <PrescriptionAttach
      selected={(value as Prescription | null) ?? null}
      onSelect={(prescription) => onChange(prescription)}
      className="mt-2"
    />
  );
}

/**
 * How shared billing gets a prescription control without importing pharmacy.
 *
 * Shown when the cart holds a Schedule H, H1 or X medicine — the same condition
 * the server guard refuses on, so the control appears exactly when the bill
 * would otherwise be rejected — and kept on a bill that already has a slip
 * attached, which is how a bill started from the register for an OTC entry
 * still shows whose slip it is dispensing. An ordinary OTC sale never sees it.
 *
 * Such a bill is saved on the server rather than queued. The slip is closed by
 * the sale that dispenses it, in one transaction; a queued bill would be told
 * "saved" about a one-time slip that a second counter could still spend, and
 * the refusal would arrive after the medicine had left.
 *
 * Loading the pharmacy pack is what registers this; a shop of another trade
 * never runs it.
 */
export function registerPrescriptionBillingSlot() {
  registerBillingSlot({
    id: "prescriptionId",
    Component: PrescriptionSlot,
    requiresOnline: true,
    appliesTo: ({ products, values }) => Boolean(values?.prescriptionId) || products.some((product) => RESTRICTED.includes(String(product?.drugSchedule ?? ""))),
  });
}

registerPrescriptionBillingSlot();
