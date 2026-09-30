import { offlineDB } from "@/lib/offline/db";
import type { Product } from "@/types/api";
import type { BillingDraft, HeldBill } from "./pages/billing-types";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, heldBillFromBillingDraft, newBillId, billingDraftFromHeldBill } from "./pages/open-bills";
import { prepareNewBillWorkspace, prepareResumeBillWorkspace } from "./pages/billing-workspace";
import { defaultSellingUnit } from "./cart-product";
import type { QueuedProductMerger } from "./pending-cart-additions";

export const SPECIALIST_HANDOFF_KEY = "artha:billing-specialist-handoff:v1";
export interface SpecialistHandoff {
  source: string;
  items: Array<{ productId: string; quantity: number; unit?: string }>;
  billingSlotValues: Record<string, unknown>;
  customerName?: string;
  customerMobile?: string;
}

export async function queueSpecialistBill(request: SpecialistHandoff) {
  if (!request.items.length || request.items.some((item) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new Error("Choose catalogue products and a positive quantity for every line before billing.");
  await offlineDB.transaction(["settings"], async (tx) => {
    const pending = await offlineDB.getSetting<SpecialistHandoff>(SPECIALIST_HANDOFF_KEY);
    if (pending && pending.source !== request.source) throw new Error("Another register entry is waiting in billing. Open billing to finish it first.");
    await tx.setSetting(SPECIALIST_HANDOFF_KEY, request);
  });
}

/** Consume the handoff and park the previous bill atomically; never mix patients or lose a sale. */
export async function recoverSpecialistBill(products: Map<string, Product>, merge: QueuedProductMerger, active: () => boolean) {
  return offlineDB.transaction(["settings"], async (tx) => {
    const request = await offlineDB.getSetting<SpecialistHandoff>(SPECIALIST_HANDOFF_KEY);
    if (!request || !active()) return;
    const current = await offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY) ?? {};
    const held = await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY) ?? [];
    const existing = held.find((bill) => bill.handoffSource === request.source);
    let draft: BillingDraft;
    let parked: HeldBill[];
    if (current.handoffSource === request.source) {
      draft = current; parked = held;
    } else if (existing) {
      const transition = prepareResumeBillWorkspace(held, heldBillFromBillingDraft(current), existing.id);
      if (!transition.ok) throw new Error("Could not restore the linked bill");
      draft = billingDraftFromHeldBill(existing); parked = transition.snapshot.heldBills;
    } else {
      const transition = prepareNewBillWorkspace(held, heldBillFromBillingDraft(current), newBillId());
      if (!transition.ok) throw new Error("Finish or close an open bill before billing another register entry.");
      draft = { ...transition.snapshot.activeDraft, handoffSource: request.source, billingSlotValues: request.billingSlotValues,
        customerName: request.customerName, customerMobile: request.customerMobile, selectedCustomerId: "walk_in", cart: [] };
      parked = transition.snapshot.heldBills;
      for (const item of request.items) {
        const product = products.get(item.productId);
        if (!product) throw new Error("A register product is missing from the catalogue. Check the register before retrying.");
        const unit = item.unit?.toLowerCase();
        const sellingUnit = unit ? product.sellingUnits?.find((entry) => entry.isActive !== false && [entry.unitCode, entry.name].some((name) => name?.toLowerCase() === unit)) : undefined;
        if (unit && !sellingUnit && ![product.rateUnit, product.displayUnit, product.baseUnit].some((name) => name?.toLowerCase() === unit)) throw new Error("The prescription unit does not match the catalogue. Correct it in the register before billing.");
        const effectiveUnit = sellingUnit ?? defaultSellingUnit(product);
        if (unit && effectiveUnit && ![effectiveUnit.name, effectiveUnit.unitCode].some((name) => name?.toLowerCase() === unit)) throw new Error("The prescription unit does not match the catalogue selling unit. Correct it in the register before billing.");
        const merged = merge(draft.cart ?? [], product, draft, { quantity: item.quantity, sellingUnit });
        if (!merged) throw new Error("This product needs configuration in billing before it can be sold.");
        draft.cart = merged;
      }
    }
    await tx.setSetting(BILLING_DRAFT_KEY, draft);
    await tx.setSetting(HELD_BILLS_KEY, parked);
    await tx.setSetting(SPECIALIST_HANDOFF_KEY, null);
    if (!active()) throw new Error("Billing recovery cancelled");
  });
}
