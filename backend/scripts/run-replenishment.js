import "dotenv/config";
import db from "../src/db.js";
import { runUnattendedReplenishment } from "../src/modules/stores/replenishment.service.js";

/**
 * Scheduled branch replenishment. Mirrors run-daily-closing.js so it can be driven
 * by cron or PM2 without Redis, but differs in one important way: this script
 * WRITES STOCK MOVEMENTS. It only ever acts on shops that have explicitly switched
 * replenishment on, and --dry-run is the way to see what it would do first.
 *
 *   node scripts/run-replenishment.js --dry-run
 *   node scripts/run-replenishment.js --shopId=<id>
 */
function arg(name) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") : null;
}

const dryRun = process.argv.includes("--dry-run");
const onlyShopId = arg("shopId");

async function main() {
  const shops = onlyShopId
    ? await db.shop.findMany({ where: { id: onlyShopId }, select: { id: true, name: true } })
    : await db.shop.findMany({ select: { id: true, name: true } });

  if (shops.length === 0) {
    console.log(JSON.stringify({ type: "replenishment_run", status: "no_shops", dryRun }));
    return;
  }

  const results = [];
  for (const shop of shops) {
    try {
      const result = await runUnattendedReplenishment(shop.id, { dryRun });
      results.push({
        shopId: shop.id,
        shopName: shop.name,
        executed: result.executed,
        reason: result.reason,
        planned: result.transfers?.length ?? 0,
        created: result.created?.length ?? 0,
        failed: result.failed?.length ?? 0,
        skipped: result.skipped?.length ?? 0,
      });
    } catch (error) {
      // One shop's failure must not stop the rest of the estate.
      results.push({ shopId: shop.id, shopName: shop.name, executed: false, reason: error.code ?? "RUN_FAILED", message: error.message });
    }
  }

  const created = results.reduce((sum, row) => sum + (row.created ?? 0), 0);
  console.log(JSON.stringify({ type: "replenishment_run", status: "done", dryRun, shops: results.length, transfersCreated: created, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ type: "replenishment_run", status: "failed", message: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
