import db from "../../db.js";
import { sumMoney } from "../../utils/money.js";

export async function getUdharLedger(shopId, { from, to, customerId, type, page, limit }) {
  const where = {
    shopId,
    ...(customerId && { customerId }),
    ...(type !== "all" && { type }),
    ...(from && to && {
      createdAt: { gte: new Date(from), lte: new Date(to) },
    }),
  };

  const [entries, total] = await Promise.all([
    db.udharLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.udharLedger.count({ where }),
  ]);

  return { entries, total, page, limit };
}

// Summary: total udhar outstanding across all customers
export async function getUdharSummary(shopId) {
  const customers = await db.customer.findMany({
    where: { shopId, deletedAt: null, udharAmount: { gt: 0 } },
    select: { id: true, name: true, mobile: true, udharAmount: true },
    orderBy: { udharAmount: "desc" },
  });

  const totalOutstanding = sumMoney(customers.map((c) => c.udharAmount));
  return { totalOutstanding, customers };
}
