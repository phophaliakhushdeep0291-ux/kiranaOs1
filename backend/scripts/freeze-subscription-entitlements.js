#!/usr/bin/env node
/**
 * Freeze what every live subscription is entitled to, and what it pays.
 *
 * Run this BEFORE any change to plan pricing or plan feature sets. It is the
 * whole safety mechanism for such a change, and it is not idempotent in the
 * usual sense — it is a point-in-time photograph, so taking it after the config
 * has moved photographs the wrong thing.
 *
 * Two columns already exist for this and both are read in preference to the
 * plan:
 *
 *   entitledFeaturesJson   subscription.service.js reads
 *                          `subscription.entitledFeaturesJson ?? plan.featuresJson`,
 *                          so a subscription carrying its own snapshot keeps
 *                          every feature it has today when the plan underneath
 *                          it changes.
 *
 *   lockedPrice*Paise      the amount to charge on renewal, independent of what
 *                          the plan now lists.
 *
 * Without the snapshot, moving a feature from one tier to another silently takes
 * a working screen away from a shop that is mid-service. Without the lock, a
 * price change reaches people who never agreed to it.
 *
 *   node scripts/freeze-subscription-entitlements.js --check   report only
 *   node scripts/freeze-subscription-entitlements.js           write
 */
import process from "node:process";
import db from "../src/db.js";
import { getPlanConfigForBusinessType } from "../src/modules/subscription/planConfig.js";

const CHECK_ONLY = process.argv.includes("--check");

function businessTypeOf(shop) {
  try {
    const settings = JSON.parse(shop?.settingsJson || "{}");
    return settings?.businessProfile?.businessType
      ?? settings?.storeProfile?.businessTypeKey
      ?? "other";
  } catch {
    return "other";
  }
}

async function main() {
  const subscriptions = await db.subscription.findMany({
    select: {
      id: true,
      shopId: true,
      planCode: true,
      status: true,
      entitledFeaturesJson: true,
      lockedPriceMonthlyPaise: true,
      lockedPriceYearlyPaise: true,
    },
  });

  const shops = await db.shop.findMany({ select: { id: true, settingsJson: true } });
  const typeByShop = new Map(shops.map((shop) => [shop.id, businessTypeOf(shop)]));

  let features = 0;
  let prices = 0;
  let already = 0;
  const byTrade = new Map();

  for (const subscription of subscriptions) {
    const businessType = typeByShop.get(subscription.shopId) ?? "other";
    const plan = getPlanConfigForBusinessType(subscription.planCode, businessType);

    const data = {};
    // Never overwrite a snapshot that is already there: it may record an older,
    // more generous entitlement than the plan currently lists, which is exactly
    // the thing worth keeping.
    if (!subscription.entitledFeaturesJson) {
      data.entitledFeaturesJson = JSON.stringify(plan.features);
      features += 1;
    }
    if (subscription.lockedPriceMonthlyPaise == null) {
      data.lockedPriceMonthlyPaise = plan.priceMonthlyPaise;
      data.lockedPriceYearlyPaise = plan.priceYearlyPaise;
      prices += 1;
    }

    if (Object.keys(data).length === 0) {
      already += 1;
      continue;
    }

    byTrade.set(businessType, (byTrade.get(businessType) ?? 0) + 1);
    if (!CHECK_ONLY) await db.subscription.update({ where: { id: subscription.id }, data });
  }

  const report = {
    type: "subscription_entitlement_freeze",
    mode: CHECK_ONLY ? "check" : "write",
    subscriptions: subscriptions.length,
    featuresFrozen: features,
    pricesLocked: prices,
    alreadyFrozen: already,
    byTrade: Object.fromEntries([...byTrade].sort()),
  };
  console.log(JSON.stringify(report));

  // A check run is a gate, not a report: it fails while anything is unfrozen so
  // a deploy pipeline can refuse to ship the plan change until this has run.
  if (CHECK_ONLY && (features > 0 || prices > 0)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect().catch(() => {}));
