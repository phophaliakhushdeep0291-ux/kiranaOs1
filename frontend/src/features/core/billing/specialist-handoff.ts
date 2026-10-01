import { offlineDB } from "@/lib/offline/db";
import type { Product, ProductSellingUnit } from "@/lib/api/client";
import type { TranslationKey, TranslationVars } from "@/features/core/settings/i18n";
import type { BillingDraft, HeldBill } from "./pages/billing-types";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, heldBillFromBillingDraft, newBillId } from "./pages/open-bills";
import { prepareNewBillWorkspace, prepareResumeBillWorkspace } from "./pages/billing-workspace";
import { activeSellingUnits } from "./cart-product";
import type { QueuedProductMerger } from "./pending-cart-additions";

/**
 * A register entry asking the till to bill it.
 *
 * A chemist records a prescription, an electronics counter looks up a handset —
 * and the sale that follows used to start again from nothing on another screen,
 * with the patient's name and the medicines retyped from memory. This carries
 * the entry across: its lines, its customer, and whatever the trade's own
 * control on the bill needs to know (the slip, the serial).
 *
 * The sibling of `pending-cart-additions`, and shaped by the same three choices
 * made there: ids rather than cart lines, because billing owns pricing; a key of
 * its own rather than a field on the draft, which is rebuilt on every save; and
 * committed with the draft, so an interrupted navigation neither loses the bill
 * nor starts it twice.
 *
 * It differs in one way. A part queued from the fitment book joins whatever bill
 * is open. A register entry is somebody else's bill, so the one in progress is
 * parked first — two patients never share a cart.
 *
 * And it must never be able to stop the till. Billing runs this before it loads
 * its own draft; a request that cannot be honoured is dropped and explained, and
 * the entry is still in its register to try again from. Left in place, it would
 * fail the same way on every visit and billing would never open.
 */
export const SPECIALIST_HANDOFF_KEY = "artha:billing-specialist-handoff:v1";

export interface SpecialistHandoff {
  /**
   * Which entry, and in which state: a second press on the same one reopens its
   * bill, while a repeat of a prescription already dispensed starts a new one.
   */
  source: string;
  items: Array<{
    productId: string;
    quantity: number;
    /** The unit the entry is written in. Absent means "however the till sells it". */
    unit?: string;
    /** For naming the line if it cannot be billed. */
    name?: string;
  }>;
  /** Lines on the entry that are not catalogue products. Billing names them so they are added by hand. */
  unlisted?: string[];
  /** The trade's own control values for the new bill, keyed by billing-slot id. */
  billingSlotValues: Record<string, unknown>;
  customerName?: string;
  customerMobile?: string;
}

/** A key and its values, not a sentence — this runs outside React and has no language. */
export interface HandoffMessage {
  key: TranslationKey;
  vars?: TranslationVars;
}

/** Thrown to the register screen, which translates it for the person who pressed the button. */
export class SpecialistHandoffError extends Error {
  constructor(readonly notice: HandoffMessage) {
    super(notice.key);
    this.name = "SpecialistHandoffError";
  }
}

export interface SpecialistHandoffOutcome {
  /** Why no bill was started. The request is gone; the entry is still in its register. */
  rejected?: HandoffMessage;
  /** Entry lines that are not in the catalogue, when a bill was started without them. */
  unlisted: string[];
}

/**
 * Ask billing to start a bill for this entry the next time it opens.
 *
 * Refuses while a different entry is still waiting: replacing it would silently
 * drop a bill somebody asked for. Asking again for the SAME entry is fine — the
 * entry may have been corrected in between.
 */
export async function queueSpecialistBill(request: SpecialistHandoff): Promise<void> {
  const billable = request.items.length > 0
    && request.items.every((item) => item.productId && Number.isFinite(item.quantity) && item.quantity > 0);
  if (!billable) throw new SpecialistHandoffError({ key: "workflow.register.handoff.nothingToBill" });

  await offlineDB.transaction(["settings"], async (tx) => {
    const pending = await offlineDB.getSetting<SpecialistHandoff>(SPECIALIST_HANDOFF_KEY);
    if (pending && pending.source !== request.source) throw new SpecialistHandoffError({ key: "workflow.register.handoff.pending" });
    await tx.setSetting(SPECIALIST_HANDOFF_KEY, request);
  });
}

const sameWord = (left: string | null | undefined, right: string) => String(left ?? "").trim().toLowerCase() === right;

/**
 * The pack an entry's unit means, or null when the catalogue has no such unit.
 *
 * An entry says "strip". If the product has a pack by that name or code, that is
 * the pack. If it has packs and none matches, the entry is describing a size the
 * shop does not sell — billing its default pack instead would hand over a box
 * against a slip for a strip. With no packs at all the line is sold in the
 * product's own unit, and the entry has to be in that.
 *
 * The server holds the saved bill to the same comparison, so an entry that
 * passes here is not refused there.
 */
function packFor(product: Product, wanted: string | undefined): { sellingUnit?: ProductSellingUnit } | null {
  const unit = String(wanted ?? "").trim().toLowerCase();
  if (!unit) return {};
  const packs = activeSellingUnits(product);
  const named = packs.find((pack) => sameWord(pack.name, unit) || sameWord(pack.unitCode, unit));
  if (named) return { sellingUnit: named };
  if (packs.length > 0) return null;
  return sameWord(product.rateUnit ?? product.displayUnit ?? "piece", unit) ? {} : null;
}

type Workspace = { draft: BillingDraft; held: HeldBill[]; started: boolean } | { rejected: HandoffMessage };

/** The workspace after this request, or why there cannot be one. Pure: nothing is written here. */
function workspaceFor(
  request: SpecialistHandoff,
  current: BillingDraft,
  held: HeldBill[],
  products: Map<string, Product>,
  merge: QueuedProductMerger,
): Workspace {
  // Already the bill in hand — a second press, or a reload after the first.
  if (current.handoffSource === request.source) return { draft: current, held, started: false };

  // Parked earlier: bring it back rather than start the same entry's bill twice.
  const parked = held.find((bill) => bill.handoffSource === request.source);
  if (parked) {
    const resumed = prepareResumeBillWorkspace(held, heldBillFromBillingDraft(current), parked.id);
    if (resumed.ok) return { draft: resumed.snapshot.activeDraft, held: resumed.snapshot.heldBills, started: false };
  }

  const fresh = prepareNewBillWorkspace(held, heldBillFromBillingDraft(current), newBillId());
  if (!fresh.ok) return { rejected: { key: "workflow.register.handoff.openBillLimit" } };

  const draft: BillingDraft = {
    ...fresh.snapshot.activeDraft,
    handoffSource: request.source,
    billingSlotValues: request.billingSlotValues,
    customerName: request.customerName,
    customerMobile: request.customerMobile,
    selectedCustomerId: "walk_in",
    cart: [],
  };
  for (const item of request.items) {
    const product = products.get(item.productId);
    const name = product?.name ?? item.name ?? item.productId;
    if (!product) return { rejected: { key: "workflow.register.handoff.productMissing", vars: { name } } };
    const pack = packFor(product, item.unit);
    if (!pack) return { rejected: { key: "workflow.register.handoff.unitMismatch", vars: { name, unit: String(item.unit).trim() } } };
    const cart = merge(draft.cart ?? [], product, draft, { quantity: item.quantity, sellingUnit: pack.sellingUnit });
    // Billing declines a product it has to ask about first — a dish with add-ons.
    if (!cart) return { rejected: { key: "workflow.register.handoff.needsConfiguration", vars: { name } } };
    draft.cart = cart;
  }
  return { draft, held: fresh.snapshot.heldBills, started: true };
}

/**
 * Start the bill a register entry asked for, parking the one in progress.
 *
 * The parked bill, the new one and the consumed request are one transaction: a
 * failed write leaves all three as they were, for the hydration retry screen.
 *
 * Resolves to null when there was nothing to do, and otherwise says what
 * happened — including that the request could not be honoured. That case
 * consumes the request too. It is the difference between a bill that did not
 * start and a till that will not open.
 */
export async function recoverSpecialistBill(
  products: Map<string, Product>,
  merge: QueuedProductMerger,
  active: () => boolean,
): Promise<SpecialistHandoffOutcome | null> {
  return offlineDB.transaction(["settings"], async (tx) => {
    const request = await offlineDB.getSetting<SpecialistHandoff>(SPECIALIST_HANDOFF_KEY);
    if (!request || !active()) return null;
    // An unavailable or empty catalogue cannot establish that a product was
    // removed. Keep the request for the next load that has one.
    if (products.size === 0) return null;

    const current = await offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY) ?? {};
    const held = await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY) ?? [];
    const workspace = workspaceFor(request, current, Array.isArray(held) ? held : [], products, merge);

    if ("rejected" in workspace) {
      await tx.setSetting(SPECIALIST_HANDOFF_KEY, null);
      if (!active()) throw new Error("Billing recovery cancelled");
      return { rejected: workspace.rejected, unlisted: [] };
    }

    await tx.setSetting(BILLING_DRAFT_KEY, workspace.draft);
    await tx.setSetting(HELD_BILLS_KEY, workspace.held);
    await tx.setSetting(SPECIALIST_HANDOFF_KEY, null);
    if (!active()) throw new Error("Billing recovery cancelled");
    // Named once, when the bill is first started — not each time it is reopened.
    return { unlisted: workspace.started ? request.unlisted ?? [] : [] };
  });
}
