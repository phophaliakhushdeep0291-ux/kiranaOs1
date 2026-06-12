import { round2, toPaiseBigInt } from "../../utils/money.js";

export function signedUdharLedgerAmount(entry) {
  const amount = Number(entry?.amount ?? 0);
  return entry?.type === "payment" ? -amount : amount;
}

export async function calculateCustomerUdharRawBalance(tx, shopId, customerId) {
  const entries = await tx.udharLedger.findMany({
    where: { shopId, customerId },
    select: { type: true, amount: true },
  });
  return round2(entries.reduce((total, entry) => total + signedUdharLedgerAmount(entry), 0));
}

export async function calculateCustomerUdharBalance(tx, shopId, customerId) {
  const rawBalance = await calculateCustomerUdharRawBalance(tx, shopId, customerId);
  return {
    rawBalance,
    balance: round2(Math.max(0, rawBalance)),
    isNegative: rawBalance < 0,
  };
}

export async function calculateCustomerUdharBalances(tx, shopId, customerIds) {
  const ids = [...new Set((customerIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();

  const entries = await tx.udharLedger.findMany({
    where: { shopId, customerId: { in: ids } },
    select: { customerId: true, type: true, amount: true },
  });

  const totals = new Map(ids.map((id) => [id, 0]));
  for (const entry of entries) {
    totals.set(entry.customerId, round2((totals.get(entry.customerId) ?? 0) + signedUdharLedgerAmount(entry)));
  }

  return new Map(
    ids.map((id) => {
      const rawBalance = round2(totals.get(id) ?? 0);
      return [id, {
        rawBalance,
        balance: round2(Math.max(0, rawBalance)),
        isNegative: rawBalance < 0,
      }];
    })
  );
}

export async function syncCustomerUdharBalance(tx, shopId, customerId, options = {}) {
  const { repairNegative = false, repairNote = "System udhar repair: negative balance corrected to zero" } = options;
  let { rawBalance, balance, isNegative } = await calculateCustomerUdharBalance(tx, shopId, customerId);

  if (repairNegative && isNegative) {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, shopId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (customer) {
      const repairAmount = round2(Math.abs(rawBalance));
      await tx.udharLedger.create({
        data: {
          shopId,
          customerId,
          customerName: customer.name,
          type: "debit",
          amount: repairAmount,
          amountPaise: toPaiseBigInt(repairAmount),
          mode: "system_repair",
          note: repairNote,
        },
      });
      rawBalance = await calculateCustomerUdharRawBalance(tx, shopId, customerId);
      balance = round2(Math.max(0, rawBalance));
      isNegative = rawBalance < 0;
    }
  }

  await tx.customer.updateMany({
    where: { id: customerId, shopId, deletedAt: null },
    data: {
      udharAmount: balance,
      udharAmountPaise: toPaiseBigInt(balance),
      type: balance > 0 ? "udhar" : "regular",
    },
  });

  return { rawBalance, balance, isNegative };
}
