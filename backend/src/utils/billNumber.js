/**
 * Generate the next bill number for a shop using BillCounter.
 * Final sale format: KOS-YYYY-NNNNNN  (e.g. KOS-2026-000001)
 * Estimate format:   EST-YYYY-NNNNNN  (e.g. EST-2026-000001)
 * Credit note format: RET-YYYY-NNNNNN (e.g. RET-2026-000001)
 *
 * This avoids the old race-prone pattern of querying the last bill and incrementing it.
 * It must be called inside the same transaction that creates the bill.
 */
export async function generateBillNo(shopId, tx, { billType } = {}) {
  if (!tx?.billCounter) {
    throw new Error("generateBillNo requires a Prisma transaction client with billCounter");
  }

  const year = new Date().getFullYear();
  const isEstimate = billType === "estimate";
  const isReturn = billType === "sales_return";
  const prefix = `${isEstimate ? "EST" : isReturn ? "RET" : "KOS"}-${year}-`;

  const counter = await tx.billCounter.upsert({
    where: { shopId },
    create: isEstimate
      ? { shopId, lastNumber: 0, estimateLastNumber: 1, returnLastNumber: 0 }
      : isReturn
        ? { shopId, lastNumber: 0, estimateLastNumber: 0, returnLastNumber: 1 }
        : { shopId, lastNumber: 1, estimateLastNumber: 0, returnLastNumber: 0 },
    update: isEstimate
      ? { estimateLastNumber: { increment: 1 } }
      : isReturn
        ? { returnLastNumber: { increment: 1 } }
        : { lastNumber: { increment: 1 } },
    select: isEstimate ? { estimateLastNumber: true } : isReturn ? { returnLastNumber: true } : { lastNumber: true },
  });

  const nextNumber = isEstimate ? counter.estimateLastNumber : isReturn ? counter.returnLastNumber : counter.lastNumber;
  return `${prefix}${String(nextNumber).padStart(6, "0")}`;
}
