#!/usr/bin/env node
/**
 * Give paying shops back the time the free launch window gave away.
 *
 * Shops that were already paying when the promotion began kept paying while
 * everyone else used the product for nothing, and their periods ran down all the
 * same. This credits each of them the overlap between their paid period and the
 * window, added after the window shuts so the days are ones they can use: a shop
 * whose month ended mid-window gets paid time starting in January rather than
 * more free days it already had.
 *
 * Founding grants are not credited — they carry a locked price so they can be
 * renewed, but nothing was paid for the period now running.
 *
 * Safe to run more than once: each credit writes an audit receipt, and a shop
 * that has one is never credited again. Run it any time — it credits the whole
 * overlap, including the part of the window still ahead, so it does not need a
 * second pass after 1 January.
 *
 *   node scripts/credit-free-window-overlap.js --check           report only
 *   node scripts/credit-free-window-overlap.js                   apply
 *   node scripts/credit-free-window-overlap.js --shop <shopId>   one shop
 *
 * The window it reads comes from FREE_ACCESS_FROM and FREE_ACCESS_UNTIL, so a
 * deployment whose promotion ran to different dates credits its own dates.
 */
import process from "node:process";
import { creditFreeWindowOverlap } from "../src/modules/subscription/freeWindowCredit.service.js";

const CHECK_ONLY = process.argv.includes("--check");
const shopFlag = process.argv.indexOf("--shop");
const SHOP_ID = shopFlag >= 0 ? process.argv[shopFlag + 1] : null;

if (shopFlag >= 0 && (!SHOP_ID || SHOP_ID.startsWith("--"))) {
  console.error("--shop needs a shop id");
  process.exit(1);
}

async function main() {
  const report = await creditFreeWindowOverlap({ apply: !CHECK_ONLY, shopId: SHOP_ID });

  console.log(`Free window: ${report.window.from} → ${report.window.until}`);
  console.log(CHECK_ONLY ? "Reporting only; nothing was written.\n" : "Applying credits.\n");

  for (const entry of report.credited) {
    console.log(
      `  ${entry.shopId}  ${entry.planCode.padEnd(8)} ${entry.status.padEnd(14)} `
      + `+${String(entry.days).padStart(3)}d   ${entry.from.slice(0, 10)} → ${entry.to.slice(0, 10)}`,
    );
  }

  const verb = CHECK_ONLY ? "owed" : "credited";
  console.log(
    `\n${report.credited.length} shop${report.credited.length === 1 ? "" : "s"} ${verb}`
    + ` (${report.creditedDays} day${report.creditedDays === 1 ? "" : "s"} in total).`,
  );
  console.log(
    `Skipped: ${report.alreadyCredited} already credited, `
    + `${report.notEligible} with nothing paid for the period, `
    + `${report.nothingOwed} whose period never overlapped the window.`,
  );
  if (CHECK_ONLY && report.credited.length > 0) {
    console.log("\nRun again without --check to apply.");
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
