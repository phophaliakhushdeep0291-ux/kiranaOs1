import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, round2, toPaiseBigInt } from "../../utils/money.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function listCustomers(shopId, { search } = {}) {
  return db.customer.findMany({
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
}

export async function getCustomer(shopId, id) {
  const c = await db.customer.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!c) throw new AppError("Customer not found", 404);
  return c;
}

export async function createCustomer(shopId, data) {
  // If mobile provided, check for existing customer (matching by mobile is the rule).
  // Soft-deleted customers may still carry a historical mobile in old databases;
  // clear that value before creating a new active customer so DB unique constraints
  // do not block legitimate reuse.
  if (data.mobile) {
    const existing = await db.customer.findFirst({
      where: { shopId, mobile: data.mobile, deletedAt: null },
    });
    if (existing) throw new AppError("Customer with this mobile already exists", 409);

    await db.customer.updateMany({
      where: { shopId, mobile: data.mobile, deletedAt: { not: null } },
      data: { mobile: null },
    });
  }

  const udharAmount = data.udharAmount ?? 0;
  return db.customer.create({ data: { ...data, udharAmount, ...moneyShadows({ udharAmount }), shopId } });
}

export async function updateCustomer(shopId, id, data) {
  await getCustomer(shopId, id);

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

  return db.customer.update({ where: { id }, data: { ...data, ...moneyShadows({ udharAmount: data.udharAmount }) } });
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
export async function recordUdharPayment(shopId, customerId, { amount, mode, note }) {
  const customer = await getCustomer(shopId, customerId);

  if (customer.udharAmount < amount) {
    throw new AppError(
      `Payment ₹${amount} exceeds outstanding udhar ₹${customer.udharAmount}`,
      400
    );
  }

  return db.$transaction(async (tx) => {
    const ledger = await tx.udharLedger.create({
      data: {
        shopId,
        customerId,
        customerName: customer.name,
        type: "payment",
        amount,
        ...moneyShadows({ amount }),
        mode,
        note: note ?? "Manual payment",
      },
    });

    const updated = await tx.customer.updateMany({
      where: { id: customerId, shopId, deletedAt: null, udharAmount: { gte: amount } },
      data: { udharAmount: { decrement: amount } },
    });

    if (updated.count !== 1) {
      const err = new AppError("Udhar balance changed while recording payment. Please refresh and retry.", 409);
      err.code = "UDHAR_PAYMENT_CONCURRENT_MODIFICATION";
      throw err;
    }

    const refreshed = await tx.customer.findFirst({
      where: { id: customerId, shopId },
      select: { id: true, udharAmount: true },
    });
    if (refreshed) {
      await tx.customer.update({
        where: { id: refreshed.id },
        data: { udharAmountPaise: toPaiseBigInt(refreshed.udharAmount) },
      });
    }

    return {
      customerId,
      ledgerEntryId: ledger.id,
      newBalance: round2(refreshed?.udharAmount ?? 0),
      amountPaid: amount,
    };
  });
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
        mode: { in: ["cash", "upi"] },
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

    const updated = await tx.customer.updateMany({
      where: { id: customerId, shopId, deletedAt: null },
      data: {
        udharAmount: { increment: payment.amount },
        type: "udhar",
      },
    });

    if (updated.count !== 1) {
      const err = new AppError("Customer balance changed while reversing payment. Please refresh and retry.", 409);
      err.code = "UDHAR_REVERSAL_CONCURRENT_MODIFICATION";
      throw err;
    }

    const refreshed = await tx.customer.findFirst({
      where: { id: customerId, shopId },
      select: { id: true, udharAmount: true },
    });
    if (refreshed) {
      await tx.customer.update({
        where: { id: refreshed.id },
        data: { udharAmountPaise: toPaiseBigInt(refreshed.udharAmount) },
      });
    }

    await createAuditLog({
      shopId,
      userId: actorUserId,
      action: "UDHAR_PAYMENT_REVERSED",
      entityType: "UdharLedger",
      entityId: payment.id,
      before: { id: payment.id, amount: payment.amount, mode: payment.mode, customerId },
      after: { reversedAt, reversalLedgerEntryId: reversal.id, newBalance: round2(refreshed?.udharAmount ?? 0) },
      metadata: { reason },
      req,
    });

    return {
      customerId,
      reversedLedgerEntryId: payment.id,
      reversalLedgerEntryId: reversal.id,
      amountReversed: payment.amount,
      newBalance: round2(refreshed?.udharAmount ?? 0),
      reversedAt,
    };
  });
}
