import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { evaluateSale } from "./scheduleEnforcement.js";

/**
 * The pharmacy's own condition on a sale: Schedule H, H1 and X do not leave the
 * shop without a doctor's slip.
 *
 * The register that records such a sale already existed. Nothing refused the
 * sale itself, so writing the entry was effectively voluntary — this is the half
 * that was missing.
 *
 * Registered rather than imported by billing, so the shared path never names a
 * trade. Costs a shop with no classified products nothing: `lines` comes back
 * empty and the whole thing collapses to a boolean.
 */
export function registerPrescriptionSaleGuard() {
  registerSaleGuard(async ({ shopId, tx, body, items, productMap, isEstimate }) => {
    // A kacha estimate hands nothing over. Blocking one would stop a pharmacy
    // pricing a prescription before the customer has decided to buy.
    if (isEstimate) return null;

    const lines = items
      .filter((item) => item.productId && productMap[item.productId]?.drugSchedule)
      .map((item) => ({
        productId: item.productId,
        name: productMap[item.productId].name,
        schedule: productMap[item.productId].drugSchedule,
      }));
    if (lines.length === 0) return null;

    const prescription = body.prescriptionId
      ? await tx.prescription.findFirst({ where: { id: body.prescriptionId, shopId } })
      : null;
    const decision = evaluateSale({ lines, prescription });

    if (!decision.allowed) {
      const names = decision.restrictedLines.map((line) => line.name).join(", ");
      return {
        code: "PRESCRIPTION_REQUIRED_FOR_SCHEDULE",
        status: 409,
        message: `${names} ${decision.restrictedLines.length === 1 ? "is" : "are"} Schedule ${decision.schedule.toUpperCase()} and cannot be sold without a valid prescription`,
        // The counter has to know which medicine and what is wrong with the slip,
        // or the only available fix is to drop the line and lose the sale.
        publicData: {
          schedule: decision.schedule,
          blockers: decision.blockers,
          restrictedLines: decision.restrictedLines.map((line) => ({ productId: line.productId, name: line.name, schedule: line.schedule })),
        },
      };
    }

    // Allowed — and once the bill exists, close the register entry against it.
    return {
      onConfirmed: async ({ tx: confirmTx, bill, billNo }) => {
        // billNumber is copied alongside the id on purpose, matching the model's
        // own note: the entry is the legal record and must keep saying what went
        // out even if the bill is later cancelled or purged.
        //
        // refillsUsed only increments, so a repeat slip walks toward exhaustion
        // rather than authorising sales forever.
        await confirmTx.prescription.update({
          where: { id: prescription.id },
          data: {
            status: "dispensed",
            dispensedAt: new Date(),
            billId: bill.id,
            billNumber: billNo,
            refillsUsed: { increment: 1 },
          },
        });
      },
    };
  });
}

// How shared billing learns about Schedule H without importing pharmacy. Loading
// this module is what registers the guard, and the only way to reach it is
// through the pharmacy pack's routes — so a shop with no prescriptions never
// runs it. Same arrangement as the clothing pack's catalogue filter.
registerPrescriptionSaleGuard();
