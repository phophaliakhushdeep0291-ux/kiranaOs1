/**
 * Generate the next bill number for a shop using BillCounter.
 * Format: KOS-YYYY-NNNNNN  (e.g. KOS-2026-000001)
 *
 * This avoids the old race-prone pattern of querying the last bill and incrementing it.
 * It must be called inside the same transaction that creates the bill.
 */
export async function generateBillNo(shopId, tx) {
  if (!tx?.billCounter) {
    throw new Error("generateBillNo requires a Prisma transaction client with billCounter");
  }

  const year = new Date().getFullYear();
  const prefix = `KOS-${year}-`;

  const counter = await tx.billCounter.upsert({
    where: { shopId },
    create: { shopId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });

  return `${prefix}${String(counter.lastNumber).padStart(6, "0")}`;
}
