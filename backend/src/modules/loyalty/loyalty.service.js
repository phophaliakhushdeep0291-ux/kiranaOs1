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
  try {
    return await db.$transaction((tx) => recordBillLoyaltyInTransaction(tx, shopId, bill));
  } catch (error) {
    if (error?.code === "P2002") return db.loyaltyTransaction.findFirst({ where: { billId: bill.id, type: "earn" } });
    throw error;
  }
}

export async function recordBillLoyaltyInTransaction(tx, shopId, bill) {
  if (!bill?.customerId || bill.billType === "estimate" || bill.status === "cancelled") return null;
  const program = await tx.loyaltyProgram.findUnique({ where: { shopId } });
  if (!program?.active) return null;
  const points = Math.max(0, Math.floor(Number(bill.grandTotal) * Number(program.pointsPerRupee)));
  if (!points) return null;
  const account = await tx.loyaltyAccount.upsert({
    where: { customerId: bill.customerId },
    create: { shopId, customerId: bill.customerId },
    update: {},
  });
  const transaction = await tx.loyaltyTransaction.create({ data: { shopId, accountId: account.id, billId: bill.id, locationId: bill.locationId ?? null, type: "earn", lifecycleCycle: 0, points, source: "pos", note: `Earned on ${bill.billNo}` } });
  await tx.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: { increment: points }, lifetimeEarned: { increment: points }, lastEarnedAt: new Date() } });
  return transaction;
}

export async function reserveBillLoyaltyRedemption(client, { shopId, customerId, points, isEstimate }) {
  const requestedPoints = Number(points || 0);
  if (requestedPoints <= 0) return null;
  if (isEstimate) throw new AppError("Loyalty points cannot be redeemed on an estimate", 422, "LOYALTY_ESTIMATE_NOT_ALLOWED");
  if (!customerId) throw new AppError("Choose a customer before redeeming loyalty points", 422, "LOYALTY_CUSTOMER_REQUIRED");

  const program = await client.loyaltyProgram.findUnique({ where: { shopId } });
  if (!program?.active) throw new AppError("Loyalty program is not active", 409, "LOYALTY_PROGRAM_INACTIVE");
  if (requestedPoints < program.minimumRedeemPoints) {
    throw new AppError(`Minimum redemption is ${program.minimumRedeemPoints} points`, 422, "LOYALTY_MINIMUM_NOT_MET");
  }

  let account = await client.loyaltyAccount.findFirst({ where: { shopId, customerId } });
  if (!account) throw new AppError("Loyalty account not found", 404, "LOYALTY_ACCOUNT_NOT_FOUND");
  account = await expireOne(client, shopId, program, account);
  const updated = await client.loyaltyAccount.updateMany({
    where: { id: account.id, shopId, pointsBalance: { gte: requestedPoints } },
    data: { pointsBalance: { decrement: requestedPoints }, lifetimeRedeemed: { increment: requestedPoints } },
  });
  if (updated.count !== 1) throw new AppError("Not enough loyalty points", 409, "INSUFFICIENT_LOYALTY_POINTS");

  return {
    accountId: account.id,
    points: requestedPoints,
    discountValuePaise: requestedPoints * program.redemptionPaisePerPoint,
  };
}

export async function recordBillLoyaltyRedemption(client, { shopId, billId, billNo, locationId, redemption }) {
  if (!redemption) return null;
  return client.loyaltyTransaction.create({
    data: {
      shopId,
      accountId: redemption.accountId,
      billId,
      locationId: locationId ?? null,
      type: "redeem",
      lifecycleCycle: 0,
      points: -redemption.points,
      source: "pos",
      note: `Redeemed on ${billNo}`,
    },
  });
}

export async function reverseBillLoyalty(shopId, billId) {
  return db.$transaction((tx) => reverseBillLoyaltyInTransaction(tx, shopId, billId));
}

async function refreshLastEarnedAt(tx, accountId) {
  const latestActiveEarn = await tx.loyaltyTransaction.findFirst({
    where: {
      accountId,
      type: { in: ["earn", "earn_reapply"] },
      bill: { is: { status: "active" } },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  await tx.loyaltyAccount.update({
    where: { id: accountId },
    data: { lastEarnedAt: latestActiveEarn?.createdAt ?? null },
  });
}

function loyaltyIntegrityError(message) {
  return new AppError(message, 409, "LOYALTY_LEDGER_INCONSISTENT");
}

export async function reverseBillLoyaltyInTransaction(tx, shopId, billId) {
  const transactions = await tx.loyaltyTransaction.findMany({ where: { shopId, billId } });
  const earned = transactions.find((row) => row.type === "earn" && row.lifecycleCycle === 0);
  const redeemed = transactions.find((row) => row.type === "redeem" && row.lifecycleCycle === 0);
  const lifecycleCycle = Math.max(0, ...transactions.map((row) => Number(row.lifecycleCycle || 0))) + 1;
  const results = [];

  if (earned) {
    const account = await tx.loyaltyAccount.findFirst({ where: { id: earned.accountId, shopId } });
    if (!account) throw loyaltyIntegrityError("Cannot cancel bill because its loyalty account is missing");
    if (account.lifetimeEarned < earned.points) throw loyaltyIntegrityError("Cannot cancel bill because lifetime earned points are inconsistent");

    // Reverse the full earned value even when the customer already spent some of
    // it. A temporary negative balance is intentional: it preserves the ledger
    // instead of silently granting points and blocks further redemption.
    results.push(await tx.loyaltyTransaction.create({
      data: {
        shopId,
        accountId: account.id,
        billId,
        locationId: earned.locationId ?? null,
        type: "earn_reversal",
        lifecycleCycle,
        points: -earned.points,
        source: "system",
        note: `Earned points reversed after bill cancellation (cycle ${lifecycleCycle})`,
      },
    }));
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        pointsBalance: { decrement: earned.points },
        lifetimeEarned: { decrement: earned.points },
      },
    });
    await refreshLastEarnedAt(tx, account.id);
  }

  if (redeemed) {
    const account = await tx.loyaltyAccount.findFirst({ where: { id: redeemed.accountId, shopId } });
    const restoredPoints = Math.abs(redeemed.points);
    if (!account) throw loyaltyIntegrityError("Cannot cancel bill because its loyalty redemption account is missing");
    if (account.lifetimeRedeemed < restoredPoints) throw loyaltyIntegrityError("Cannot cancel bill because lifetime redeemed points are inconsistent");

    results.push(await tx.loyaltyTransaction.create({
      data: {
        shopId,
        accountId: account.id,
        billId,
        locationId: redeemed.locationId ?? null,
        type: "redeem_reversal",
        lifecycleCycle,
        points: restoredPoints,
        source: "system",
        note: `Redeemed points restored after bill cancellation (cycle ${lifecycleCycle})`,
      },
    }));
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { increment: restoredPoints }, lifetimeRedeemed: { decrement: restoredPoints } },
    });
  }

  return results;
}

export async function reapplyBillLoyaltyInTransaction(tx, shopId, billId) {
  const transactions = await tx.loyaltyTransaction.findMany({ where: { shopId, billId } });
  const earned = transactions.find((row) => row.type === "earn" && row.lifecycleCycle === 0);
  const redeemed = transactions.find((row) => row.type === "redeem" && row.lifecycleCycle === 0);
  if (!earned && !redeemed) return [];

  const maxCycle = Math.max(0, ...transactions.map((row) => Number(row.lifecycleCycle || 0)));
  const hasModernReversal = transactions.some((row) => ["earn_reversal", "redeem_reversal"].includes(row.type) && row.lifecycleCycle > 0);
  const lifecycleCycle = hasModernReversal ? maxCycle : maxCycle + 1;
  const results = [];

  if (earned) {
    const modernReversal = transactions.find((row) => row.type === "earn_reversal" && row.lifecycleCycle === lifecycleCycle);
    const legacyReversal = !hasModernReversal ? transactions.find((row) => row.type === "adjustment" && row.lifecycleCycle === 0) : null;
    const reversal = modernReversal ?? legacyReversal;
    if (!reversal) throw loyaltyIntegrityError("Cannot restore bill because its earned-point reversal is missing");
    const points = Math.abs(reversal.points);
    const account = await tx.loyaltyAccount.findFirst({ where: { id: earned.accountId, shopId } });
    if (!account) throw loyaltyIntegrityError("Cannot restore bill because its loyalty account is missing");

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        pointsBalance: { increment: points },
        // The legacy adjustment never reduced lifetimeEarned, so do not double it.
        ...(modernReversal ? { lifetimeEarned: { increment: points } } : {}),
      },
    });
    results.push(await tx.loyaltyTransaction.create({
      data: {
        shopId,
        accountId: account.id,
        billId,
        locationId: earned.locationId ?? null,
        type: "earn_reapply",
        lifecycleCycle,
        points,
        source: "system",
        note: `Earned points reapplied after bill restore (cycle ${lifecycleCycle})`,
      },
    }));
    await refreshLastEarnedAt(tx, account.id);
  }

  if (redeemed) {
    const reversal = transactions.find((row) => row.type === "redeem_reversal" && row.lifecycleCycle === (hasModernReversal ? lifecycleCycle : 0));
    if (!reversal) throw loyaltyIntegrityError("Cannot restore bill because its redeemed-point reversal is missing");
    const points = Math.abs(reversal.points);
    const account = await tx.loyaltyAccount.findFirst({ where: { id: redeemed.accountId, shopId } });
    if (!account) throw loyaltyIntegrityError("Cannot restore bill because its loyalty redemption account is missing");

    // Reapply exactly even if points were spent while the bill was cancelled.
    // This may make the balance negative, which is preferable to free value.
    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { pointsBalance: { decrement: points }, lifetimeRedeemed: { increment: points } },
    });
    results.push(await tx.loyaltyTransaction.create({
      data: {
        shopId,
        accountId: account.id,
        billId,
        locationId: redeemed.locationId ?? null,
        type: "redeem_reapply",
        lifecycleCycle,
        points: -points,
        source: "system",
        note: `Redeemed points reapplied after bill restore (cycle ${lifecycleCycle})`,
      },
    }));
  }

  return results;
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
