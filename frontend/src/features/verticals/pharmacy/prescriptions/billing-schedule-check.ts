import { registerSettleCheck, type SettleCheckContext, type SettleWarning } from "@/features/core/billing/settle-checks";

/**
 * Do not hand over a Schedule H medicine on nothing.
 *
 * India's Drugs and Cosmetics Rules make dispensing a Schedule H, H1 or X
 * medicine without a valid prescription an offence, and the sale has to be
 * recorded. `sale-guards.js` refuses such a bill on the server, and the
 * prescription control appears in billing the moment a restricted line is
 * scanned — so the chemist is offered the right thing at the right time.
 *
 * Offering is not stopping. The till is offline-first: a bill commits locally
 * and syncs afterwards, so the server's refusal arrives long after the strip has
 * left the counter. Sold one this way and the shop is told "saved safely", the
 * medicine is gone, and the bill sits in the outbox waiting to be rejected by a
 * rule nobody at the counter was shown.
 *
 * This is the counter's half of that guard: the same question, asked while the
 * customer is still standing there.
 *
 * It warns rather than refuses, like every other settle check. A chemist may be
 * holding the paper slip and filing it after the rush, and a till that refuses
 * outright is a till that gets worked around. The server still refuses what it
 * must; this makes sure the decision is a person's rather than an accident.
 */

/** The schedules a slip is required for. `otc` is explicit "sell freely". */
const RESTRICTED = new Set(["h", "h1", "x"]);

/** H1 is strictest — its own bound register, kept three years — then X, then H. */
const SEVERITY: Record<string, number> = { h: 1, x: 2, h1: 3 };

function scheduleOf(item: SettleCheckContext["cart"][number]): string | null {
  const raw = (item.product as { drugSchedule?: string | null } | undefined)?.drugSchedule;
  const key = String(raw ?? "").trim().toLowerCase();
  return RESTRICTED.has(key) ? key : null;
}

export async function unslippedScheduleLines(context: SettleCheckContext): Promise<SettleWarning | null> {
  const restricted = (context.cart ?? [])
    .map((item) => ({ item, schedule: scheduleOf(item) }))
    .filter((row): row is { item: typeof row.item; schedule: string } => row.schedule !== null);
  if (restricted.length === 0) return null;

  // The pharmacy's own control holds the attached slip. Anything truthy there is
  // a prescription the chemist has picked, which is exactly what satisfies the
  // server guard too.
  if (context.slotValues?.["pharmacy/prescription"]) return null;

  const strictest = restricted
    .map((row) => row.schedule)
    .reduce((worst, key) => (SEVERITY[key] > SEVERITY[worst] ? key : worst), restricted[0].schedule);

  return {
    title: { key: "shopType.pharmacy.settle.noPrescriptionTitle", vars: { schedule: strictest.toUpperCase() } },
    body: {
      key: "shopType.pharmacy.settle.noPrescriptionBody",
      vars: { items: restricted.map((row) => row.item.product?.name).filter(Boolean).join(", ") },
    },
    confirm: { key: "shopType.pharmacy.settle.noPrescriptionConfirm" },
  };
}

registerSettleCheck({ id: "pharmacy/schedule-slip", run: unslippedScheduleLines });
