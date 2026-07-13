import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, round2, toPaiseBigInt } from "../../utils/money.js";
import { createAuditLog } from "../audit/audit.service.js";
import {
  calculateCustomerUdharBalance,
  calculateCustomerUdharBalances,
  ensureLegacyUdharOpeningLedger,
  syncCustomerUdharBalance,
} from "../udhar/udharBalance.service.js";
import { postUdharPaymentLedger } from "../finance/financial-ledger.service.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";

async function lockCustomerUdharBalance(tx, shopId, customerId) {
  if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "")) return;
  await tx.$queryRawUnsafe(
    'SELECT "id" FROM "Customer" WHERE "id" = $1 AND "shopId" = $2 FOR UPDATE',
    customerId,
    shopId
  );
}

export async function listCustomers(shopId, { search } = {}) {
  const customers = await db.customer.findMany({
    where: {
      shopId,
      deletedAt: null,
      ...(search && {
        OR: [
          { name: { contains: search } },
          { mobile: { contains: search } },
        ],
      }),
    },
    orderBy: { name: "asc" },
  });
  return attachDerivedUdharBalances(shopId, customers);
}

export async function getCustomer(shopId, id) {
  const c = await db.customer.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!c) throw new AppError("Customer not found", 404);
  return (await attachDerivedUdharBalances(shopId, [c]))[0];
}

export async function createCustomer(shopId, data, { reuseExistingMobile = false } = {}) {
  // If mobile provided, check for existing customer (matching by mobile is the rule).
  // Soft-deleted customers may still carry a historical mobile in old databases;
  // clear that value before creating a new active customer so DB unique constraints
  // do not block legitimate reuse.
  if (data.mobile) {
    const existing = await db.customer.findFirst({
      where: { shopId, mobile: data.mobile, deletedAt: null },
    });
    if (existing) {
      // Offline sync can replay the same customer creation — a retried event after a
      // lost ack, or the same customer added on a second device. Converging on the
      // existing customer keeps the create idempotent (one server customer; the caller
      // maps the local id onto it) instead of failing the sync event forever. The
      // online path keeps throwing so the cashier still sees "customer already exists".
      if (reuseExistingMobile) {
        const [withBalance] = await attachDerivedUdharBalances(shopId, [existing]);
        return withBalance;
      }
      throw new AppError("Customer with this mobile already exists", 409);
    }

    await db.customer.updateMany({
      where: { shopId, mobile: data.mobile, deletedAt: { not: null } },
      data: { mobile: null },
    });
  }

  const openingUdharAmount = round2(data.udharAmount ?? 0);
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        ...data,
        udharAmount: 0,
        ...moneyShadows({ udharAmount: 0 }),
        type: openingUdharAmount > 0 ? "udhar" : (data.type ?? "regular"),
        shopId,
      },
    });

    if (openingUdharAmount > 0) {
      await tx.udharLedger.create({
        data: {
          shopId,
          customerId: customer.id,
          customerName: customer.name,
          type: "debit",
          amount: openingUdharAmount,
          ...moneyShadows({ amount: openingUdharAmount }),
          mode: "opening_balance",
          note: "Opening udhar balance",
        },
      });
      await syncCustomerUdharBalance(tx, shopId, customer.id);
    }

    const [withBalance] = await attachDerivedUdharBalances(shopId, [customer], tx);
    return withBalance;
  });
}

export async function updateCustomer(shopId, id, data) {
  await getCustomer(shopId, id);

  if (Object.prototype.hasOwnProperty.call(data, "udharAmount")) {
    const err = new AppError("Udhar balance cannot be edited directly. Use bill credit, record payment, or ledger adjustment.", 400);
    err.code = "UDHAR_DIRECT_EDIT_BLOCKED";
    throw err;
  }

  if (data.mobile) {
    const duplicate = await db.customer.findFirst({
      where: {
        shopId,
        mobile: data.mobile,
        deletedAt: null,
        NOT: { id },
      },
      select: { id: true },
    });
    if (duplicate) throw new AppError("Customer with this mobile already exists", 409);
  }

  const updated = await db.customer.update({ where: { id }, data });
  return (await attachDerivedUdharBalances(shopId, [updated]))[0];
}

export async function softDeleteCustomer(shopId, id, { actorUserId = null, req = null } = {}) {
  const customer = await getCustomer(shopId, id);

  // Block delete when customer has any outstanding udhar balance.
  // The owner must clear or write off the balance before removing the customer.
  // This prevents hiding financial liabilities by deleting the customer record.
  if (customer.udharAmount > 0) {
    const err = new AppError(
      `Cannot delete customer "${customer.name}" — outstanding udhar balance ₹${customer.udharAmount} must be cleared first.`,
      409
    );
    err.code = "CUSTOMER_HAS_OUTSTANDING_UDHAR";
    err.udharAmount = customer.udharAmount;

    await createAuditLog({
      shopId,
      userId: actorUserId,
      action: "CUSTOMER_DELETE_BLOCKED",
      entityType: "Customer",
      entityId: id,
      metadata: { reason: "CUSTOMER_HAS_OUTSTANDING_UDHAR", udharAmount: customer.udharAmount, customerName: customer.name },
      req,
    });

    throw err;
  }

  const deletedAt = new Date();
  const deleted = await db.customer.update({
    where: { id },
    data: {
      deletedAt,
      // Free the per-shop unique mobile slot for future active customers while
      // keeping the original mobile preserved in the audit log below.
      ...(customer.mobile && { mobile: null }),
    },
  });

  await createAuditLog({
    shopId,
    userId: actorUserId,
    action: "CUSTOMER_DELETED",
    entityType: "Customer",
    entityId: id,
    before: { id: customer.id, name: customer.name, mobile: customer.mobile, udharAmount: customer.udharAmount },
    after: { deletedAt: deleted.deletedAt },
    metadata: { softDelete: true, customerName: customer.name },
    req,
  });

  return deleted;
}

/**
 * Get full udhar/khata ledger for a customer.
 */
export async function getKhata(shopId, customerId) {
  const customer = await getCustomer(shopId, customerId);

  const ledger = await db.udharLedger.findMany({
    where: { shopId, customerId },
    orderBy: { createdAt: "asc" },
  });

  return { customer, ledger };
}

/**
 * Record a manual udhar payment (cash/UPI coming in from customer).
 * This does NOT touch a bill — it's a direct khata payment.
 */
export async function recordUdharPayment(shopId, customerId, input, actor = {}) {
  const { amount, mode, note } = input;
  const customer = await getCustomer(shopId, customerId);
  const paymentAmount = round2(amount);
  const identity = normalizeLedgerIdentity(input, actor, "udhar-payment");

  try {
    return await db.$transaction(async (tx) => {
      const location = await resolveOperationalLocation(shopId, input.locationId ?? actor.locationId ?? null, tx);
      // Serialize balance checks for this customer across application instances.
      // Without the row lock, concurrent payments can both validate the same
      // balance and over-credit the ledger.
      await lockCustomerUdharBalance(tx, shopId, customerId);
      await ensureLegacyUdharOpeningLedger(tx, shopId, customerId);
      const existingLedger = await findExistingUdharPaymentByIdentity(tx, shopId, customerId, identity);
      if (existingLedger) {
        const currentBalance = await calculateCustomerUdharBalance(tx, shopId, customerId);
        return {
          customerId,
          ledgerEntryId: existingLedger.id,
          newBalance: currentBalance.balance,
          amountPaid: existingLedger.amount,
          idempotentReplay: true,
        };
      }

    const currentBalance = await calculateCustomerUdharBalance(tx, shopId, customerId);
    if (currentBalance.balance < paymentAmount) {
      const err = new AppError(
        `Payment ₹${paymentAmount} exceeds outstanding udhar ₹${currentBalance.balance}`,
        409
      );
      err.code = "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING";
      err.meta = { outstanding: currentBalance.balance, attemptedPayment: paymentAmount, rawBalance: currentBalance.rawBalance };
      throw err;
    }

    const ledger = await tx.udharLedger.create({
      data: {
        shopId,
        locationId: location.id,
        customerId,
        customerName: customer.name,
        type: "payment",
        amount: paymentAmount,
        ...moneyShadows({ amount: paymentAmount }),
        mode,
        clientLedgerId: identity.clientLedgerId,
        idempotencyKey: identity.idempotencyKey,
        sourceDeviceId: identity.sourceDeviceId,
        sourceType: "udhar_payment",
        sourceId: identity.sourceId,
        note: note ?? "Manual payment",
      },
    });

    // FinancialLedger: money in (cash_in/upi_in/bank_in) + outstanding down (udhar_credit).
    await postUdharPaymentLedger(tx, {
      shopId,
      ledgerEntryId: ledger.id,
      customerId,
      amount: paymentAmount,
      mode,
      sign: 1,
    });

    const refreshed = await syncCustomerUdharBalance(tx, shopId, customerId, {
      repairNegative: true,
      repairNote: `System repair after payment ${ledger.id}: udhar balance went negative`,
    });

    return {
      customerId,
      ledgerEntryId: ledger.id,
      newBalance: refreshed.balance,
      amountPaid: paymentAmount,
    };
  });
  } catch (error) {
    if (isUniqueConstraintError(error) && hasLedgerIdentity(identity)) {
      const existingLedger = await findExistingUdharPaymentByIdentity(db, shopId, customerId, identity);
      if (existingLedger) {
        const currentBalance = await calculateCustomerUdharBalance(db, shopId, customerId);
        return {
          customerId,
          ledgerEntryId: existingLedger.id,
          newBalance: currentBalance.balance,
          amountPaid: existingLedger.amount,
          idempotentReplay: true,
        };
      }
    }
    throw error;
  }
}


/**
 * Reverse a previously recorded udhar payment.
 * This preserves financial history by creating an opposite debit ledger entry
 * and marking the original payment as reversed instead of deleting it.
 */
export async function reverseUdharPayment(shopId, customerId, ledgerEntryId, { reason }, { actorUserId = null, req = null } = {}) {
  const customer = await getCustomer(shopId, customerId);

  return db.$transaction(async (tx) => {
    const payment = await tx.udharLedger.findFirst({
      where: {
        id: ledgerEntryId,
        shopId,
        customerId,
        type: "payment",
        mode: { in: ["cash", "upi", "bank"] },
      },
    });

    if (!payment) {
      const err = new AppError("Udhar payment entry not found or cannot be reversed", 404);
      err.code = "UDHAR_PAYMENT_NOT_REVERSIBLE";
      throw err;
    }

    if (payment.reversedAt) {
      const err = new AppError("Udhar payment has already been reversed", 409);
      err.code = "UDHAR_PAYMENT_ALREADY_REVERSED";
      throw err;
    }

    const reversedAt = new Date();
    const reversal = await tx.udharLedger.create({
      data: {
        shopId,
        locationId: payment.locationId,
        customerId,
        customerName: customer.name,
        type: "debit",
        amount: payment.amount,
        ...moneyShadows({ amount: payment.amount }),
        mode: "reversal",
        billId: payment.billId ?? null,
        billNo: payment.billNo ?? null,
        note: `Payment reversed: ${reason}`,
        reversalOfLedgerId: payment.id,
      },
    });

    await tx.udharLedger.update({
      where: { id: payment.id },
      data: {
        reversedAt,
        reversedReason: reason,
        reversedByUserId: actorUserId,
      },
    });

    // FinancialLedger: undo the recovery — cash/UPI/bank back out + outstanding restored.
    // Keyed on the reversal entry id (distinct from the original payment) and dated to
    // the reversal, so it nets the original payment's ledger rows to zero.
    await postUdharPaymentLedger(tx, {
      shopId,
      ledgerEntryId: reversal.id,
      customerId,
      amount: payment.amount,
      mode: payment.mode,
      businessDate: reversedAt,
      sign: -1,
      keyPrefix: "udhar-reversal",
    });

    const refreshed = await syncCustomerUdharBalance(tx, shopId, customerId, {
      repairNegative: true,
      repairNote: `System repair after reversing payment ${payment.id}: udhar balance went negative`,
    });

    await createAuditLog({
      shopId,
      userId: actorUserId,
      action: "UDHAR_PAYMENT_REVERSED",
      entityType: "UdharLedger",
      entityId: payment.id,
      before: { id: payment.id, amount: payment.amount, mode: payment.mode, customerId },
      after: { reversedAt, reversalLedgerEntryId: reversal.id, newBalance: round2(refreshed?.balance ?? 0) },
      metadata: { reason },
      req,
      client: tx,
    });

    return {
      customerId,
      reversedLedgerEntryId: payment.id,
      reversalLedgerEntryId: reversal.id,
      amountReversed: payment.amount,
      newBalance: round2(refreshed?.balance ?? 0),
      reversedAt,
    };
  });
}

function normalizeLedgerIdentity(input, actor, prefix) {
  const clientLedgerId = pickString(
    input?.clientLedgerId,
    input?.client_ledger_id,
    input?.localLedgerEntryId,
    input?.local_ledger_entry_id,
    input?.ledgerEntryId,
    input?.ledger_entry_id,
    input?.clientPaymentId,
    input?.client_payment_id,
    input?.localPaymentId,
    input?.local_payment_id,
    input?.paymentId,
    input?.payment_id,
    input?.localId,
    input?.local_id
  );
  const sourceDeviceId = pickString(actor?.deviceId, input?.sourceDeviceId, input?.source_device_id);
  const explicitKey = pickString(input?.idempotencyKey, input?.idempotency_key);
  const idempotencyKey = explicitKey ?? (clientLedgerId ? `${prefix}:${clientLedgerId}` : null);
  return {
    clientLedgerId,
    idempotencyKey,
    sourceDeviceId,
    sourceId: clientLedgerId ?? idempotencyKey,
  };
}

function hasLedgerIdentity(identity) {
  return Boolean(identity?.idempotencyKey || identity?.clientLedgerId);
}

async function findExistingUdharPaymentByIdentity(client, shopId, customerId, identity) {
  if (!hasLedgerIdentity(identity)) return null;
  if (identity.idempotencyKey) {
    const byKey = await client.udharLedger.findFirst({
      where: { shopId, customerId, type: "payment", idempotencyKey: identity.idempotencyKey },
    });
    if (byKey) return byKey;
  }
  if (identity.clientLedgerId) {
    return client.udharLedger.findFirst({
      where: { shopId, customerId, type: "payment", clientLedgerId: identity.clientLedgerId },
    });
  }
  return null;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

async function attachDerivedUdharBalances(shopId, customers, tx = db) {
  const balances = await calculateCustomerUdharBalances(tx, shopId, customers.map((customer) => customer.id));
  return customers.map((customer) => {
    const derived = balances.get(customer.id) ?? { balance: 0, rawBalance: 0, isNegative: false };
    return {
      ...customer,
      udharAmount: derived.balance,
      udharAmountPaise: toPaiseBigInt(derived.balance),
      udharRawAmount: derived.rawBalance,
      udharBalanceNeedsRepair: derived.isNegative,
      type: derived.balance > 0 ? "udhar" : customer.type === "udhar" ? "regular" : customer.type,
    };
  });
}
