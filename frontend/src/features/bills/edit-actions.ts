import type { Bill, BillInput, BillInputItem } from "@/types/api";
import { BillInputBillType, BillPaymentMode } from "@/types/api";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import { cancelBillWithOwnerPinLocalFirst } from "@/features/bills/local-actions";

/**
 * "Edit after finalize" WITHOUT making finalized bills mutable.
 *
 * Finalized server bills stay immutable. An "edit" is modelled as the two
 * existing immutable primitives composed together:
 *   - editFinalizedBillLocalFirst  = cancelBill(old) + confirmBill(new)
 *   - addItemsToFinalizedBillLocalFirst = confirmBill(new add-on), original kept
 *
 * Both go through the existing offline outbox events (CANCEL_BILL_PENDING +
 * CREATE_BILL), so sync, idempotency, and dashboard exclusion of cancelled bills
 * (REAL_SALE_BILL_FILTER) all work unchanged. No new backend primitive, no
 * updateBill, no row mutation.
 */

type AnyRow = Record<string, unknown>;
type GstMode = NonNullable<BillInput["gstMode"]>;

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asGstMode(value: unknown): GstMode {
  return value === "exclusive" || value === "none" ? value : "inclusive";
}

function asSaleBillType(value: unknown): BillInput["billType"] {
  const v = String(value ?? "");
  return v === "udhar_entry" || v === "gst_invoice" || v === "normal_sale"
    ? (v as BillInput["billType"])
    : BillInputBillType.normal_sale;
}

/** Map persisted bill_item rows (snake or camel) back into BillInput items. */
export function billItemsToInput(itemRows: AnyRow[]): BillInputItem[] {
  return itemRows
    .filter((row) => row && (row.name ?? row.productName))
    .map((row) => ({
      productId: str(row.productId ?? row.product_id) || undefined,
      sellingUnitId: str(row.sellingUnitId ?? row.selling_unit_id) || undefined,
      sellingUnitCode: str(row.sellingUnitCode ?? row.selling_unit_code) || undefined,
      sellingUnitLabel: str(row.sellingUnitLabel ?? row.selling_unit_label) || undefined,
      conversionToBase: readNumber(row.conversionToBase ?? row.conversion_to_base, 0) || undefined,
      name: str(row.name ?? row.productName) || "Item",
      quantity: readNumber(row.quantity, 0),
      enteredUnit: str(row.enteredUnit ?? row.entered_unit ?? row.unit) || "piece",
      ratePerRateUnit: readNumber(row.ratePerRateUnit ?? row.rate_per_rate_unit ?? row.rate, 0),
      lineDiscount: readNumber(row.lineDiscount ?? row.line_discount, 0) || undefined,
      originalUnitPrice: readNumber(row.originalUnitPrice ?? row.original_unit_price, 0) || undefined,
      appliedPricingRuleId: str(row.appliedPricingRuleId ?? row.applied_pricing_rule_id) || undefined,
      appliedPricingRuleType: str(row.appliedPricingRuleType ?? row.applied_pricing_rule_type) || undefined,
      pricingExplanation: str(row.pricingExplanation ?? row.pricing_explanation) || undefined,
      pricingConfidence: readNumber(row.pricingConfidence ?? row.pricing_confidence, Number.NaN),
      pricingCalculationVersion: str(row.pricingCalculationVersion ?? row.pricing_calculation_version) || undefined,
      wasPriceOverridden: Boolean(row.wasPriceOverridden ?? row.was_price_overridden),
      priceOverrideReason: str(row.priceOverrideReason ?? row.price_override_reason) || undefined,
      gstRate: readNumber(row.gstRate ?? row.gst_rate, 0),
    }))
    .map((item) => ({
      ...item,
      pricingConfidence: Number.isFinite(item.pricingConfidence) ? item.pricingConfidence : undefined,
    }));
}

/**
 * Payable total for a set of input items, mirroring billing/local-actions and the
 * backend GST engine: inclusive keeps the payable at the entered prices, exclusive
 * adds tax on top, then the discount is subtracted (never below zero).
 */
export function computeBillInputTotal(items: BillInputItem[], discount: number, gstMode: GstMode): number {
  const lineNet = (item: BillInputItem) => {
    const gross = readNumber(item.quantity, 0) * readNumber(item.ratePerRateUnit, 0);
    return Math.max(0, gross - Math.min(Math.max(readNumber(item.lineDiscount, 0), 0), gross));
  };
  const subtotal = items.reduce((sum, item) => sum + lineNet(item), 0);
  const gstToAdd = gstMode === "exclusive"
    ? items.reduce((sum, item) => sum + lineNet(item) * (readNumber(item.gstRate, 0) / 100), 0)
    : 0;
  return roundMoney(Math.max(0, subtotal + gstToAdd - roundMoney(readNumber(discount, 0))));
}

/**
 * Seed a BillInput from an existing finalized bill so the editor opens pre-filled.
 * Defaults to a fully-paid cash bill of the recomputed total; the editor overrides
 * items/payments before it is handed to editFinalizedBillLocalFirst.
 */
export function billInputFromBill(bill: AnyRow, itemRows: AnyRow[] = []): BillInput {
  const sourceItems = itemRows.length > 0
    ? itemRows
    : Array.isArray(bill.items)
      ? (bill.items as AnyRow[])
      : [];
  const items = billItemsToInput(sourceItems);
  const gstMode = asGstMode(bill.gstMode);
  const discount = roundMoney(readNumber(bill.discount, 0));
  const total = computeBillInputTotal(items, discount, gstMode);
  return {
    billType: asSaleBillType(bill.billType),
    gstMode,
    customerId: str(bill.customerId) || undefined,
    customerName: str(bill.customerName) || undefined,
    customerMobile: str(bill.customerMobile) || undefined,
    discount,
    items,
    actualAmount: total,
    buyerPaidAmount: total,
    payments: total > 0 ? [{ mode: BillPaymentMode.cash, amount: total }] : [],
  };
}

async function findLocalBill(id: string): Promise<AnyRow | undefined> {
  const rows = await offlineDB.getAll<AnyRow>("bills").catch(() => []);
  const match = rows.find(
    (row) => row.id === id || row.local_id === id || row.server_id === id || row.billNo === id || row.billNumber === id,
  );
  if (match) return match;
  return readInstantCache<AnyRow[]>("bills", []).find(
    (row) => row.id === id || row.billNo === id || row.billNumber === id,
  );
}

export interface EditFinalizedBillInput {
  originalBillId: string;
  ownerPin: string;
  reason?: string;
  replacement: BillInput;
}

export interface EditFinalizedBillResult {
  created: Bill;
  cancelled: Bill;
}

/**
 * Edit = void + recreate. The corrected bill is created FIRST (createBillLocalFirst
 * re-validates and throws on bad input, so a failed edit never voids the original),
 * then the original is cancelled. The new bill carries its own clientBillId, so it
 * can never collapse into the original on sync; the original becomes status
 * "cancelled" and drops out of every report — leaving exactly one active bill.
 */
export async function editFinalizedBillLocalFirst({
  originalBillId,
  ownerPin,
  reason,
  replacement,
}: EditFinalizedBillInput): Promise<EditFinalizedBillResult> {
  // Pre-flight before any write: a malformed PIN or a missing original must fail
  // up-front so we never half-apply (create without void, or void without create).
  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "cancel_bill",
    ownerPin,
    entityId: originalBillId,
    reason: reason || "Bill edited",
  });
  const original = await findLocalBill(originalBillId);
  if (!original) throw new Error("Original bill not found in local records");
  if (String(original.status) === "cancelled") {
    throw new Error("This bill is already cancelled and cannot be edited");
  }

  const created = await createBillLocalFirst(replacement);
  const cancelled = await cancelBillWithOwnerPinLocalFirst(
    str(original.id) || originalBillId,
    ownerPin,
    reason || `Edited — replaced by ${created.billNumber ?? created.billNo}`,
  );
  return { created, cancelled };
}

/**
 * Add items after finalize = a brand-new independent sale. The original stays
 * active; the two bills simply sum in reports/udhar/inventory like two sales.
 * No void, no owner PIN — nothing is reversed.
 */
export async function addItemsToFinalizedBillLocalFirst({
  originalBillId,
  addOn,
}: {
  originalBillId: string;
  addOn: BillInput;
}): Promise<Bill> {
  // Resolve only to surface a clear error if the original is gone; the add-on is a
  // normal CREATE_BILL regardless and is not linked to the original on the server.
  const original = await findLocalBill(originalBillId);
  if (!original) throw new Error("Original bill not found in local records");
  return createBillLocalFirst(addOn);
}
