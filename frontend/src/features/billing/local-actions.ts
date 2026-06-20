import { offlineDB } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { billCreationSchema, ownerPinRequiredActionSchema } from "@/lib/validation";
import { createLocalId, emitLocalDataChanged, normaliseInstantCacheValue, readInstantCache, upsertCachedListItem, writeInstantMemoryCache } from "@/lib/offline/instant-cache";
import { buildOutboxOperation, enqueueOutboxOperation } from "@/features/sync/outbox";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { normaliseLocalCustomer } from "@/features/customers/local-actions";
import type { Bill, BillInput, BillInputItem, BillPayment, Customer } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow, type AuditLogRow } from "@/features/audit-logs/local-actions";
import { BillPaymentMode } from "@/types/api";

const BILL_CACHE_KEY = "bills";
const CUSTOMER_CACHE_KEY = "customers";

type SensitiveBillAction = "large_discount" | "selling_below_minimum_price" | string;
type GstMode = NonNullable<BillInput["gstMode"]>;

function readSensitiveBillActions(input: BillInput): SensitiveBillAction[] {
  return Array.from(new Set((input.sensitiveActions ?? [])
    .map((action) => String(action).trim())
    .filter(Boolean)));
}

function validateSensitiveBillApproval(input: BillInput, actions: SensitiveBillAction[]) {
  if (actions.length === 0) return;
  const action = actions.includes("large_discount") ? "large_discount" : "price_below_minimum";
  parseOrThrow(ownerPinRequiredActionSchema, {
    action,
    ownerPin: input.ownerPin,
    reason: input.reason,
    entityId: "new_bill",
  });
}

function buildSensitiveBillAuditLogs(bill: Bill, source: BillInput, actions: SensitiveBillAction[]): AuditLogRow[] {
  return actions.map((action) => buildAuditLogRow({
    action,
    entityType: "bill",
    entityId: bill.id,
    entityLabel: bill.billNumber ?? bill.billNo,
    newValue: { bill, sensitiveAction: action },
    reason: source.reason || `${action.replaceAll("_", " ")} approved by owner`,
    ownerPinProvided: true,
    summary: `${action.replaceAll("_", " ")} approved for bill ${bill.billNumber ?? bill.billNo}`,
  }));
}

function isSyncedBillRecord(bill: Bill & Record<string, unknown>): boolean {
  if (typeof bill.isSynced === "boolean") return bill.isSynced;
  if (typeof bill.is_synced === "boolean") return bill.is_synced;
  const syncStatus = String(bill.sync_status ?? "").toLowerCase();
  const status = String(bill.status ?? "").toLowerCase();
  return !["local_only", "pending_sync", "syncing", "failed", "conflict", "draft"].includes(syncStatus || status);
}

function withBillAliases(bill: Bill): Bill {
  const synced = isSyncedBillRecord(bill as Bill & Record<string, unknown>);
  return {
    ...bill,
    billNumber: bill.billNumber ?? bill.billNo,
    totalAmount: bill.totalAmount ?? bill.grandTotal ?? 0,
    netAmount: bill.netAmount ?? bill.grandTotal ?? 0,
    isSynced: synced,
    is_synced: synced,
  };
}

function getCreditAmount(payments: BillPayment[]) {
  return payments.filter((payment) => payment.mode === BillPaymentMode.credit).reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0);
}

interface CreditCustomerPreparation {
  billData: BillInput;
  customerToPut?: Customer & Record<string, unknown>;
  customerCacheItem?: Customer;
  customerCreateOutbox?: ReturnType<typeof buildOutboxOperation>;
  previousCustomerBalance: number;
}

function matchesCustomer(customer: Customer & Record<string, unknown>, id: string) {
  return customer.id === id || customer.local_id === id || customer.server_id === id;
}

async function prepareCustomerForCreditBill(data: BillInput, creditAmount: number): Promise<CreditCustomerPreparation> {
  if (creditAmount <= 0) return { billData: data, previousCustomerBalance: 0 };
  const now = new Date().toISOString();
  const cachedCustomers = readInstantCache<Customer[]>(CUSTOMER_CACHE_KEY, []).map(normaliseLocalCustomer) as Array<Customer & Record<string, unknown>>;
  const dbCustomers = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const customers = [...cachedCustomers, ...dbCustomers.filter((row) => !cachedCustomers.some((cached) => cached.id === row.id))];

  if (data.customerId) {
    const existing = customers.find((customer) => matchesCustomer(customer, data.customerId!));
    if (existing) {
      const previousCustomerBalance = readNumber(existing.udharAmount ?? existing.totalUdhar, 0);
      const nextUdhar = roundMoney(previousCustomerBalance + creditAmount);
      const updatedCustomer = normaliseLocalCustomer({ ...existing, type: "udhar", udharAmount: nextUdhar, totalUdhar: nextUdhar, updatedAt: now });
      const updated = { ...updatedCustomer, updated_at: now } as Customer & Record<string, unknown>;
      const serverCustomerId = typeof existing.server_id === "string" ? existing.server_id : existing.id;
      const localCustomerId = typeof existing.local_id === "string" ? existing.local_id : existing.id;
      return {
        billData: {
          ...data,
          customerId: serverCustomerId,
          localCustomerId,
          customerName: data.customerName ?? existing.name,
          customerMobile: data.customerMobile ?? existing.mobile ?? undefined,
        } as unknown as BillInput,
        // This is an optimistic projection of the append-only ledger entry below,
        // not an independent customer edit. Marking the customer pending created a
        // false customer conflict when the server returned the same derived balance.
        customerToPut: {
          ...updated,
          sync_status: String(existing.sync_status ?? "synced"),
          balance_derived_from_local_ledger: true,
        },
        customerCacheItem: updated,
        previousCustomerBalance,
      };
    }
    return { billData: data, previousCustomerBalance: 0 };
  }

  if (!data.customerName || data.customerName === "Walk-in") return { billData: data, previousCustomerBalance: 0 };

  const customerId = createLocalId("customer");
  const customer = makeLocalEntity(normaliseLocalCustomer({
    id: customerId,
    name: data.customerName.trim(),
    mobile: data.customerMobile?.trim() || null,
    type: "udhar",
    udharAmount: creditAmount,
    totalUdhar: creditAmount,
    createdAt: now,
    updatedAt: now,
  }), "customer", "pending_sync") as unknown as Customer & Record<string, unknown>;

  // The customer is created with ZERO opening balance on the server: the bill's own
  // credit ledger entry (sent with CREATE_BILL) is the single source of this debt.
  // Seeding udharAmount here too would make the backend post an "opening balance"
  // ledger row AND the bill credit, double-counting the udhar (server diverging to
  // 2x the real balance). The local customer row still carries the balance for
  // instant UI; the server derives it from the bill ledger.
  const customerCreateOutbox = buildOutboxOperation({
    entity_type: "customer",
    entity_id: customer.id,
    operation_type: "CREATE_CUSTOMER",
    payload: {
      localCustomerId: customer.id,
      customer: {
        name: customer.name,
        mobile: customer.mobile,
        type: "udhar",
        udharAmount: 0,
        totalUdhar: 0,
        udhar_amount: 0,
        total_udhar: 0,
      },
    },
  });

  return {
    billData: { ...data, customerId, localCustomerId: customerId, customerName: customer.name, customerMobile: customer.mobile ?? data.customerMobile } as unknown as BillInput,
    customerToPut: customer,
    customerCacheItem: customer,
    customerCreateOutbox,
    previousCustomerBalance: 0,
  };
}

function buildBillItems(billId: string, items: BillInputItem[], gstMode: GstMode = "inclusive") {
  const now = new Date().toISOString();
  return items.map((item) => {
    const subtotal = roundMoney(item.quantity * item.ratePerRateUnit);
    const rate = readNumber(item.gstRate, 0);
    // Inclusive (default): tax is extracted from the entered price, line total
    // stays the entered amount. Exclusive: tax is added on top.
    const gst = gstMode === "exclusive"
      ? roundMoney(subtotal * rate / 100)
      : rate > 0 ? roundMoney(subtotal - subtotal / (1 + rate / 100)) : 0;
    return makeLocalEntity({
      id: createLocalId("bill_item"),
      billId,
      bill_id: billId,
      productId: item.productId ?? null,
      product_id: item.productId ?? null,
      name: item.name,
      quantity: item.quantity,
      enteredUnit: item.enteredUnit,
      entered_unit: item.enteredUnit,
      ratePerRateUnit: item.ratePerRateUnit,
      rate_per_rate_unit: item.ratePerRateUnit,
      gstRate: item.gstRate ?? 0,
      gst_rate: item.gstRate ?? 0,
      line_subtotal: subtotal,
      line_gst: gst,
      line_total: gstMode === "exclusive" ? roundMoney(subtotal + gst) : subtotal,
      createdAt: now,
    }, "bill_item", "pending_sync");
  });
}

function buildPayments(billId: string, customerId: string | undefined, payments: BillPayment[]) {
  const now = new Date().toISOString();
  return payments
    .filter((payment) => payment.mode !== BillPaymentMode.credit && readNumber(payment.amount, 0) > 0)
    .map((payment) => {
      const paymentId = createLocalId("payment");
      const idempotencyKey = `bill-payment:${billId}:${paymentId}`;
      return makeLocalEntity({
      id: paymentId,
      localPaymentId: paymentId,
      local_payment_id: paymentId,
      clientPaymentId: paymentId,
      client_payment_id: paymentId,
      idempotencyKey,
      idempotency_key: idempotencyKey,
      billId,
      bill_id: billId,
      localBillId: billId,
      local_bill_id: billId,
      clientBillId: billId,
      client_bill_id: billId,
      customerId: customerId ?? null,
      customer_id: customerId ?? null,
      localCustomerId: customerId ?? null,
      local_customer_id: customerId ?? null,
      mode: payment.mode,
      amount: roundMoney(payment.amount),
      paidAt: now,
      paid_at: now,
      createdAt: now,
    }, "payment", "pending_sync");
    });
}

function buildSaleMovements(billId: string, items: BillInputItem[]) {
  const now = new Date().toISOString();
  return items
    .filter((item) => item.productId)
    .map((item) => makeLocalEntity({
      id: createLocalId("stock_sale"),
      productId: item.productId,
      product_id: item.productId,
      type: "sale",
      action: "sale",
      quantityDelta: -Math.abs(item.quantity),
      quantity_delta: -Math.abs(item.quantity),
      unit: item.enteredUnit,
      reference_type: "bill",
      reference_id: billId,
      billId,
      note: `Bill ${billId}`,
      createdAt: now,
    }, "inventory_movement", "pending_sync"));
}

function calculateBillAmounts(data: BillInput) {
  // Mirrors the BillingPage GST engine and the backend: inclusive mode (kirana
  // MRP default) keeps the payable equal to the entered prices and extracts the
  // tax; exclusive mode adds tax on top of the entered prices.
  const rawGstMode = String((data as { gstMode?: string }).gstMode ?? "inclusive");
  const gstMode: GstMode = rawGstMode === "exclusive" || rawGstMode === "none" ? rawGstMode : "inclusive";
  const subtotal = roundMoney(data.items.reduce((sum, item) => sum + readNumber(item.quantity, 0) * readNumber(item.ratePerRateUnit, 0), 0));
  const gst = roundMoney(data.items.reduce((sum, item) => {
    const lineTotal = readNumber(item.quantity, 0) * readNumber(item.ratePerRateUnit, 0);
    const rate = readNumber(item.gstRate, 0);
    if (rate <= 0 || lineTotal <= 0 || gstMode === "none") return sum;
    if (gstMode === "exclusive") return sum + lineTotal * rate / 100;
    return sum + (lineTotal - lineTotal / (1 + rate / 100));
  }, 0));
  const discount = roundMoney(readNumber(data.discount, 0));
  const payableBase = gstMode === "exclusive" ? roundMoney(subtotal + gst) : subtotal;
  const total = roundMoney(Math.max(0, payableBase - discount));
  return { subtotal, gst, discount, total, gstMode, payableBase };
}

function hasCustomerReference(data: BillInput) {
  const name = data.customerName?.trim();
  return Boolean(data.customerId?.trim() || name && name !== "Walk-in");
}

function validateBillCreationBusinessRules(data: BillInput) {
  const { total, discount, payableBase } = calculateBillAmounts(data);
  const cashPaid = data.payments.filter((payment) => payment.mode === BillPaymentMode.cash).reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0);
  const upiPaid = data.payments.filter((payment) => payment.mode === BillPaymentMode.upi).reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0);
  const cashUpiPaid = roundMoney(cashPaid + upiPaid);
  const buyerPaidAmount = roundMoney(readNumber(data.buyerPaidAmount, cashUpiPaid));
  const hasSplitCashUpi = cashPaid > 0 && upiPaid > 0;
  const creditAmount = getCreditAmount(data.payments);

  if (discount > payableBase) {
    throw new Error("Discount cannot exceed bill total");
  }

  if ((data.billType === "udhar_entry" || creditAmount > 0) && !hasCustomerReference(data)) {
    throw new Error("Customer is required for udhar or credit bills");
  }

  if (hasSplitCashUpi && cashUpiPaid > total) {
    throw new Error("Split cash and UPI payments cannot exceed bill total");
  }

  if (Math.max(buyerPaidAmount, cashUpiPaid) > total && !data.allowAdvancePayment) {
    throw new Error("Total paid amount cannot exceed bill total unless advance payment is enabled");
  }
}

function buildLedgerEntry(billId: string, customerId: string, amount: number, bill: Bill, balanceAfter: number) {
  const now = new Date().toISOString();
  const ledgerId = `ledger_${billId}_credit`;
  return makeLocalEntity({
    id: ledgerId,
    local_id: ledgerId,
    clientLedgerId: ledgerId,
    client_ledger_id: ledgerId,
    localLedgerId: ledgerId,
    local_ledger_id: ledgerId,
    localLedgerEntryId: ledgerId,
    local_ledger_entry_id: ledgerId,
    ledgerUniqueId: `bill-credit:${billId}`,
    ledger_unique_id: `bill-credit:${billId}`,
    customerId,
    customer_id: customerId,
    type: "BILL",
    source_type: "bill",
    source_id: billId,
    sourceId: billId,
    billId,
    bill_id: billId,
    localBillId: billId,
    local_bill_id: billId,
    amount,
    balance_after: balanceAfter,
    isSynced: false,
    is_synced: false,
    note: `Udhar from ${bill.billNumber ?? bill.billNo}`,
    entry_at: now,
    createdAt: now,
    created_at: now,
  }, "ledger_entry", "pending_sync") as unknown as Record<string, unknown> & { id: string };
}

function nextCachedList<T extends { id: string }>(key: string, item: T, maxItems: number) {
  const current = readInstantCache<T[]>(key, []);
  const next = [item, ...current.filter((row) => row.id !== item.id)].slice(0, maxItems);
  return normaliseInstantCacheValue(next);
}

const BILL_CREATION_TRANSACTION_TABLES = [
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
  "local_audit_logs",
  "sync_outbox",
  "settings",
  "customers",
];

const BILL_CREATION_CACHE_DAYS = 30;
const BILL_CREATION_CACHE_EXPIRES_MS = BILL_CREATION_CACHE_DAYS * 24 * 60 * 60 * 1000;

export async function createBillLocalFirst(input: BillInput): Promise<Bill> {
  const sensitiveActions = readSensitiveBillActions(input);
  validateSensitiveBillApproval(input, sensitiveActions);
  const validated = parseOrThrow(billCreationSchema, input) as BillInput;
  validateBillCreationBusinessRules(validated);

  // Hard guard: a bill that references a demo product/customer would 404 on the server
  // ("Product not found: demo_product_…") and stick in CONFLICT forever. The UI also filters
  // demo products out of billing — this is the belt-and-braces backstop.
  const hasDemoRef =
    (typeof validated.customerId === "string" && validated.customerId.startsWith("demo_")) ||
    (validated.items ?? []).some((item) => typeof item.productId === "string" && item.productId.startsWith("demo_"));
  if (hasDemoRef) {
    const err = new Error("Sample products are for preview only. Add your own product before billing, or tap “Clear & start fresh”.");
    (err as Error & { code?: string }).code = "DEMO_PRODUCT_NOT_SELLABLE";
    throw err;
  }

  const billId = createLocalId("bill");
  const scope = getOfflineScope();
  const idempotencyKey = `create-bill:${scope.tenant_id}:${scope.store_id}:${scope.device_id}:${billId}`;
  const creditAmount = getCreditAmount(validated.payments);
  const customerPreparation = await prepareCustomerForCreditBill({ ...validated, payments: [...validated.payments] }, creditAmount);
  const billData = customerPreparation.billData;
  const now = new Date().toISOString();
  const calculatedAmounts = calculateBillAmounts(billData);
  const total = roundMoney(readNumber(billData.actualAmount, calculatedAmounts.total));
  const paid = roundMoney(readNumber(billData.buyerPaidAmount, billData.payments
    .filter((payment) => payment.mode !== BillPaymentMode.credit)
    .reduce((sum, payment) => sum + readNumber(payment.amount, 0), 0)));
  const billItems = buildBillItems(billId, billData.items, calculatedAmounts.gstMode);
  const billPayments = buildPayments(billId, billData.customerId, billData.payments);
  const saleMovements = billData.billType === "estimate" ? [] : buildSaleMovements(billId, billData.items);
  const tenderPayments = billData.payments.filter((payment) => payment.mode !== BillPaymentMode.credit);
  const creditPayments = billData.payments.filter((payment) => payment.mode === BillPaymentMode.credit);
  const dueAmount = roundMoney(Math.max(0, total - paid));
  const bill = makeLocalEntity(withBillAliases({
    id: billId,
    billNo: `PENDING-${billId.slice(-6).toUpperCase()}`,
    billNumber: `PENDING-${billId.slice(-6).toUpperCase()}`,
    billType: billData.billType,
    status: "pending_sync",
    isSynced: false,
    is_synced: false,
    clientBillId: billId,
    client_bill_id: billId,
    localBillId: billId,
    local_bill_id: billId,
    idempotencyKey,
    idempotency_key: idempotencyKey,
    customerId: billData.customerId ?? null,
    customerName: billData.customerName ?? "Walk-in",
    customerMobile: billData.customerMobile ?? null,
    subtotal: calculatedAmounts.payableBase,
    discount: calculatedAmounts.discount,
    gst: calculatedAmounts.gst,
    gstMode: calculatedAmounts.gstMode,
    grandTotal: total,
    totalAmount: total,
    netAmount: total,
    paidAmount: paid,
    buyerPaidAmount: paid,
    creditAmount,
    createdAt: now,
    items: billData.items,
    payments: billData.payments,
  }), "bill", "pending_sync");

  const ledgerEntry = creditAmount > 0 && billData.customerId
    ? buildLedgerEntry(billId, billData.customerId, creditAmount, bill, roundMoney(customerPreparation.previousCustomerBalance + creditAmount))
    : null;

  const billCreatedAuditLog = buildAuditLogRow({
    action: "bill_created",
    entityType: "bill",
    entityId: billId,
    entityLabel: bill.billNumber ?? bill.billNo,
    newValue: bill,
    ownerPinProvided: sensitiveActions.length > 0,
    reason: sensitiveActions.length > 0 ? input.reason : undefined,
    summary: `Bill ${bill.billNumber ?? bill.billNo} created for ₹${total.toLocaleString("en-IN")}`,
  });
  const auditLogs = [billCreatedAuditLog, ...buildSensitiveBillAuditLogs(bill, input, sensitiveActions)];

  const creditLedgerPayload = ledgerEntry
    ? {
        localLedgerEntryId: ledgerEntry.id,
        local_ledger_entry_id: ledgerEntry.id,
        localLedgerId: ledgerEntry.id,
        local_ledger_id: ledgerEntry.id,
        ledgerEntryId: ledgerEntry.id,
        ledger_entry_id: ledgerEntry.id,
        customerId: billData.customerId,
        customer_id: billData.customerId,
        localCustomerId: billData.customerId,
        local_customer_id: billData.customerId,
        billId,
        bill_id: billId,
        localBillId: billId,
        local_bill_id: billId,
        type: "BILL",
        sourceType: "bill",
        source_type: "bill",
        sourceId: billId,
        source_id: billId,
        amount: creditAmount,
        balanceAfter: ledgerEntry.balance_after,
        balance_after: ledgerEntry.balance_after,
        note: ledgerEntry.note,
        entryAt: ledgerEntry.entry_at,
        entry_at: ledgerEntry.entry_at,
      }
    : null;

  const billOutbox = buildOutboxOperation({
    entity_type: "bill",
    entity_id: billId,
    operation_type: "CREATE_BILL",
    idempotency_key: idempotencyKey,
    payload: {
      ...billData,
      ownerPin: sensitiveActions.length > 0 ? input.ownerPin : undefined,
      reason: sensitiveActions.length > 0 ? input.reason : undefined,
      sensitiveActions,
      ownerPinProvided: sensitiveActions.length > 0,
      // Send only real tender payments as backend payment rows. Credit/udhar is
      // represented separately as debt; otherwise some backends treat udhar as
      // collected cash and mark the bill fully paid after sync.
      payments: tenderPayments,
      tenderPayments,
      tender_payments: tenderPayments,
      paymentBreakdown: tenderPayments,
      payment_breakdown: tenderPayments,
      creditPayments,
      credit_payments: creditPayments,
      customerSnapshot: billData.customerId ? {
        localCustomerId: billData.customerId,
        customerId: billData.customerId,
        name: billData.customerName ?? "Walk-in",
        mobile: billData.customerMobile ?? null,
      } : null,
      customer_snapshot: billData.customerId ? {
        local_customer_id: billData.customerId,
        customer_id: billData.customerId,
        name: billData.customerName ?? "Walk-in",
        mobile: billData.customerMobile ?? null,
      } : null,
      paidAmount: paid,
      paid_amount: paid,
      buyerPaidAmount: paid,
      buyer_paid_amount: paid,
      creditAmount,
      credit_amount: creditAmount,
      dueAmount,
      due_amount: dueAmount,
      paymentStatus: creditAmount > 0 ? (paid > 0 ? "partial" : "credit") : "paid",
      payment_status: creditAmount > 0 ? (paid > 0 ? "partial" : "credit") : "paid",
      udharAmount: creditAmount,
      udhar_amount: creditAmount,
      outstandingAmount: dueAmount,
      outstanding_amount: dueAmount,
      customerUdharAfter: creditLedgerPayload?.balanceAfter ?? null,
      customer_udhar_after: creditLedgerPayload?.balance_after ?? null,
      ledgerEntries: creditLedgerPayload ? [creditLedgerPayload] : [],
      customerLedgerEntries: creditLedgerPayload ? [creditLedgerPayload] : [],
      udharLedgerEntries: creditLedgerPayload ? [creditLedgerPayload] : [],
      local_ledger_entries: creditLedgerPayload ? [creditLedgerPayload] : [],
      creditLedgerHandledInPayload: creditAmount > 0,
      credit_ledger_handled_in_payload: creditAmount > 0,
      localBillId: billId,
      local_bill_id: billId,
      clientBillId: billId,
      client_bill_id: billId,
      idempotencyKey,
      idempotency_key: idempotencyKey,
      local_items: billItems.map((item) => ({
        local_item_id: item.id,
        product_id: item.product_id ?? item.productId ?? null,
        name: item.name,
      })),
      local_payments: billPayments.map((payment) => ({
        id: payment.id,
        local_payment_id: payment.id,
        localPaymentId: payment.id,
        client_payment_id: payment.id,
        clientPaymentId: payment.id,
        idempotency_key: payment.idempotency_key,
        idempotencyKey: payment.idempotencyKey,
        bill_id: billId,
        billId,
        local_bill_id: billId,
        localBillId: billId,
        customer_id: payment.customer_id ?? payment.customerId ?? null,
        customerId: payment.customerId ?? payment.customer_id ?? null,
        mode: payment.mode,
        amount: payment.amount,
        paid_at: payment.paid_at ?? payment.paidAt,
        paidAt: payment.paidAt ?? payment.paid_at,
      })),
    },
  });

  const auditOutboxes = auditLogs.map((row) => buildOutboxOperation(buildAuditLogOutboxInput(row)));
  const nextBillsCache = nextCachedList<Bill>(BILL_CACHE_KEY, bill, 500);
  const nextCustomersCache = customerPreparation.customerCacheItem
    ? nextCachedList<Customer>(CUSTOMER_CACHE_KEY, customerPreparation.customerCacheItem, 1000)
    : null;
  const nextLedgerCache = ledgerEntry
    ? nextCachedList<Record<string, unknown> & { id: string }>("customer_ledger", ledgerEntry, 1500)
    : null;
  const cacheExpiresAt = Date.now() + BILL_CREATION_CACHE_EXPIRES_MS;

  await offlineDB.transaction(BILL_CREATION_TRANSACTION_TABLES, async (tx) => {
    if (customerPreparation.customerToPut) {
      await tx.put("customers", customerPreparation.customerToPut);
    }
    await tx.put("bills", bill);
    await tx.putMany("bill_items", billItems);
    await tx.putMany("payments", billPayments);
    await tx.putMany("inventory_movements", saleMovements);
    if (ledgerEntry) {
      await tx.put("customer_ledger", ledgerEntry);
    }
    await tx.putMany("local_audit_logs", auditLogs);
    if (customerPreparation.customerCreateOutbox) {
      await tx.enqueueOutboxOperation(customerPreparation.customerCreateOutbox);
    }
    for (const auditOutbox of auditOutboxes) {
      await tx.enqueueOutboxOperation(auditOutbox);
    }
    await tx.enqueueOutboxOperation(billOutbox);
    await tx.setSetting(`cache:${BILL_CACHE_KEY}`, nextBillsCache, cacheExpiresAt);
    if (nextCustomersCache) await tx.setSetting(`cache:${CUSTOMER_CACHE_KEY}`, nextCustomersCache, cacheExpiresAt);
    if (nextLedgerCache) await tx.setSetting("cache:customer_ledger", nextLedgerCache, cacheExpiresAt);
  });

  writeInstantMemoryCache(BILL_CACHE_KEY, nextBillsCache, BILL_CREATION_CACHE_DAYS);
  if (nextCustomersCache) writeInstantMemoryCache(CUSTOMER_CACHE_KEY, nextCustomersCache, BILL_CREATION_CACHE_DAYS);
  if (nextLedgerCache) writeInstantMemoryCache("customer_ledger", nextLedgerCache, BILL_CREATION_CACHE_DAYS);
  emitLocalDataChanged({ type: "bill", id: billId, action: "created" });
  if (ledgerEntry) emitLocalDataChanged({ type: "ledger", id: ledgerEntry.id, customerId: billData.customerId, action: "appended" });
  return bill;
}

export async function cancelBillLocalFirst(id: string, reason?: string): Promise<Bill> {
  const now = new Date().toISOString();
  const existing = await offlineDB.getAll<Bill>("bills").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const bill = withBillAliases({ ...(existing ?? { id, billNo: id, billType: "normal_sale", status: "pending_sync" }), status: "cancelled", updatedAt: now });
  await offlineDB.put("bills", { ...bill, cancelled_at: now, deleted_at: null, sync_status: "pending_sync", isSynced: false, is_synced: false });
  upsertCachedListItem<Bill>(BILL_CACHE_KEY, { ...bill, isSynced: false, is_synced: false }, 500);
  await enqueueOutboxOperation({
    entity_type: "bill",
    entity_id: id,
    operation_type: "CANCEL_BILL_PENDING",
    payload: { billId: id, reason },
  });
  emitLocalDataChanged({ type: "bill", id, action: "cancelled" });
  return bill;
}
