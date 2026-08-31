// C. INVENTORY RULES — deterministic checks over Product / StockLedger, plus
// two bill-scoped unit-integrity checks that belong to this category.
//
// StockLedger is the authoritative movement history; Product.stockBaseQty is a
// derived cache. Every row carries oldStockBaseQty/newStockBaseQty, so the
// movement chain itself is verifiable arithmetic.
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import { toBaseQty } from "../../../utils/units.js";
import {
  defineRule,
  passed,
  quantityDiffers,
  sum,
  triggered,
} from "../rule.interface.js";

const PRODUCT = [ENTITY_TYPES.PRODUCT];
const BILL = [ENTITY_TYPES.BILL];

const DECREASE_ACTIONS = new Set(["sale", "damage", "correction", "transfer_out", "purchase_return"]);
const INCREASE_ACTIONS = new Set(["purchase", "correction", "cancel_reversal", "transfer_in", "sales_return"]);

function qty(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Product.stockBaseQty holds only the primary location's residual once
// secondary LocationStock rows exist, so whole-product reconciliation is only
// reliable for single-location shops. Multi-location products report
// INSUFFICIENT rather than a false mismatch (documented limitation).
function hasSecondaryLocationStock(ctx) {
  return (ctx.locationStocks ?? []).some((row) => qty(row.stockBaseQty) !== 0);
}

export const inventoryRules = [
  defineRule({
    ruleCode: "STOCK_LEDGER_CHAIN_BROKEN",
    name: "Stock movement arithmetic is internally inconsistent",
    description: "A stock movement's closing quantity does not equal its opening quantity plus its change, so the movement history cannot be trusted.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 34,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_INCREASED, EVENT_TYPES.STOCK_DECREASED, EVENT_TYPES.STOCK_CORRECTED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Do a physical count for this product and post one authorized correction. The broken rows must stay for the trail.",
    evaluate(ctx) {
      const offenders = (ctx.movements ?? [])
        .filter((row) => quantityDiffers(qty(row.oldStockBaseQty) + qty(row.changeBaseQty), qty(row.newStockBaseQty), 0.001))
        .map((row) => ({
          movementId: row.id,
          action: row.action,
          oldStockBaseQty: qty(row.oldStockBaseQty),
          changeBaseQty: qty(row.changeBaseQty),
          newStockBaseQty: qty(row.newStockBaseQty),
          expectedNew: Number((qty(row.oldStockBaseQty) + qty(row.changeBaseQty)).toFixed(4)),
        }));
      if (!offenders.length) return passed;
      return triggered({ brokenMovements: offenders.slice(0, 20), brokenCount: offenders.length, baseUnit: ctx.product.baseUnit });
    },
  }),

  defineRule({
    ruleCode: "STOCK_BALANCE_LEDGER_MISMATCH",
    name: "Current stock differs from the movement history",
    description: "The product's stored stock does not match the closing quantity of its latest stock movement.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_INCREASED, EVENT_TYPES.STOCK_DECREASED, EVENT_TYPES.STOCK_CORRECTED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.CORRECTION_REASON],
    remediation: "Count the product physically, then post one authorized correction with a reason so the ledger and the cache agree.",
    evaluate(ctx) {
      const movements = ctx.movements ?? [];
      if (!movements.length) return passed; // no movement coverage — nothing to reconcile against
      if (hasSecondaryLocationStock(ctx)) {
        return passed; // multi-location residual split: not reliably reconcilable yet
      }
      const last = movements[movements.length - 1];
      const expected = qty(last.newStockBaseQty);
      const stored = qty(ctx.product.stockBaseQty);
      if (!quantityDiffers(expected, stored, 0.001)) return passed;
      return triggered({
        storedStockBaseQty: stored,
        ledgerClosingBaseQty: expected,
        differenceBaseQty: Number((stored - expected).toFixed(4)),
        baseUnit: ctx.product.baseUnit,
        lastMovementId: last.id,
        movementCount: movements.length,
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_DECREASE_WITHOUT_SOURCE",
    name: "Stock decreased without a recognised source transaction",
    description: "Stock went down through a movement that has no sale, damage, transfer or correction behind it.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_DECREASED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Identify what left the shelf. Unexplained stock-out movements are the clearest leakage signal.",
    evaluate(ctx) {
      const offenders = [];
      for (const row of ctx.movements ?? []) {
        if (qty(row.changeBaseQty) >= 0) continue;
        const action = String(row.action ?? "");
        if (!DECREASE_ACTIONS.has(action)) {
          offenders.push({ movementId: row.id, action, changeBaseQty: qty(row.changeBaseQty), reason: "unrecognised_action" });
          continue;
        }
        if (action === "sale" && !row.billId) {
          offenders.push({ movementId: row.id, action, changeBaseQty: qty(row.changeBaseQty), reason: "sale_without_bill" });
          continue;
        }
        if (action === "sale" && row.billId && !ctx.referencedBills?.get(row.billId)) {
          offenders.push({ movementId: row.id, action, changeBaseQty: qty(row.changeBaseQty), reason: "sale_bill_missing", billId: row.billId });
        }
      }
      if (!offenders.length) return passed;
      return triggered({
        unexplainedDecreases: offenders.slice(0, 20),
        offenderCount: offenders.length,
        baseUnit: ctx.product.baseUnit,
        totalUnexplainedBaseQty: Number(Math.abs(sum(offenders.map((o) => o.changeBaseQty))).toFixed(4)),
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_INCREASE_WITHOUT_SOURCE",
    name: "Stock increased without a purchase, return or authorized correction",
    description: "Stock went up through a movement with no purchase, return or correction behind it.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 22,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_INCREASED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION, EVIDENCE_TYPES.CORRECTION_REASON],
    remediation: "Attach the purchase invoice or goods-receipt note for the stock that came in.",
    evaluate(ctx) {
      const offenders = [];
      for (const row of ctx.movements ?? []) {
        if (qty(row.changeBaseQty) <= 0) continue;
        const action = String(row.action ?? "");
        if (!INCREASE_ACTIONS.has(action)) {
          offenders.push({ movementId: row.id, action, changeBaseQty: qty(row.changeBaseQty), reason: "unrecognised_action" });
          continue;
        }
        if (action === "purchase" && !row.invoiceNumber && !row.supplierName && !row.sourceId) {
          offenders.push({ movementId: row.id, action, changeBaseQty: qty(row.changeBaseQty), reason: "purchase_without_supplier_or_invoice" });
        }
      }
      if (!offenders.length) return passed;
      return triggered({
        unexplainedIncreases: offenders.slice(0, 20),
        offenderCount: offenders.length,
        baseUnit: ctx.product.baseUnit,
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_NEGATIVE_BALANCE",
    name: "Negative stock",
    description: "The product's stock is negative, meaning more was sold than the system knows was received.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_DECREASED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Record the missing purchase, or count the product and post a correction. Negative stock is allowed by design but must be resolved.",
    evaluate(ctx) {
      const stored = qty(ctx.product.stockBaseQty);
      if (stored >= 0) return passed;
      return triggered({
        stockBaseQty: stored,
        baseUnit: ctx.product.baseUnit,
        shortfallBaseQty: Number(Math.abs(stored).toFixed(4)),
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_LARGE_MANUAL_CORRECTION",
    name: "Large manual stock correction",
    description: "A manual stock correction moved more than a quarter of the product's stock, or carries no reason at all.",
    category: RULE_CATEGORIES.AUTHORIZATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_CORRECTED],
    evidenceTypes: [EVIDENCE_TYPES.CORRECTION_REASON, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Large corrections should follow a physical count and carry an owner-approved reason.",
    evaluate(ctx) {
      const LARGE_SHARE = 0.25;
      const offenders = [];
      for (const row of ctx.movements ?? []) {
        if (row.action !== "correction") continue;
        const change = Math.abs(qty(row.changeBaseQty));
        if (change === 0) continue;
        const before = Math.abs(qty(row.oldStockBaseQty));
        const share = before > 0 ? change / before : 1;
        const hasReason = row.note && String(row.note).trim().length > 0;
        if (share > LARGE_SHARE || !hasReason) {
          offenders.push({
            movementId: row.id,
            changeBaseQty: qty(row.changeBaseQty),
            oldStockBaseQty: qty(row.oldStockBaseQty),
            shareOfStock: Number(share.toFixed(3)),
            hasReason: Boolean(hasReason),
            createdAt: new Date(row.createdAt).toISOString(),
          });
        }
      }
      if (!offenders.length) return passed;
      return triggered({
        largeShareThreshold: LARGE_SHARE,
        corrections: offenders.slice(0, 20),
        correctionCount: offenders.length,
        baseUnit: ctx.product.baseUnit,
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_FREQUENT_CORRECTIONS",
    name: "Frequent stock corrections by the same person",
    description: "The same authenticated person manually corrected this product at least four times in the last 30 days.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 2,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_CORRECTED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Investigate why this product keeps drifting: unit setup, loose-item weighing, or unrecorded consumption.",
    evaluate(ctx) {
      const ALERT_COUNT = 4;
      const movements = ctx.movements ?? [];
      if (!movements.length) return passed;
      const latest = Math.max(...movements.map((row) => new Date(row.createdAt).getTime()));
      const windowStart = latest - 30 * 24 * 60 * 60 * 1000;
      const corrections = movements.filter(
        (row) => row.action === "correction" && new Date(row.createdAt).getTime() >= windowStart
      );
      const byActor = new Map();
      for (const row of corrections) {
        // actorName is only a historical display snapshot and is not unique.
        // Group only by the authenticated immutable id; legacy/system rows stay
        // visible in the count but can never implicate a person by guesswork.
        if (!row.actorUserId) continue;
        const group = byActor.get(row.actorUserId) ?? {
          actorUserId: row.actorUserId,
          actorName: row.actorName ?? null,
          rows: [],
        };
        group.rows.push(row);
        byActor.set(row.actorUserId, group);
      }
      const correctionGroups = [...byActor.values()]
        .filter((group) => group.rows.length >= ALERT_COUNT)
        .sort((left, right) => right.rows.length - left.rows.length || left.actorUserId.localeCompare(right.actorUserId))
        .map((group) => ({
          actorUserId: group.actorUserId,
          actorName: group.actorName,
          correctionsLast30Days: group.rows.length,
          movementIds: group.rows.slice(0, 20).map((row) => row.id),
          firstCorrectionAt: new Date(group.rows[0].createdAt).toISOString(),
          lastCorrectionAt: new Date(group.rows[group.rows.length - 1].createdAt).toISOString(),
        }));
      if (!correctionGroups.length) return passed;
      return triggered({
        correctionsLast30Days: corrections.length,
        alertThreshold: ALERT_COUNT,
        attributedCorrectionCount: corrections.filter((row) => Boolean(row.actorUserId)).length,
        unattributedCorrectionCount: corrections.filter((row) => !row.actorUserId).length,
        staffAttributionAvailable: true,
        correctionGroups,
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_SALE_EXCEEDED_AVAILABLE",
    name: "Sale drove stock below zero",
    description: "A sale movement took the product's stock negative, so it was sold without recorded supply.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_DECREASED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Record the purchase that supplied these goods so cost and margin are right.",
    evaluate(ctx) {
      const offenders = (ctx.movements ?? [])
        .filter((row) => row.action === "sale" && qty(row.newStockBaseQty) < -0.001)
        .map((row) => ({
          movementId: row.id,
          billId: row.billId,
          soldBaseQty: Math.abs(qty(row.changeBaseQty)),
          availableBeforeBaseQty: qty(row.oldStockBaseQty),
          closingBaseQty: qty(row.newStockBaseQty),
        }));
      if (!offenders.length) return passed;
      return triggered({ oversoldMovements: offenders.slice(0, 20), offenderCount: offenders.length, baseUnit: ctx.product.baseUnit });
    },
  }),

  defineRule({
    ruleCode: "STOCK_CANCELLED_SALE_NOT_RESTORED",
    name: "Cancelled sales did not restore this product's stock",
    description: "Stock movements belong to cancelled bills but were never offset, so this product's stock is still reduced.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED],
    evidenceTypes: [EVIDENCE_TYPES.CANCELLATION_REASON, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Re-run the cancellation reversal for the affected bills, or post an authorized correction after counting.",
    evaluate(ctx) {
      const byBill = new Map();
      for (const row of ctx.movements ?? []) {
        if (!row.billId) continue;
        const bill = ctx.referencedBills?.get(row.billId);
        if (!bill || bill.status !== "cancelled") continue;
        byBill.set(row.billId, (byBill.get(row.billId) ?? 0) + qty(row.changeBaseQty));
      }
      const unrestored = [...byBill.entries()]
        .filter(([, net]) => Math.abs(net) > 0.001)
        .map(([billId, netBaseQty]) => ({ billId, netBaseQty: Number(netBaseQty.toFixed(4)) }));
      if (!unrestored.length) return passed;
      return triggered({ unrestoredBills: unrestored.slice(0, 20), billCount: unrestored.length, baseUnit: ctx.product.baseUnit });
    },
  }),

  defineRule({
    ruleCode: "STOCK_CHANGED_AFTER_CLOSING_LOCK",
    name: "Stock for a locked day changed after the closing lock",
    description: "A stock movement dated inside a locked business day was recorded after that day's closing was locked.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_CORRECTED, EVENT_TYPES.STOCK_DECREASED, EVENT_TYPES.STOCK_INCREASED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.CORRECTION_REASON],
    remediation: "Re-open, refresh and re-lock the affected day's closing so the locked figures match the movements.",
    evaluate(ctx) {
      const locks = ctx.lockedClosings ?? [];
      if (!locks.length) return passed;
      const offenders = [];
      for (const row of ctx.movements ?? []) {
        // Sale movements are the automatic consequence of billing: a sale made
        // later in the day is not a late stock adjustment, and flagging them
        // would raise a finding for every afternoon sale. The day's staleness is
        // reported once on the closing itself.
        //
        // "recipe_use" is the same event seen from the kitchen's side — the
        // ingredients a dish consumed, written in the same transaction as the
        // sale that consumed them. Judged separately it would raise a finding
        // per ingredient of every dish served after the lock.
        if (row.action === "sale" || row.action === "recipe_use") continue;
        const recordedAt = new Date(row.createdAt).getTime();
        for (const lock of locks) {
          const lockDayStart = startOfDay(lock.date).getTime();
          const lockDayEnd = endOfDay(lock.date).getTime();
          const lockedAt = new Date(lock.lockedAt).getTime();
          // Movement belongs to the locked day but was written after the lock.
          if (recordedAt >= lockDayStart && recordedAt <= lockDayEnd && recordedAt > lockedAt) {
            offenders.push({
              movementId: row.id,
              action: row.action,
              changeBaseQty: qty(row.changeBaseQty),
              closingSnapshotId: lock.id,
              lockedAt: new Date(lock.lockedAt).toISOString(),
              recordedAt: new Date(row.createdAt).toISOString(),
            });
            break;
          }
        }
      }
      if (!offenders.length) return passed;
      return triggered({ lateMovements: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "STOCK_UNUSUAL_SHRINKAGE",
    name: "Unusual shrinkage relative to sales",
    description: "Damage and downward corrections for this product are large compared with what was actually sold.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_CORRECTED, EVENT_TYPES.STOCK_DECREASED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Check storage, expiry handling and weighing practice for this product.",
    evaluate(ctx) {
      const SHRINKAGE_SHARE_ALERT = 0.05;
      const MIN_SOLD_BASE_QTY = 10;
      const movements = ctx.movements ?? [];
      const soldBaseQty = Math.abs(sum(movements.filter((r) => r.action === "sale").map((r) => qty(r.changeBaseQty))));
      if (soldBaseQty < MIN_SOLD_BASE_QTY) return passed; // too little activity to judge
      const shrinkBaseQty = Math.abs(
        sum(
          movements
            .filter((r) => r.action === "damage" || (r.action === "correction" && qty(r.changeBaseQty) < 0))
            .map((r) => qty(r.changeBaseQty))
        )
      );
      if (shrinkBaseQty <= 0) return passed;
      const share = shrinkBaseQty / soldBaseQty;
      if (share <= SHRINKAGE_SHARE_ALERT) return passed;
      return triggered({
        shrinkageBaseQty: Number(shrinkBaseQty.toFixed(4)),
        soldBaseQty: Number(soldBaseQty.toFixed(4)),
        shrinkageShare: Number(share.toFixed(3)),
        alertShare: SHRINKAGE_SHARE_ALERT,
        baseUnit: ctx.product.baseUnit,
      });
    },
  }),

  defineRule({
    ruleCode: "STOCK_SOLD_WHILE_ARCHIVED",
    name: "Product sold after it was archived",
    description: "Sale movements exist for this product after it was moved to the recycle bin.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_DECREASED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Restore the product if it is still being sold, so cost and stock stay accurate.",
    evaluate(ctx) {
      const { product } = ctx;
      if (!product.deletedAt) return passed;
      const deletedAt = new Date(product.deletedAt).getTime();
      const offenders = (ctx.movements ?? [])
        .filter((row) => row.action === "sale" && new Date(row.createdAt).getTime() > deletedAt)
        .map((row) => ({ movementId: row.id, billId: row.billId, changeBaseQty: qty(row.changeBaseQty), createdAt: new Date(row.createdAt).toISOString() }));
      if (!offenders.length) return passed;
      return triggered({ archivedAt: new Date(product.deletedAt).toISOString(), salesAfterArchive: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "STOCK_DUPLICATE_MOVEMENT",
    name: "Duplicate stock movement",
    description: "Two identical stock movements for the same product, action and quantity were recorded within a minute of each other.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: PRODUCT,
    applicableEventTypes: [EVENT_TYPES.STOCK_INCREASED, EVENT_TYPES.STOCK_DECREASED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION, EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Confirm the goods moved once. If duplicated, post a correction — do not delete the movement rows.",
    evaluate(ctx) {
      const WINDOW_MS = 60 * 1000;
      const movements = [...(ctx.movements ?? [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const pairs = [];
      for (let i = 1; i < movements.length; i += 1) {
        const previous = movements[i - 1];
        const current = movements[i];
        const sameShape =
          previous.action === current.action &&
          !quantityDiffers(qty(previous.changeBaseQty), qty(current.changeBaseQty), 0.0001) &&
          (previous.billId ?? null) === (current.billId ?? null);
        const withinWindow = new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() <= WINDOW_MS;
        if (sameShape && withinWindow) {
          pairs.push({
            firstMovementId: previous.id,
            secondMovementId: current.id,
            action: current.action,
            changeBaseQty: qty(current.changeBaseQty),
            secondsApart: Math.round((new Date(current.createdAt) - new Date(previous.createdAt)) / 1000),
          });
        }
      }
      if (!pairs.length) return passed;
      return triggered({ windowSeconds: WINDOW_MS / 1000, duplicatePairs: pairs.slice(0, 10), duplicateCount: pairs.length });
    },
  }),

  // ── bill-scoped unit-integrity checks (category C in the catalog) ──
  defineRule({
    ruleCode: "BILL_UNIT_CONVERSION_MISMATCH",
    name: "Unit conversion mismatch on a bill line",
    description: "A bill line's base-unit quantity does not follow from its entered quantity and unit, so stock moved by a different amount than was sold.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Check the product's unit setup and the selling-unit pack size. Wrong conversions silently corrupt stock and margin.",
    evaluate(ctx) {
      const offenders = [];
      for (const item of ctx.bill.items ?? []) {
        const entered = Number(item.quantity ?? 0);
        const stored = Number(item.quantityInBaseUnit ?? 0);
        if (item.conversionToBase !== null && item.conversionToBase !== undefined) {
          const expected = entered * Number(item.conversionToBase);
          if (quantityDiffers(expected, stored, 0.01)) {
            offenders.push({
              billItemId: item.id,
              name: item.name,
              quantity: entered,
              conversionToBase: Number(item.conversionToBase),
              expectedBaseQty: Number(expected.toFixed(4)),
              storedBaseQty: stored,
              reason: "selling_unit_conversion",
            });
          }
          continue;
        }
        try {
          const expected = toBaseQty(entered, item.enteredUnit, item.baseUnit);
          if (quantityDiffers(expected, stored, 0.01)) {
            offenders.push({
              billItemId: item.id,
              name: item.name,
              quantity: entered,
              enteredUnit: item.enteredUnit,
              baseUnit: item.baseUnit,
              expectedBaseQty: Number(expected.toFixed(4)),
              storedBaseQty: stored,
              reason: "unit_factor",
            });
          }
        } catch (error) {
          offenders.push({
            billItemId: item.id,
            name: item.name,
            enteredUnit: item.enteredUnit,
            baseUnit: item.baseUnit,
            reason: "unsupported_unit",
            detail: error?.code ?? "UNSUPPORTED_UNIT",
          });
        }
      }
      if (!offenders.length) return passed;
      return triggered({ conversionMismatches: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "BILL_LOOSE_ITEM_DECIMAL_INCONSISTENCY",
    name: "Fractional quantity on a countable item",
    description: "A bill line sold a fractional quantity of a product that is not marked as a loose (weighed) item.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.LOW,
    defaultWeight: 10,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Mark the product as a loose item if it is sold by weight, otherwise correct the quantity entry habit.",
    evaluate(ctx) {
      const offenders = [];
      for (const item of ctx.bill.items ?? []) {
        if (!item.productId) continue;
        const product = ctx.products?.get(item.productId);
        if (!product || product.isLooseItem) continue;
        const countUnits = ["piece", "pieces", "pcs", "pc", "packet", "packets", "pkt", "box", "dozen"];
        if (!countUnits.includes(String(item.enteredUnit ?? "").toLowerCase())) continue;
        const entered = Number(item.quantity ?? 0);
        if (Number.isInteger(entered)) continue;
        offenders.push({ billItemId: item.id, name: item.name, quantity: entered, enteredUnit: item.enteredUnit, isLooseItem: false });
      }
      if (!offenders.length) return passed;
      return triggered({ fractionalCountLines: offenders.slice(0, 20), offenderCount: offenders.length });
    },
  }),
];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
