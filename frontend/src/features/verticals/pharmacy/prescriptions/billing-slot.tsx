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
 * Shown only when the cart actually holds a Schedule H, H1 or X medicine — the
 * same condition the server guard refuses on, so the control appears exactly
 * when the bill would otherwise be rejected, and never on an OTC sale.
 *
 * Loading the pharmacy pack is what registers this; a shop of another trade
 * never runs it.
 */
export function registerPrescriptionBillingSlot() {
  registerBillingSlot({
    id: "prescriptionId",
    Component: PrescriptionSlot,
    appliesTo: ({ products }) => products.some((product) => RESTRICTED.includes(String(product?.drugSchedule ?? ""))),
  });
}

registerPrescriptionBillingSlot();
