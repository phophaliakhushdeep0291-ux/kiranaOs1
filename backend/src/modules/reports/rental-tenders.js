// Rentals use dated, immutable tender events. Booking totals cannot distinguish
// today's payment from yesterday's advance, or a refund from a deposit still held.
export async function rentalTendersForDay(client, shopId, { start, end, locationId }) {
  const result = { cash: 0, upi: 0, bank: 0, other: 0 };
  const rows = await client.financialLedger.groupBy({
    by: locationId ? ["entryType", "sourceId"] : ["entryType"],
    where: {
      shopId, sourceType: "rental",
      entryType: { in: ["rental_cash", "rental_upi", "rental_bank", "rental_other"] },
      businessDate: { gte: start, lte: end },
    },
    _sum: { amountPaise: true },
  });
  if (rows.length === 0) return result;
  // Resolve only bookings that moved money on this day, not the shop's entire
  // rental history. Old/cancelled bookings can still have a dated refund.
  const bookings = locationId ? await client.rentalBooking.findMany({
    where: { shopId, locationId, id: { in: [...new Set(rows.map((row) => row.sourceId))] } },
    select: { id: true },
  }) : null;
  const bookingIds = bookings ? new Set(bookings.map((booking) => booking.id)) : null;
  const totals = { cash: 0n, upi: 0n, bank: 0n, other: 0n };
  for (const row of rows) {
    if (bookingIds && !bookingIds.has(row.sourceId)) continue;
    totals[row.entryType.slice(7)] += row._sum.amountPaise ?? 0n;
  }
  // Convert once per tender, after summing the integer source subtotals.
  for (const mode of Object.keys(result)) result[mode] = Number(totals[mode]) / 100;
  return result;
}
