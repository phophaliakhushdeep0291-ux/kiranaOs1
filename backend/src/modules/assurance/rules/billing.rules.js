// A. BILLING RULES — deterministic checks over Bill / BillItem / Payment.
// Reference: docs/AUDIT_RULE_CATALOG.md section A.
import {
  ENTITY_TYPES,
  EVENT_TYPES,
  EVIDENCE_TYPES,
  RULE_CATEGORIES,
  SEVERITY,
} from "../assurance.constants.js";
import {
  defineRule,
  fromPaiseInt,
  money,
  moneyDiffers,
  passed,
  percentOf,
  sum,
  toPaiseInt,
  triggered,
} from "../rule.interface.js";

const BILL = [ENTITY_TYPES.BILL];

// Estimates are financially real in KiranaOS (they move stock, tender and
// udhar). Only the legacy "quote-shaped" estimate — no payments, no credit —
// is exempt from payment-coverage rules.
function isLegacyQuoteEstimate(bill) {
  return (
    bill.billType === "estimate" &&
    (bill.payments?.length ?? 0) === 0 &&
    money(bill.creditAmount) <= 0
  );
}

function confirmedPaymentTotal(bill) {
  return sum((bill.payments ?? []).filter((p) => p.status === "confirmed").map((p) => p.amount));
}

export const billingRules = [
  defineRule({
    ruleCode: "BILL_DUPLICATE_NUMBER",
    name: "Duplicate bill number",
    description: "Another bill in this shop carries the same bill number. Bill numbers must be unique per shop.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 35,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Confirm which bill the customer actually received and renumber or cancel the duplicate through the normal billing flow.",
    evaluate(ctx) {
      if (!ctx.sameBillNo?.length) return passed;
      return triggered({
        billNo: ctx.bill.billNo,
        duplicateBillIds: ctx.sameBillNo.map((b) => b.id),
        duplicateCount: ctx.sameBillNo.length,
      });
    },
  }),

  // DEFERRED (was BILL_WEAK_IDEMPOTENCY): "a bill from the offline queue with no
  // durable idempotency identity". Bill.sourceDeviceId is populated from the
  // request's device header for EVERY sale, online or offline, and no column
  // marks offline origin, so this rule could not distinguish an ordinary counter
  // sale from an offline replay — it fired on essentially every bill. Duplicate
  // retries are already covered by the @@unique idempotency constraints plus
  // BILL_NEAR_DUPLICATE and BILL_SYNC_RETRY_STORM. See docs/AUDIT_LIMITATIONS.md.

  defineRule({
    ruleCode: "BILL_NEAR_DUPLICATE",
    name: "Near-duplicate bill within a short window",
    description: "Another bill for the same customer with the same total and the same item signature exists within a 10-minute window.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.HIGH,
    defaultWeight: 24,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Ask the counter whether the customer was billed twice. Cancel the duplicate through the billing screen if confirmed.",
    evaluate(ctx) {
      const candidates = ctx.duplicateCandidates ?? [];
      if (!candidates.length) return passed;
      const { bill } = ctx;
      const signature = itemSignature(bill.items);
      let matches = candidates.filter((candidate) => itemSignature(candidate.items) === signature);
      if (!matches.length) return passed;

      // Only identified customers are checked. Two walk-in customers buying the
      // same item for the same amount within a minute of each other is ordinary
      // trade at a busy counter — measured on real shop data, that pattern was
      // 24 seconds apart and entirely innocent. With no customer on the bill
      // there is nothing that separates a double-submit from two real sales, and
      // a rule that cannot tell them apart should not fire at all. Genuine
      // retries still surface through BILL_SYNC_RETRY_STORM and the durable
      // idempotency constraints.
      if (!bill.customerId) return passed;

      const windowSeconds = 10 * 60;
      return triggered({
        grandTotal: money(bill.grandTotal),
        itemSignature: signature,
        matchingBillIds: matches.map((b) => b.id),
        customerIdentified: true,
        windowSeconds,
        windowMinutes: Number((windowSeconds / 60).toFixed(2)),
        innocentExplanation: "The same customer may genuinely have bought the same items twice. Confirm before treating this as a duplicate.",
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_TOTAL_MISMATCH",
    name: "Bill total does not equal item totals minus discounts plus tax",
    description: "The stored grand total does not reproduce from the bill's own line totals, discounts and tax mode.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 40,
    version: 2,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE],
    remediation: "Do not edit the bill. Raise a corrective sales return or cancellation so the arithmetic trail stays intact.",
    evaluate(ctx) {
      const { bill } = ctx;
      const lineTotal = sum(bill.items.map((i) => i.lineTotal));
      const billDiscount = money(bill.discount) + money(bill.loyaltyDiscount);
      const expected =
        bill.gstMode === "exclusive"
          ? lineTotal - billDiscount + money(bill.gst)
          : lineTotal - billDiscount;
      if (!moneyDiffers(expected, bill.grandTotal)) return passed;
      return triggered({
        lineTotalSum: lineTotal,
        discount: money(bill.discount),
        loyaltyDiscount: money(bill.loyaltyDiscount),
        gstMode: bill.gstMode,
        gst: money(bill.gst),
        expectedGrandTotal: expected,
        storedGrandTotal: money(bill.grandTotal),
        differenceRupees: Number((money(bill.grandTotal) - expected).toFixed(2)),
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_PAID_EXCEEDS_TOTAL",
    name: "Paid amount exceeds bill total",
    description: "The settled tender magnitude is larger than the bill total. Sales returns use negative amounts and are compared by magnitude.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 2,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.PAYMENT_RECEIVED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Confirm the tender collected. If the customer overpaid, record a refund or credit rather than editing the bill.",
    evaluate(ctx) {
      const { bill } = ctx;
      const paidPaise = toPaiseInt(bill.paidAmount);
      const totalPaise = toPaiseInt(bill.grandTotal);
      const excessPaise = bill.billType === "sales_return"
        ? Math.max(0, Math.abs(paidPaise) - Math.abs(totalPaise))
        : Math.max(0, paidPaise - totalPaise);
      if (excessPaise === 0) return passed;
      return triggered({
        paidAmount: fromPaiseInt(paidPaise),
        grandTotal: fromPaiseInt(totalPaise),
        excessRupees: fromPaiseInt(excessPaise),
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_OUTSTANDING_MISMATCH",
    name: "Credit amount does not equal total minus paid and waived",
    description: "The udhar (credit) portion of the bill does not equal grand total minus paid amount minus waived amount.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 2,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.CUSTOMER_CREDIT_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "Reconcile the customer's khata against this bill and post a corrective ledger entry through the udhar screen.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (isLegacyQuoteEstimate(bill)) return passed;
      const expectedCredit = money(bill.grandTotal) - money(bill.paidAmount) - money(bill.waivedAmount);
      if (!moneyDiffers(expectedCredit, bill.creditAmount)) return passed;
      return triggered({
        grandTotal: money(bill.grandTotal),
        paidAmount: money(bill.paidAmount),
        waivedAmount: money(bill.waivedAmount),
        expectedCreditAmount: Number(expectedCredit.toFixed(2)),
        storedCreditAmount: money(bill.creditAmount),
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_MARKED_PAID_WITHOUT_PAYMENTS",
    name: "Bill paid amount does not match settled payment rows",
    description: "The bill's paid amount does not exactly equal its confirmed payment rows, including negative refund rows on sales returns.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 38,
    version: 2,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.PAYMENT_RECEIVED],
    evidenceTypes: [EVIDENCE_TYPES.PAYMENT_RECEIPT, EVIDENCE_TYPES.UPI_REFERENCE, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Establish whether the money was actually received or refunded. Record the missing payment through the normal flow; never edit the bill total.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (isLegacyQuoteEstimate(bill)) return passed;
      const paymentSum = confirmedPaymentTotal(bill);
      const declaredPaid = money(bill.paidAmount);
      if (!moneyDiffers(declaredPaid, paymentSum)) return passed;
      return triggered({
        declaredPaidAmount: declaredPaid,
        confirmedPaymentSum: paymentSum,
        shortfallRupees: fromPaiseInt(Math.abs(toPaiseInt(declaredPaid) - toPaiseInt(paymentSum))),
        paymentRowCount: bill.payments?.length ?? 0,
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_BILL_MISSING_LEDGER_DEBIT",
    name: "Credit bill did not create a customer ledger debit",
    description: "The bill carries a credit (udhar) amount but no matching udhar ledger debit exists, so the customer's outstanding never increased.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 36,
    version: 2,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION, EVIDENCE_TYPES.SALES_INVOICE],
    remediation: "Post the missing udhar debit through the customer's khata so the outstanding reflects this credit sale.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.status === "cancelled") return passed;
      const credit = money(bill.creditAmount);
      if (credit <= 0) return passed;
      const debits = (ctx.udharRows ?? []).filter((row) => row.type === "debit" && !row.reversedAt);
      const debitSum = sum(debits.map((row) => row.amount));
      if (!moneyDiffers(debitSum, credit)) return passed;
      return triggered({
        billCreditAmount: credit,
        ledgerDebitSum: Number(debitSum.toFixed(2)),
        ledgerDebitCount: debits.length,
        customerId: bill.customerId,
      });
    },
  }),

  defineRule({
    ruleCode: "UDHAR_RETURN_MISSING_LEDGER_CREDIT",
    name: "Udhar refund missing from the customer ledger",
    description: "A sales return was refunded to udhar but the matching customer-ledger payment is missing or has the wrong amount.",
    category: RULE_CATEGORIES.CUSTOMER_CREDIT,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 36,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_RETURNED, EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.CUSTOMER_CONFIRMATION, EVIDENCE_TYPES.SALES_INVOICE],
    remediation: "Post the missing return credit through the customer's khata so the return reduces outstanding exactly once.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.status === "cancelled" || bill.billType !== "sales_return" || bill.refundMode !== "udhar") return passed;
      const expectedPaise = Math.abs(toPaiseInt(bill.creditAmount || bill.grandTotal));
      const creditedPaise = (ctx.udharRows ?? [])
        .filter((row) => row.type === "payment" && row.mode === "return" && !row.reversedAt)
        .reduce((total, row) => total + Math.abs(toPaiseInt(row.amount)), 0);
      if (creditedPaise === expectedPaise) return passed;
      return triggered({
        expectedReturnCreditRupees: fromPaiseInt(expectedPaise),
        ledgerReturnCreditRupees: fromPaiseInt(creditedPaise),
        differenceRupees: fromPaiseInt(Math.abs(creditedPaise - expectedPaise)),
        customerId: bill.customerId,
      });
    },
  }),
  defineRule({
    ruleCode: "CANCELLED_BILL_STILL_IN_LEDGER",
    name: "Cancelled bill still contributes to financial reports",
    description: "The bill is cancelled but its accounting ledger rows do not net to zero, so derived sales and cash reports still include it.",
    category: RULE_CATEGORIES.RECONCILIATION,
    severity: SEVERITY.CRITICAL,
    defaultWeight: 38,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED],
    evidenceTypes: [EVIDENCE_TYPES.CANCELLATION_REASON],
    remediation: "Re-run the cancellation reversal for this bill so the ledger nets to zero. Never delete the original rows.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.status !== "cancelled") return passed;
      const rows = ctx.financialLedgerRows ?? [];
      // Ledger rows for a cancelled bill must net to zero per entryType: a
      // reversal is the same entryType with a negated amount.
      const netByEntryType = new Map();
      for (const row of rows) {
        const key = row.entryType;
        const current = netByEntryType.get(key) ?? 0n;
        netByEntryType.set(key, current + BigInt(row.amountPaise ?? 0));
      }
      const residual = [...netByEntryType.entries()]
        .filter(([, netPaise]) => netPaise !== 0n)
        .map(([entryType, netPaise]) => ({ entryType, netPaise: Number(netPaise) }));
      if (!residual.length) return passed;
      return triggered({
        cancelledAt: bill.cancelledAt ? new Date(bill.cancelledAt).toISOString() : null,
        ledgerRowCount: rows.length,
        residualEntries: residual,
      });
    },
  }),

  defineRule({
    ruleCode: "CANCELLED_BILL_STOCK_NOT_RESTORED",
    name: "Cancelled bill did not restore inventory",
    description: "The bill is cancelled but its stock movements do not net to zero, so inventory is still reduced by a sale that no longer exists.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 30,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.CANCELLATION_REASON],
    remediation: "Verify physical stock and post an authorized stock correction with a reason, or re-run the cancellation reversal.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.status !== "cancelled") return passed;
      const rows = ctx.stockRows ?? [];
      if (!rows.length) return passed;
      const netByProduct = new Map();
      for (const row of rows) {
        netByProduct.set(row.productId, (netByProduct.get(row.productId) ?? 0) + Number(row.changeBaseQty ?? 0));
      }
      const unrestored = [...netByProduct.entries()]
        .filter(([, net]) => Math.abs(net) > 0.0001)
        .map(([productId, netBaseQty]) => ({ productId, netBaseQty: Number(netBaseQty.toFixed(4)) }));
      if (!unrestored.length) return passed;
      return triggered({ movementCount: rows.length, unrestoredProducts: unrestored });
    },
  }),

  defineRule({
    ruleCode: "RETURN_BILL_STOCK_NOT_REVERSED",
    name: "Sales return did not put stock back",
    description: "This bill is a sales return but no positive stock movement was recorded for the returned goods.",
    category: RULE_CATEGORIES.INVENTORY,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_RETURNED],
    evidenceTypes: [EVIDENCE_TYPES.STOCK_COUNT_CONFIRMATION, EVIDENCE_TYPES.CUSTOMER_CONFIRMATION],
    remediation: "If the goods came back, record the stock-in with a correction reason. If they did not, the refund needs review.",
    evaluate(ctx) {
      const { bill } = ctx;
      if (bill.billType !== "sales_return") return passed;
      const productLines = (bill.items ?? []).filter((item) => item.productId);
      if (!productLines.length) return passed;
      const stockIn = (ctx.stockRows ?? []).filter((row) => Number(row.changeBaseQty ?? 0) > 0);
      if (stockIn.length) return passed;
      return triggered({
        returnOfBillId: bill.returnOfBillId,
        returnedLineCount: productLines.length,
        positiveStockMovements: 0,
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_EXCESSIVE_DISCOUNT",
    name: "Discount above the configured ceiling",
    description: "The bill's total discount percentage exceeds the shop's configured maximum discount.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 20,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.DISCOUNT_APPLIED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Confirm the discount was authorized. Record the approval, or adjust the shop's discount ceiling if this is normal trade practice.",
    evaluate(ctx) {
      const { bill, settings } = ctx;
      const lineTotal = sum(bill.items.map((i) => i.lineTotal));
      const discount = money(bill.discount);
      if (discount <= 0) return passed;
      const gross = lineTotal + discount;
      const discountPercent = percentOf(discount, gross);
      if (discountPercent <= settings.maxDiscountPercent) return passed;
      return triggered({
        discountRupees: discount,
        grossBeforeDiscount: Number(gross.toFixed(2)),
        discountPercent: Number(discountPercent.toFixed(2)),
        configuredMaxPercent: settings.maxDiscountPercent,
        offerDiscount: money(bill.offerDiscount),
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_DISCOUNT_WITHOUT_AUTHORIZATION",
    name: "Large manual discount by non-owner without a recorded reason",
    description: "A staff member applied a manual discount above the configured ceiling and no discount reason or owner approval is recorded.",
    category: RULE_CATEGORIES.AUTHORIZATION,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.DISCOUNT_APPLIED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Ask the staff member for the reason and record owner approval. Consider enabling owner-PIN gating for discounts.",
    evaluate(ctx) {
      const { bill, settings, createdByUser } = ctx;
      const manualDiscount = money(bill.discount) - money(bill.offerDiscount) - money(bill.loyaltyDiscount);
      if (manualDiscount <= 0) return passed;
      const lineTotal = sum(bill.items.map((i) => i.lineTotal));
      const discountPercent = percentOf(manualDiscount, lineTotal + money(bill.discount));
      if (discountPercent <= settings.maxDiscountPercent) return passed;
      // Owner-created discounts are self-authorizing.
      if (!createdByUser || createdByUser.role === "owner") return passed;
      if (bill.discountReason && String(bill.discountReason).trim().length > 0) return passed;
      const hasApprovalLog = (ctx.auditLogs ?? []).some((log) => log.action === "OWNER_PIN_VERIFIED" || log.action === "DISCOUNT_APPROVED");
      if (hasApprovalLog) return passed;
      return triggered({
        manualDiscountRupees: Number(manualDiscount.toFixed(2)),
        discountPercent: Number(discountPercent.toFixed(2)),
        configuredMaxPercent: settings.maxDiscountPercent,
        createdByRole: createdByUser.role,
        discountReason: null,
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_BACKDATED_INTO_LOCKED_DAY",
    name: "Bill backdated into a locked day",
    description: "The bill's own timestamp falls inside a locked business day and before the lock, but it only reached the server after that day was locked — so it silently changed figures that were already signed off.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 28,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Late offline sales are legitimate, but the affected day's closing must be re-opened, refreshed and re-locked with owner approval.",
    evaluate(ctx) {
      const snapshot = ctx.closingSnapshot;
      if (!snapshot?.lockedAt) return passed;
      const lockedAt = new Date(snapshot.lockedAt).getTime();
      const billTime = new Date(ctx.bill.createdAt).getTime();
      // A sale simply made later in the day is not backdated. That case is
      // reported once on the closing itself (CLOSING_LATE_TRANSACTION_AFTER_LOCK)
      // rather than on every bill, which would flood the shop with findings.
      if (billTime > lockedAt) return passed;

      // Bill timestamps are server-assigned, so the only way a bill can carry a
      // pre-lock timestamp yet arrive post-lock is an offline replay. Without
      // that trail there is nothing to prove and the rule stays silent.
      const lateSyncEvents = (ctx.syncEvents ?? []).filter((event) => new Date(event.createdAt).getTime() > lockedAt);
      if (!lateSyncEvents.length) return passed;

      return triggered({
        closingSnapshotId: snapshot.id,
        closingLockedAt: new Date(lockedAt).toISOString(),
        billTimestamp: new Date(billTime).toISOString(),
        syncedAfterLockAt: new Date(lateSyncEvents[0].createdAt).toISOString(),
        minutesLate: Math.round((new Date(lateSyncEvents[0].createdAt).getTime() - lockedAt) / 60000),
        syncEventIds: lateSyncEvents.map((event) => event.id),
        grandTotal: money(ctx.bill.grandTotal),
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_EDITED_AFTER_CLOSING_LOCK",
    name: "Bill changed after the day's closing was locked",
    description: "The bill was modified after its business day's closing snapshot was locked, and no owner approval is recorded for the change.",
    category: RULE_CATEGORIES.CASH_CLOSING,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.RECORD_EDITED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.CORRECTION_REASON],
    remediation: "Record why the bill changed after closing and re-lock the day's closing snapshot.",
    evaluate(ctx) {
      const snapshot = ctx.closingSnapshot;
      if (!snapshot?.lockedAt) return passed;
      const lockedAt = new Date(snapshot.lockedAt).getTime();
      const updatedAt = new Date(ctx.bill.updatedAt).getTime();
      const createdAt = new Date(ctx.bill.createdAt).getTime();
      // Only an edit after the lock counts; creation after the lock is covered
      // by BILL_RECORDED_AFTER_CLOSING_LOCK.
      if (updatedAt <= lockedAt || updatedAt <= createdAt + 1000) return passed;
      if (createdAt > lockedAt) return passed;
      const approvals = (ctx.auditLogs ?? []).filter(
        (log) => new Date(log.createdAt).getTime() >= lockedAt && ["OWNER_PIN_VERIFIED", "BILL_CANCELLED", "DISCOUNT_APPROVED"].includes(log.action)
      );
      if (approvals.length) return passed;
      return triggered({
        closingLockedAt: new Date(snapshot.lockedAt).toISOString(),
        billUpdatedAt: new Date(ctx.bill.updatedAt).toISOString(),
        approvalLogCount: 0,
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_INVALID_QUANTITY",
    name: "Impossible line quantity",
    description: "A bill line has a zero, negative or non-finite quantity.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.HIGH,
    defaultWeight: 26,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.SALES_INVOICE, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Verify what was actually sold and re-bill correctly. Impossible quantities usually indicate a client bug or a manual override.",
    evaluate(ctx) {
      // A sales return is stored as a mirror image of the sale: negative
      // quantities AND a negative total. Those negatives are correct by design,
      // so the sign test only applies to forward sales. For a return, "invalid"
      // means the quantity points the wrong way (positive) or is zero.
      const isReturn = ctx.bill.billType === "sales_return";
      const offenders = (ctx.bill.items ?? [])
        .filter((item) => {
          const qty = Number(item.quantity);
          const baseQty = Number(item.quantityInBaseUnit);
          if (!Number.isFinite(qty) || !Number.isFinite(baseQty)) return true;
          if (qty === 0 || baseQty === 0) return true;
          return isReturn ? qty > 0 || baseQty > 0 : qty < 0 || baseQty < 0;
        })
        .map((item) => ({ billItemId: item.id, name: item.name, quantity: item.quantity, quantityInBaseUnit: item.quantityInBaseUnit }));
      if (!offenders.length) return passed;
      return triggered({ billType: ctx.bill.billType, expectedSign: isReturn ? "negative" : "positive", invalidLines: offenders });
    },
  }),

  defineRule({
    ruleCode: "BILL_ZERO_PRICE_ITEM",
    name: "Item billed at zero price without a reason",
    description: "A bill line was sold at zero rate and carries no note, override reason or approval.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED, EVENT_TYPES.DISCOUNT_APPLIED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.OWNER_APPROVAL],
    remediation: "Record why the item was free (sample, replacement, scheme) so the giveaway is traceable.",
    evaluate(ctx) {
      const offenders = (ctx.bill.items ?? [])
        .filter((item) => {
          if (money(item.ratePerRateUnit) > 0) return false;
          if (item.note && String(item.note).trim()) return false;
          if (item.priceOverrideReason && String(item.priceOverrideReason).trim()) return false;
          return true;
        })
        .map((item) => ({ billItemId: item.id, name: item.name, quantity: item.quantity }));
      if (!offenders.length) return passed;
      return triggered({ zeroPriceLines: offenders, lineCount: offenders.length });
    },
  }),

  defineRule({
    ruleCode: "BILL_SOLD_BELOW_COST",
    name: "Item sold below recorded purchase cost",
    description: "A line's selling rate is below its recorded cost by more than the configured tolerance.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 18,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CREATED],
    evidenceTypes: [EVIDENCE_TYPES.OWNER_APPROVAL, EVIDENCE_TYPES.STAFF_EXPLANATION],
    remediation: "Check whether the cost price is stale or the sale was a loss-leader. Update the product cost or record the approval.",
    evaluate(ctx) {
      const tolerance = ctx.settings.belowCostTolerancePercent;
      const offenders = [];
      for (const item of ctx.bill.items ?? []) {
        const cost = money(item.costPerRateUnit);
        const rate = money(item.ratePerRateUnit);
        if (cost <= 0 || rate <= 0) continue;
        const shortfallPercent = percentOf(cost - rate, cost);
        if (shortfallPercent > tolerance) {
          offenders.push({
            billItemId: item.id,
            name: item.name,
            ratePerRateUnit: rate,
            costPerRateUnit: cost,
            shortfallPercent: Number(shortfallPercent.toFixed(2)),
          });
        }
      }
      if (!offenders.length) return passed;
      return triggered({ tolerancePercent: tolerance, belowCostLines: offenders });
    },
  }),

  defineRule({
    ruleCode: "STAFF_EXCESSIVE_CANCELLATIONS",
    name: "High bill-cancellation rate for this staff member",
    description: "The staff member who created this bill has cancelled an unusually high share of their bills over the last 30 days.",
    category: RULE_CATEGORIES.BILLING,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.SALE_CANCELLED],
    evidenceTypes: [EVIDENCE_TYPES.STAFF_EXPLANATION, EVIDENCE_TYPES.CANCELLATION_REASON],
    remediation: "Review the cancellations with the staff member. Frequent cancellations can be training issues or leakage.",
    evaluate(ctx) {
      const bills = ctx.staffRecentBills ?? [];
      const MIN_SAMPLE = 20;
      if (bills.length < MIN_SAMPLE) return passed;
      const cancelled = bills.filter((b) => b.status === "cancelled").length;
      const rate = cancelled / bills.length;
      if (rate <= ctx.settings.staffCancellationRateAlert) return passed;
      return triggered({
        createdByUserId: ctx.bill.createdByUserId,
        billsLast30Days: bills.length,
        cancelledCount: cancelled,
        cancellationRate: Number(rate.toFixed(3)),
        alertThreshold: ctx.settings.staffCancellationRateAlert,
        minimumSample: MIN_SAMPLE,
      });
    },
  }),

  defineRule({
    ruleCode: "BILL_SYNC_RETRY_STORM",
    name: "Repeated sync attempts for the same bill",
    description: "This bill's sync identity appears in multiple offline sync events or was retried repeatedly, which is how duplicate sales are created.",
    category: RULE_CATEGORIES.SYNC_INTEGRITY,
    severity: SEVERITY.MEDIUM,
    defaultWeight: 16,
    version: 1,
    applicableEntityTypes: BILL,
    applicableEventTypes: [EVENT_TYPES.OFFLINE_EVENT_SYNCED],
    evidenceTypes: [EVIDENCE_TYPES.DEVICE_TIMESTAMP_METADATA],
    remediation: "Confirm only one bill was created for this sale. Investigate the device's connectivity and app version if retries repeat.",
    evaluate(ctx) {
      const events = ctx.syncEvents ?? [];
      if (events.length <= 1) {
        const single = events[0];
        if (!single || Number(single.attempts ?? 0) < 3) return passed;
        return triggered({ syncEventIds: [single.id], attempts: single.attempts, distinctEvents: 1 });
      }
      return triggered({
        syncEventIds: events.map((e) => e.id),
        distinctEvents: events.length,
        statuses: [...new Set(events.map((e) => e.status))],
        maxAttempts: Math.max(...events.map((e) => Number(e.attempts ?? 0))),
      });
    },
  }),
];

function itemSignature(items = []) {
  return items
    .map((item) => `${item.productId ?? "adhoc"}x${Number(item.quantity ?? 0).toFixed(3)}`)
    .sort()
    .join("|");
}
