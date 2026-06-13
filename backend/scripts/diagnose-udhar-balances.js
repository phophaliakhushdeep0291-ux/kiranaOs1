// READ-ONLY udhar diagnostic. Never writes — safe to run against production.
// Prints, per customer, the full udhar ledger entry-by-entry with a running balance and
// flags the likely root cause of a negative balance (unmatched/duplicate payments, or a
// payment whose bill was later cancelled). Use this BEFORE repair-udhar-balances.js so you
// know whether a negative is real overpayment (refund) or a data glitch (safe to clamp).
//
// Usage:
//   node scripts/diagnose-udhar-balances.js                 # all customers with a negative balance
//   node scripts/diagnose-udhar-balances.js --mobile=9571738238
//   node scripts/diagnose-udhar-balances.js --customerId=<id>
//   node scripts/diagnose-udhar-balances.js --shopId=<id>
//   node scripts/diagnose-udhar-balances.js --all           # every customer, not just negatives
import db from "../src/db.js";
import { signedUdharLedgerAmount } from "../src/modules/udhar/udharBalance.service.js";

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function fmtDate(d) {
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

async function main() {
  const shopId = arg("shopId");
  const customerId = arg("customerId");
  const mobile = arg("mobile");
  const showAll = process.argv.includes("--all");
  const targeted = Boolean(customerId || mobile);

  const where = { deletedAt: null };
  if (shopId) where.shopId = shopId;
  if (customerId) where.id = customerId;
  if (mobile) where.mobile = mobile;

  const customers = await db.customer.findMany({
    where,
    select: { id: true, shopId: true, name: true, mobile: true, udharAmount: true },
  });

  let negatives = 0;
  for (const customer of customers) {
    const entries = await db.udharLedger.findMany({
      where: { shopId: customer.shopId, customerId: customer.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, type: true, mode: true, amount: true, billId: true, billNo: true,
        reversalOfLedgerId: true, reversedAt: true, note: true, createdAt: true,
      },
    });

    const raw = round2(entries.reduce((t, e) => t + signedUdharLedgerAmount(e), 0));
    const isNegative = raw < -0.005;
    if (!showAll && !targeted && !isNegative) continue;
    if (isNegative) negatives += 1;

    const debits = round2(entries.filter((e) => e.type !== "payment").reduce((t, e) => t + Number(e.amount), 0));
    const payments = round2(entries.filter((e) => e.type === "payment").reduce((t, e) => t + Number(e.amount), 0));

    console.log("\n" + "=".repeat(78));
    console.log(`${customer.name}  (${customer.mobile ?? "no mobile"})  shop=${customer.shopId}`);
    console.log(`cached udharAmount=${customer.udharAmount}   ledger balance=${raw}${isNegative ? "   <<< NEGATIVE" : ""}`);
    console.log(`debits(+)=${debits}   payments(-)=${payments}   net=${round2(debits - payments)}`);
    console.log("-".repeat(78));

    let running = 0;
    const seen = new Map();
    for (const e of entries) {
      running = round2(running + signedUdharLedgerAmount(e));
      const sign = e.type === "payment" ? "-" : "+";
      const ref = e.billNo ?? e.billId ?? (e.reversalOfLedgerId ? `rev->${e.reversalOfLedgerId}` : "");
      const dupKey = `${e.type}|${e.mode}|${Number(e.amount).toFixed(2)}`;
      const flags = [];
      if (seen.has(dupKey)) flags.push("possible-duplicate");
      seen.set(dupKey, true);
      if (e.type === "payment" && !e.billId && (e.mode === "cash" || e.mode === "upi")) flags.push("manual-payment(no bill)");
      if (e.reversedAt) flags.push("reversed");
      console.log(
        `${fmtDate(e.createdAt)}  ${`${e.type}/${e.mode ?? ""}`.padEnd(24)} ${sign}${Number(e.amount).toFixed(2).padStart(10)}` +
        `   bal=${String(running).padStart(10)}   ${ref}${flags.length ? "   ⚠ " + flags.join(", ") : ""}`
      );
    }

    if (isNegative) {
      console.log("-".repeat(78));
      console.log(`ROOT CAUSE: payments exceed debits by ${round2(payments - debits)}.`);
      console.log("Inspect the ⚠ rows: a manual payment with no bill, a duplicate payment,");
      console.log("or a bill that was cancelled while its payment row stayed.");
    }
  }

  console.log(`\nChecked ${customers.length} customer(s). Negative balances: ${negatives}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
