// Rentals use dated, immutable tender events. Booking totals cannot distinguish
// today's payment from yesterday's advance, or a refund from a deposit still held.
export async function rentalTendersForDay(client, shopId, { start, end, locationId }) {
  const result = { cash: 0, upi: 0, bank: 0, other: 0 };
  const bookings = locationId ? await client.rentalBooking.findMany({ where: { shopId, locationId }, select: { id: true } }) : null;
  if (bookings?.length === 0) return result;
  const rows = await client.financialLedger.groupBy({
    by: ["entryType"],
    where: {
      shopId, sourceType: "rental", ...(bookings ? { sourceId: { in: bookings.map((booking) => booking.id) } } : {}),
      entryType: { in: ["rental_cash", "rental_upi", "rental_bank", "rental_other"] },
      businessDate: { gte: start, lte: end },
    },
    _sum: { amountPaise: true },
  });
  for (const row of rows) result[row.entryType.slice(7)] = Number(row._sum.amountPaise ?? 0n) / 100;
  return result;
}
