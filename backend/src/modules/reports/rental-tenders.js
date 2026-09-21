import { fromPaise } from "../../utils/money.js";

export async function rentalTendersForDay(client, shopId, { start, end, locationId }) {
  const bookings = locationId ? await client.rentalBooking.findMany({ where: { shopId, locationId }, select: { id: true } }) : null;
  const rows = await client.financialLedger.groupBy({
    by: ["entryType"],
    where: { shopId, sourceType: "rental", ...(bookings && { sourceId: { in: bookings.map(row => row.id) } }),
      businessDate: { gte: start, lte: end }, entryType: { in: ["rental_cash", "rental_upi", "rental_bank", "rental_other"] } },
    _sum: { amountPaise: true },
  });
  return Object.fromEntries(["cash", "upi", "bank", "other"].map(mode => [mode,
    fromPaise(Number(rows.find(row => row.entryType === `rental_${mode}`)?._sum.amountPaise ?? 0n)),
  ]));
}
