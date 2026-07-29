// D. PURCHASE AND SUPPLIER RULES.
//
// KiranaOS records purchases in two shapes and both are audited through the
// same PURCHASE entity type:
//   * PurchaseReceipt — the PO → receipt → 3-way-match flow (rich evidence)
//   * PurchaseHistory — the quick "stock in" flow from the inventory screen
// Rules that need receipt-only fields return `passed` for the quick shape
// rather than guessing.
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import { BASELINE_METRICS } from "../baseline.service.js";
import {
  defineRule,
  money,
  moneyDiffers,
  passed,
  percentOf,
  quantityDiffers,
  sum,
  toPaiseInt,
  triggered,
} from "../rule.interface.js";

const PURCHASE = [ENTITY_TYPES.PURCHASE];

function purchaseAmount(ctx) {
  if (ctx.receipt) return money(ctx.receipt.totalAmount);
  return money(ctx.history?.billAmount ?? ctx.history?.totalCost);
}

function purchaseCreatedAt(ctx) {
  return new Date(ctx.receipt?.createdAt ?? ctx.history?.createdAt);
}

function invoiceNumber(ctx) {
  const raw = ctx.receipt ? ctx.receipt.supplierInvoiceNumber : ctx.history?.invoiceNumber;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export const purchaseRules = [
  defineRule({
    ruleCode: "PURCHASE_DUPLICATE_INVOICE_NUMBER",
    name: "Duplicate supplier invoice number",
    description: "Another purchase from the same supplier carries this supplier invoice number, so the same invoice may have been booked twice.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 34,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.SUPPLIER_INVOICE_NUMBER],
    remediation: "Compare the two entries against the paper invoice. If duplicated, raise a purchase return or correction — do not delete.",
    evaluate(ctx) {
      const duplicates = ctx.duplicateInvoices ?? [];
      if (!duplicates.length) return passed;
      return triggered({
        supplierInvoiceNumber: invoiceNumber(ctx),
        duplicatePurchaseIds: duplicates.map((d) => d.id),
        duplicateCount: duplicates.length,
        amountRupees: purchaseAmount(ctx),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_REPEATED_SAME_DAY_AMOUNT",
    name: "Same supplier and amount repeated on the same day",
    description: "Another purchase from this supplier for exactly the same amount was recorded on the same day.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION],
    remediation: "Check whether two deliveries really arrived or the same invoice was entered twice.",
    evaluate(ctx) {
      const matches = ctx.sameAmountSameDay ?? [];
      if (!matches.length) return passed;
      return triggered({
        amountRupees: purchaseAmount(ctx),
        matchingPurchaseIds: matches.map((m) => m.id),
        matchCount: matches.length,
        date: purchaseCreatedAt(ctx).toISOString().slice(0, 10),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_PAYMENT_WITHOUT_GOODS",
    name: "Purchase payment recorded with no goods value",
    description: "Money was recorded as paid against a purchase that has no goods value or no line items.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 34,
    version: 2,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_PAYMENT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION, EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Establish what the payment was for. An advance to a supplier should be recorded as an advance, not as a purchase.",
    evaluate(ctx) {
      const paid = money(ctx.receipt?.paidAmount ?? ctx.history?.purchasePaidAmount);
      if (paid <= 0) return passed;
      const goodsValue = ctx.receipt
        ? sum(ctx.receipt.items.map((item) => item.lineAmount))
        : money(ctx.history?.totalCost);
      const lineCount = ctx.receipt ? ctx.receipt.items.length : 1;
      if (toPaiseInt(goodsValue) > 0 && lineCount > 0) return passed;
      return triggered({ paidAmountRupees: paid, goodsValueRupees: Number(goodsValue.toFixed(2)), lineCount });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_WITHOUT_STOCK_RECEIPT",
    name: "Purchase did not increase stock",
    description: "The purchase was booked but no stock movement was recorded, so the goods never entered inventory.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION, EVIDENCE_TYPES.PURCHASE_INVOICE],
    remediation: "Confirm the goods arrived and post the stock-in, or mark the purchase as an invoice-only entry.",
    evaluate(ctx) {
      const stockIn = (ctx.stockRows ?? []).filter((row) => Number(row.changeBaseQty ?? 0) > 0);
      if (stockIn.length) return passed;
      if (purchaseAmount(ctx) <= 0) return passed;
      return triggered({
        amountRupees: purchaseAmount(ctx),
        stockMovementCount: (ctx.stockRows ?? []).length,
        positiveStockMovements: 0,
        purchaseKind: ctx.purchaseKind,
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_STOCK_QUANTITY_MISMATCH",
    name: "Stock received differs from the purchased quantity",
    description: "The quantity added to stock does not match the quantity on the purchase's line items.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 32,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED, EVENT_TYPES.STOCK_INCREASED],
    evidenceTypes: [EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION, EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION],
    remediation: "Recount the delivery against the invoice. Short deliveries need a debit note; entry errors need a correction.",
    evaluate(ctx) {
      if (!ctx.receipt) {
        // Quick purchases write exactly one stock row; compare it with qtyBase.
        const history = ctx.history;
        if (!history) return passed;
        const stockIn = sum((ctx.stockRows ?? []).filter((r) => Number(r.changeBaseQty) > 0).map((r) => r.changeBaseQty));
        if (stockIn <= 0) return passed; // covered by PURCHASE_WITHOUT_STOCK_RECEIPT
        if (!quantityDiffers(stockIn, Number(history.qtyBase ?? 0), 0.01)) return passed;
        return triggered({
          purchasedBaseQty: Number(history.qtyBase ?? 0),
          stockedBaseQty: Number(stockIn.toFixed(4)),
          differenceBaseQty: Number((stockIn - Number(history.qtyBase ?? 0)).toFixed(4)),
          purchaseKind: "history",
        });
      }
      const perProduct = new Map();
      for (const item of ctx.receipt.items) {
        perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + Number(item.quantityBaseQty ?? 0));
      }
      const stockedPerProduct = new Map();
      for (const row of ctx.stockRows ?? []) {
        stockedPerProduct.set(row.productId, (stockedPerProduct.get(row.productId) ?? 0) + Number(row.changeBaseQty ?? 0));
      }
      const mismatches = [];
      for (const [productId, purchasedQty] of perProduct) {
        const stockedQty = stockedPerProduct.get(productId) ?? 0;
        if (stockedQty === 0) continue; // no stock at all is a different rule
        if (quantityDiffers(purchasedQty, stockedQty, 0.01)) {
          mismatches.push({
            productId,
            purchasedBaseQty: Number(purchasedQty.toFixed(4)),
            stockedBaseQty: Number(stockedQty.toFixed(4)),
            differenceBaseQty: Number((stockedQty - purchasedQty).toFixed(4)),
          });
        }
      }
      if (!mismatches.length) return passed;
      return triggered({ mismatches: mismatches.slice(0, 20), mismatchCount: mismatches.length, purchaseKind: "receipt" });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_AMOUNT_ITEM_TOTAL_MISMATCH",
    name: "Purchase total differs from its line totals",
    description: "The purchase's recorded total does not equal the sum of its line amounts.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 2,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE],
    remediation: "Re-enter the purchase from the invoice. Do not adjust the total without adjusting the lines.",
    evaluate(ctx) {
      if (!ctx.receipt) return passed; // quick purchases have a single implicit line
      const lineSum = sum(ctx.receipt.items.map((item) => item.lineAmount));
      const total = money(ctx.receipt.totalAmount);
      if (!moneyDiffers(lineSum, total)) return passed;
      return triggered({
        lineTotalSum: Number(lineSum.toFixed(2)),
        recordedTotal: total,
        differenceRupees: Number((total - lineSum).toFixed(2)),
        lineCount: ctx.receipt.items.length,
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_PRICE_ABOVE_HISTORICAL_RANGE",
    name: "Purchase price far above the usual range for this product",
    description: "A purchase rate is well above this product's own historical purchase-price range for the shop.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Verify the rate against the invoice and the market. Rising input costs are normal; entry errors and inflated invoices are not.",
    evaluate(ctx) {
      const checks = [];
      if (ctx.receipt) {
        for (const item of ctx.receipt.items) {
          checks.push({ productId: item.productId, rate: money(item.actualRate) });
        }
      } else if (ctx.history) {
        checks.push({ productId: ctx.history.productId, rate: money(ctx.history.pricePerRateUnit) });
      }
      const offenders = [];
      for (const check of checks) {
        if (check.rate <= 0) continue;
        const baseline = ctx.baselines.get(BASELINE_METRICS.PURCHASE_PRICE, `product:${check.productId}`);
        if (!baseline.usable || !baseline.upperFence || baseline.upperFence <= 0) continue;
        if (check.rate > baseline.upperFence) {
          offenders.push({
            productId: check.productId,
            rate: check.rate,
            medianRate: baseline.median,
            upperFence: Number(baseline.upperFence.toFixed(2)),
            sampleCount: baseline.sampleCount,
            excessPercent: Number(percentOf(check.rate - baseline.median, baseline.median).toFixed(1)),
          });
        }
      }
      if (!offenders.length) return passed;
      return triggered({ outlierRates: offenders.slice(0, 20), offenderCount: offenders.length, statistic: "median + 3×IQR" });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_DUE_AMOUNT_MISMATCH",
    name: "Purchase due amount does not reconcile",
    description: "The recorded due amount does not equal the purchase total minus what was paid, so the supplier payable is wrong.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 2,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED, EVENT_TYPES.PURCHASE_PAYMENT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.PAYMENT_RECEIPT],
    remediation: "Reconcile the supplier's account statement against the recorded payments for this purchase.",
    evaluate(ctx) {
      const total = ctx.receipt ? money(ctx.receipt.totalAmount) : money(ctx.history?.billAmount);
      const paid = ctx.receipt ? money(ctx.receipt.paidAmount) : money(ctx.history?.purchasePaidAmount);
      const due = ctx.receipt ? money(ctx.receipt.dueAmount) : money(ctx.history?.purchaseDueAmount);
      if (total <= 0) return passed;
      const expectedDue = total - paid;
      if (!moneyDiffers(expectedDue, due)) return passed;
      return triggered({
        totalRupees: total,
        paidRupees: paid,
        recordedDueRupees: due,
        expectedDueRupees: Number(expectedDue.toFixed(2)),
        differenceRupees: Number((due - expectedDue).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_MARKED_PAID_WITHOUT_PAYMENT",
    name: "Purchase marked paid without a matching payment amount",
    description: "The purchase's payment status says paid but the recorded paid amount is less than its total.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 2,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_PAYMENT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.BANK_TRANSACTION],
    remediation: "Attach the payment proof or correct the payment status so the payable is accurate.",
    evaluate(ctx) {
      const status = String(ctx.history?.purchasePaymentStatus ?? "").toLowerCase();
      if (!ctx.history || status !== "paid") return passed;
      const total = money(ctx.history.billAmount);
      const paid = money(ctx.history.purchasePaidAmount);
      if (total <= 0) return passed;
      if (toPaiseInt(paid) >= toPaiseInt(total)) return passed;
      return triggered({
        paymentStatus: status,
        totalRupees: total,
        paidRupees: paid,
        shortfallRupees: Number((total - paid).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_PAYMENT_EXCEEDS_TOTAL",
    name: "Payment exceeds the purchase amount",
    description: "More money was recorded as paid than the purchase is worth.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 2,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_PAYMENT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.BANK_TRANSACTION],
    remediation: "Check for a double payment to the supplier and claim the excess as a credit.",
    evaluate(ctx) {
      const total = ctx.receipt ? money(ctx.receipt.totalAmount) : money(ctx.history?.billAmount);
      const paid = ctx.receipt ? money(ctx.receipt.paidAmount) : money(ctx.history?.purchasePaidAmount);
      if (toPaiseInt(total) <= 0 || toPaiseInt(paid) <= toPaiseInt(total)) return passed;
      return triggered({ totalRupees: total, paidRupees: paid, excessRupees: Number((paid - total).toFixed(2)) });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_RETURN_NOT_CREDITED",
    name: "Purchase return did not create a supplier credit or refund",
    description: "A purchase return exists for this receipt but records neither a supplier credit nor a refund amount.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_RETURNED],
    evidenceTypes: [EVIDENCE_TYPES.SUPPLIER_INVOICE_NUMBER, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION],
    remediation: "Record the debit note with the supplier so the returned goods reduce what you owe.",
    evaluate(ctx) {
      const offenders = (ctx.returns ?? [])
        .filter((ret) => ret.status !== "cancelled")
        .filter((ret) => money(ret.supplierCreditAmount) <= 0 && money(ret.refundAmount) <= 0 && money(ret.totalAmount) > 0)
        .map((ret) => ({
          purchaseReturnId: ret.id,
          returnNumber: ret.returnNumber,
          totalAmountRupees: money(ret.totalAmount),
          refundMode: ret.refundMode,
        }));
      if (!offenders.length) return passed;
      return triggered({ uncreditedReturns: offenders, returnCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_MISSING_INVOICE_EVIDENCE",
    name: "Purchase above threshold has no supplier invoice number",
    description: "A material purchase was recorded without a supplier invoice number, so there is no document trail for the spend.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.HIGH,
    defaultWeight: 25,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.SUPPLIER_INVOICE_NUMBER],
    remediation: "Collect and record the supplier invoice number. Purchases without invoices cannot be verified or claimed.",
    evaluate(ctx) {
      const threshold = ctx.settings.purchaseInvoiceRequiredAbovePaise;
      const amountPaise = toPaiseInt(purchaseAmount(ctx));
      if (amountPaise <= threshold) return passed;
      if (invoiceNumber(ctx)) return passed;
      return triggered({
        amountRupees: purchaseAmount(ctx),
        thresholdRupees: threshold / 100,
        supplierInvoiceNumber: null,
        supplierName: ctx.receipt?.supplier?.name ?? ctx.history?.supplierName ?? null,
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_SUPPLIER_IDENTITY_MISSING",
    name: "Supplier identity details missing",
    description: "This purchase has no linked supplier record, or the supplier has neither a phone number nor an address.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SUPPLIER_INVOICE_NUMBER, EVIDENCE_TYPES.PURCHASE_INVOICE],
    remediation: "Complete the supplier's contact details so purchases are traceable to a real party.",
    evaluate(ctx) {
      const supplier = ctx.supplier ?? null;
      const amountPaise = toPaiseInt(purchaseAmount(ctx));
      if (amountPaise <= ctx.settings.purchaseInvoiceRequiredAbovePaise) return passed;
      if (!supplier) {
        return triggered({
          reason: "no_supplier_record",
          supplierNameOnPurchase: ctx.receipt?.supplierInvoiceNumber ? null : ctx.history?.supplierName ?? null,
          amountRupees: purchaseAmount(ctx),
        });
      }
      const hasMobile = supplier.mobile && String(supplier.mobile).trim();
      const hasAddress = supplier.address && String(supplier.address).trim();
      if (hasMobile || hasAddress) return passed;
      return triggered({
        reason: "supplier_contact_missing",
        supplierId: supplier.id,
        supplierName: supplier.name,
        amountRupees: purchaseAmount(ctx),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_LARGE_NEW_SUPPLIER",
    name: "Large purchase from a brand-new supplier",
    description: "A material purchase was booked against a supplier that was created within the last 30 days.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION],
    remediation: "Verify the new supplier is genuine and the goods were received before releasing payment.",
    evaluate(ctx) {
      const supplier = ctx.supplier;
      if (!supplier?.createdAt) return passed;
      const NEW_SUPPLIER_DAYS = 30;
      const ageDays = (purchaseCreatedAt(ctx).getTime() - new Date(supplier.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays > NEW_SUPPLIER_DAYS || ageDays < 0) return passed;
      const amountPaise = toPaiseInt(purchaseAmount(ctx));
      if (amountPaise <= ctx.settings.largeAdjustmentPaise) return passed;
      return triggered({
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierAgeDays: Math.round(ageDays),
        newSupplierWindowDays: NEW_SUPPLIER_DAYS,
        amountRupees: purchaseAmount(ctx),
        thresholdRupees: ctx.settings.largeAdjustmentPaise / 100,
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_RECORDED_AFTER_CLOSING_LOCK",
    name: "Purchase for a locked day recorded after the closing lock",
    description: "The purchase belongs to a business day whose closing is locked, but it was written after the lock.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.PURCHASE_INVOICE],
    remediation: "Re-open, refresh and re-lock that day's closing so cash and purchases agree.",
    evaluate(ctx) {
      const snapshot = ctx.closingSnapshot;
      if (!snapshot?.lockedAt) return passed;
      const lockedAt = new Date(snapshot.lockedAt).getTime();
      const recordedAt = purchaseCreatedAt(ctx).getTime();
      if (recordedAt <= lockedAt) return passed;
      return triggered({
        closingSnapshotId: snapshot.id,
        closingLockedAt: new Date(snapshot.lockedAt).toISOString(),
        purchaseRecordedAt: new Date(recordedAt).toISOString(),
        amountRupees: purchaseAmount(ctx),
      });
    },
  }),

  defineRule({
    ruleCode: "PURCHASE_RECORDED_AFTER_STOCK_SOLD",
    name: "Purchase recorded after the goods were already sold",
    description: "The products in this purchase had already been sold into negative stock before the purchase was recorded, so margins for those sales used a stale cost.",
    category: RULE_CATEGORIES.PURCHASE,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: PURCHASE,
    applicableEventTypes: [EVENT_TYPES.PURCHASE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.PURCHASE_INVOICE, EVIDENCE_TYPES.GOODS_RECEIPT_CONFIRMATION],
    remediation: "Record purchases as goods arrive. Late entry is not fraud by itself but makes profit reporting unreliable.",
    evaluate(ctx) {
      const priorNegative = ctx.priorNegativeSales ?? [];
      if (!priorNegative.length) return passed;
      return triggered({
        purchaseRecordedAt: purchaseCreatedAt(ctx).toISOString(),
        priorOversoldMovements: priorNegative.slice(0, 20).map((row) => ({
          movementId: row.id,
          productId: row.productId,
          productName: row.productName,
          closingBaseQty: Number(row.newStockBaseQty),
          soldAt: new Date(row.createdAt).toISOString(),
        })),
        movementCount: priorNegative.length,
      });
    },
  }),
];
