import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const DEFAULT_TIERS = [
  { name: "Bronze", minLifetimePoints: 0 },
  { name: "Silver", minLifetimePoints: 1000 },
  { name: "Gold", minLifetimePoints: 5000 },
];
const DEFAULT_PROGRAM = { active: false, pointsPerRupee: 1, redemptionPaisePerPoint: 25, minimumRedeemPoints: 100, pointsExpireDays: 365, tierRulesJson: JSON.stringify(DEFAULT_TIERS) };

export function tiersFrom(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return DEFAULT_TIERS;
    const rows = parsed
      .filter((row) => row && typeof row.name === "string" && Number.isFinite(Number(row.minLifetimePoints)))
      .map((row) => ({ name: row.name.trim().slice(0, 40), minLifetimePoints: Math.max(0, Math.floor(Number(row.minLifetimePoints))) }))
      .sort((a, b) => a.minLifetimePoints - b.minLifetimePoints);
    return rows.length && rows[0].minLifetimePoints === 0 ? rows : DEFAULT_TIERS;
  } catch { return DEFAULT_TIERS; }
}

function shapeProgram(program) {
  const { tierRulesJson, ...rest } = program;
  return { ...rest, tiers: tiersFrom(tierRulesJson) };
}

export function tierFor(account, tiers) {
  const earned = Number(account.lifetimeEarned || 0);
  const tier = [...tiers].reverse().find((row) => earned >= row.minLifetimePoints) ?? tiers[0];
  const nextTier = tiers.find((row) => row.minLifetimePoints > earned) ?? null;
  return { tier: tier?.name ?? "Member", nextTier, pointsToNextTier: nextTier ? nextTier.minLifetimePoints - earned : 0 };
}

async function expireOne(client, shopId, program, account) {
  const days = Number(program.pointsExpireDays || 0);
  if (days <= 0 || !account?.lastEarnedAt || account.pointsBalance <= 0) return account;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  if (account.lastEarnedAt > cutoff) return account;
  const changed = await client.loyaltyAccount.updateMany({
    where: { id: account.id, shopId, pointsBalance: account.pointsBalance, lastEarnedAt: { lte: cutoff } },
    data: { pointsBalance: 0 },
  });
  if (changed.count === 1) {
    await client.loyaltyTransaction.create({ data: { shopId, accountId: account.id, type: "expire", points: -account.pointsBalance, source: "system", note: `Expired after ${days} days without earning activity` } });
    return { ...account, pointsBalance: 0 };
  }
  return client.loyaltyAccount.findFirst({ where: { id: account.id, shopId } });
}

async function expireDormantAccounts(shopId, program) {
  if (Number(program.pointsExpireDays || 0) <= 0) return;
  const cutoff = new Date(Date.now() - Number(program.pointsExpireDays) * 86_400_000);
  const accounts = await db.loyaltyAccount.findMany({ where: { shopId, pointsBalance: { gt: 0 }, lastEarnedAt: { lte: cutoff } }, take: 500 });
  for (const account of accounts) await db.$transaction((tx) => expireOne(tx, shopId, program, account));
}

export async function getProgram(shopId) {
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } });
  return shapeProgram(program ?? { shopId, ...DEFAULT_PROGRAM, configured: false });
}

export async function updateProgram(shopId, data) {
  const { ownerPin: _ownerPin, tiers, ...settings } = data;
  const stored = { ...settings, ...(tiers ? { tierRulesJson: JSON.stringify(tiers) } : {}) };
  return shapeProgram(await db.loyaltyProgram.upsert({ where: { shopId }, create: { shopId, ...stored }, update: stored }));
}

export async function listAccounts(shopId, limit = 100) {
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } }) ?? DEFAULT_PROGRAM;
  await expireDormantAccounts(shopId, program);
  const tiers = tiersFrom(program.tierRulesJson);
  const accounts = await db.loyaltyAccount.findMany({
    where: { shopId },
    orderBy: [{ pointsBalance: "desc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    include: { customer: { select: { id: true, name: true, mobile: true } } },
  });
  return accounts.map((account) => ({ ...account, ...tierFor(account, tiers), expiresAt: account.lastEarnedAt && program.pointsExpireDays > 0 ? new Date(account.lastEarnedAt.getTime() + program.pointsExpireDays * 86_400_000) : null }));
}

export async function getAccount(shopId, customerId) {
  const customer = await db.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null }, select: { id: true, name: true, mobile: true } });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } }) ?? DEFAULT_PROGRAM;
  let account = await db.loyaltyAccount.findUnique({
    where: { customerId },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (account) {
    await db.$transaction((tx) => expireOne(tx, shopId, program, account));
    account = await db.loyaltyAccount.findUnique({
      where: { customerId },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 100 } },
    });
  }
  const shaped = account ?? { shopId, customerId, pointsBalance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, transactions: [] };
  return { customer, account: { ...shaped, ...tierFor(shaped, tiersFrom(program.tierRulesJson)) } };
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
      const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, billId: bill.id, locationId: bill.locationId ?? null, type: "earn", points, source: "pos", note: `Earned on ${bill.billNo}` } });
      await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { increment: points }, lifetimeEarned: { increment: points }, lastEarnedAt: new Date() } });
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
    const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, billId, locationId: earned.locationId ?? null, type: "adjustment", points: -deduction, source: "system", note: "Points reversed after bill cancellation" } });
    await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { decrement: deduction } } });
    return transaction;
  });
}

export async function redeemPoints(shopId, customerId, data) {
  const program = await db.loyaltyProgram.findUnique({ where: { shopId } });
  if (!program?.active) throw new AppError("Loyalty program is not active", 409, "LOYALTY_PROGRAM_INACTIVE");
  if (data.points < program.minimumRedeemPoints) throw new AppError(`Minimum redemption is ${program.minimumRedeemPoints} points`, 422, "LOYALTY_MINIMUM_NOT_MET");
  return db.$transaction(async (tx) => {
    let account = await tx.loyaltyAccount.findFirst({ where: { shopId, customerId } });
    if (!account) throw new AppError("Loyalty account not found", 404, "LOYALTY_ACCOUNT_NOT_FOUND");
    account = await expireOne(tx, shopId, program, account);
    const updated = await tx.loyaltyAccount.updateMany({ where: { id: account.id, shopId, pointsBalance: { gte: data.points } }, data: { pointsBalance: { decrement: data.points }, lifetimeRedeemed: { increment: data.points } } });
    if (updated.count !== 1) throw new AppError("Not enough loyalty points", 409, "INSUFFICIENT_LOYALTY_POINTS");
    const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, locationId: data.locationId ?? null, type: "redeem", points: -data.points, source: "pos", note: data.note } });
    return { transaction, discountValuePaise: data.points * program.redemptionPaisePerPoint };
  });
}
