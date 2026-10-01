// Furniture receipts are dated independently from the eventual sale bill. The
// delivery application is a negative tender, so adding these net movements to
// bill tenders keeps each day's drawer correct without collecting twice.
export async function furnitureTendersForDay(client, shopId, { start, end, locationId }) {
  const result = { cash: 0, upi: 0, bank: 0, other: 0 };
  const location = locationId ? await client.storeLocation.findFirst({ where: { id: locationId, shopId }, select: { isPrimary: true } }) : null;
  const orders = locationId
    ? await client.furnitureOrder.findMany({ where: { shopId, OR: [{ locationId }, ...(location?.isPrimary ? [{ locationId: null }] : [])] }, select: { id: true } })
    : null;
  if (orders?.length === 0) return result;
  const rows = await client.financialLedger.groupBy({
    by: ["entryType"],
    where: {
      shopId,
      sourceType: "furniture_order",
      ...(orders ? { sourceId: { in: orders.map((order) => order.id) } } : {}),
      entryType: { in: ["furniture_cash", "furniture_upi", "furniture_bank", "furniture_other"] },
      businessDate: { gte: start, lte: end },
    },
    _sum: { amountPaise: true },
  });
  for (const row of rows) result[row.entryType.slice(10)] = Number(row._sum.amountPaise ?? 0n) / 100;
  return result;
}
