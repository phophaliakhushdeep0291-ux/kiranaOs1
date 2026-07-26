import db from "../../db.js";
import { sumMoney } from "../../utils/money.js";
import { calculateCustomerUdharBalances } from "./udharBalance.service.js";

export async function getUdharLedger(shopId, { from, to, customerId, type, page, limit }) {
  const where = {
    shopId,
    ...(customerId && { customerId }),
    ...(type !== "all" && { type }),
    ...(from && to && {
      businessDate: { gte: new Date(from), lte: new Date(to) },
    }),
  };

  const [entries, total] = await Promise.all([
    db.udharLedger.findMany({
      where,
      orderBy: { businessDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.udharLedger.count({ where }),
  ]);

  return { entries, total, page, limit };
}

// Summary: total udhar outstanding across all customers.
// Ledger is the source of truth; Customer.udharAmount is only a cache.
export async function getUdharSummary(shopId) {
  const customers = await db.customer.findMany({
    where: { shopId, deletedAt: null },
    select: { id: true, name: true, mobile: true, udharAmount: true },
  });
  const balances = await calculateCustomerUdharBalances(db, shopId, customers.map((customer) => customer.id));
  const rows = customers
    .map((customer) => {
      const derived = balances.get(customer.id) ?? { balance: 0, rawBalance: 0, isNegative: false };
      return {
        ...customer,
        udharAmount: derived.balance,
        udharRawAmount: derived.rawBalance,
        udharBalanceNeedsRepair: derived.isNegative,
      };
    })
    .filter((customer) => customer.udharAmount > 0 || customer.udharBalanceNeedsRepair)
    .sort((a, b) => b.udharAmount - a.udharAmount);

  const totalOutstanding = sumMoney(rows.map((c) => c.udharAmount));
  return { totalOutstanding, customers: rows };
}
