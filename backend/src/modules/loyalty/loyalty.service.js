import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const DEFAULT_PROGRAM = { active: false, pointsPerRupee: 1, redemptionPaisePerPoint: 25, minimumRedeemPoints: 100 };

export async function getProgram(shopId) {
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } });
  return program ?? { shopId, ...DEFAULT_PROGRAM, configured: false };
}

export async function updateProgram(shopId, data) {
  const { ownerPin: _ownerPin, ...settings } = data;
  return db.loyaltyProgram.upsert({ where: { shopId }, create: { shopId, ...settings }, update: settings });
}

export async function listAccounts(shopId, limit = 100) {
  return db.loyaltyAccount.findMany({
    where: { shopId },
    orderBy: [{ pointsBalance: "desc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    include: { customer: { select: { id: true, name: true, mobile: true } } },
  });
}

export async function getAccount(shopId, customerId) {
  const customer = await db.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null }, select: { id: true, name: true, mobile: true } });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  const account = await db.loyaltyAccount.findUnique({
    where: { customerId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  return { customer, account: account ?? { shopId, customerId, pointsBalance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, transactions: [] } };
}

export async function recordBillLoyalty(shopId, bill) {
  if (!bill?.customerId || bill.billType === "estimate" || bill.status === "cancelled") return null;
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } });
  if (!program?.active) return null;
  const points = Math.max(0, Math.floor(Number(bill.grandTotal) * Number(program.pointsPerRupee)));
  if (!points) return null;
  try {
    return await db.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { customerId: bill.customerId },
        create: { shopId, customerId: bill.customerId },
        update: {},
      });
      const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, billId: bill.id, type: "earn", points, note: `Earned on ${bill.billNo}` } });
      await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { increment: points }, lifetimeEarned: { increment: points } } });
      return transaction;
    });
  } catch (error) {
    if (error?.code === "P2002") return db.loyaltyTransaction.findFirst({ where: { billId: bill.id, type: "earn" } });
    throw error;
  }
}

export async function reverseBillLoyalty(shopId, billId) {
  const earned = await db.loyaltyTransaction.findFirst({ where: { shopId, billId, type: "earn" } });
  if (!earned) return null;
  const prior = await db.loyaltyTransaction.findFirst({ where: { shopId, billId, type: "adjustment" } });
  if (prior) return prior;
  return db.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.findFirst({ where: { id: earned.accountId, shopId } });
    if (!account) return null;
    const deduction = Math.min(account.pointsBalance, earned.points);
    const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, billId, type: "adjustment", points: -deduction, note: "Points reversed after bill cancellation" } });
    await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { decrement: deduction } } });
    return transaction;
  });
}

export async function redeemPoints(shopId, customerId, data) {
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } });
  if (!program?.active) throw new AppError("Loyalty program is not active", 409, "LOYALTY_PROGRAM_INACTIVE");
  if (data.points < program.minimumRedeemPoints) throw new AppError(`Minimum redemption is ${program.minimumRedeemPoints} points`, 422, "LOYALTY_MINIMUM_NOT_MET");
  return db.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.findFirst({ where: { shopId, customerId } });
    if (!account) throw new AppError("Loyalty account not found", 404, "LOYALTY_ACCOUNT_NOT_FOUND");
    const updated = await tx.loyaltyAccount.updateMany({ where: { id: account.id, shopId, pointsBalance: { gte: data.points } }, data: { pointsBalance: { decrement: data.points }, lifetimeRedeemed: { increment: data.points } } });
    if (updated.count !== 1) throw new AppError("Not enough loyalty points", 409, "INSUFFICIENT_LOYALTY_POINTS");
    const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, type: "redeem", points: -data.points, note: data.note } });
    return { transaction, discountValuePaise: data.points * program.redemptionPaisePerPoint };
  });
}

