// Furniture receipts are dated independently from the eventual sale bill. The
// delivery application is a negative tender, so adding these net movements to
// bill tenders keeps each day's drawer correct without collecting twice.
export async function furnitureTendersForDay(client, shopId, { start, end, locationId }) {
  const result = { cash: 0, upi: 0, bank: 0, other: 0 };
  const rows = await client.financialLedger.groupBy({
    by: locationId ? ["entryType", "sourceId"] : ["entryType"],
    where: {
      shopId,
      sourceType: "furniture_order",
      entryType: { in: ["furniture_cash", "furniture_upi", "furniture_bank", "furniture_other"] },
      businessDate: { gte: start, lte: end },
    },
    _sum: { amountPaise: true },
  });
  if (rows.length === 0) return result;
  // Only today's tender sources need a location lookup. Legacy orders without a
  // location still belong to the primary store, including later refunds.
  const location = locationId ? await client.storeLocation.findFirst({
    where: { id: locationId, shopId }, select: { isPrimary: true },
  }) : null;
  const orders = locationId ? await client.furnitureOrder.findMany({
    where: {
      shopId,
      id: { in: [...new Set(rows.map((row) => row.sourceId))] },
      OR: [{ locationId }, ...(location?.isPrimary ? [{ locationId: null }] : [])],
    },
    select: { id: true },
  }) : null;
  const orderIds = orders ? new Set(orders.map((order) => order.id)) : null;
  const totals = { cash: 0n, upi: 0n, bank: 0n, other: 0n };
  for (const row of rows) {
    if (orderIds && !orderIds.has(row.sourceId)) continue;
    totals[row.entryType.slice(10)] += row._sum.amountPaise ?? 0n;
  }
  for (const mode of Object.keys(result)) result[mode] = Number(totals[mode]) / 100;
  return result;
}
