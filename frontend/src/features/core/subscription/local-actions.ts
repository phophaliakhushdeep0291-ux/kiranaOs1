import { getSubscriptionStatus } from "@/features/core/subscription/api";
import { writeSubscriptionSnapshot } from "@/features/core/subscription/access";
import type { PlanCode } from "@/features/core/subscription/plans";
import { FREE_ACCESS_PLAN_CODE } from "@/features/core/subscription/free-access";
import { getOfflineLicense } from "@/features/core/devices/api";
import {
  parseOfflineLicenseToken,
  writeOfflineLicenseToken,
} from "@/features/core/devices/license";

/**
 * Kept under the historical name for callers, but this is intentionally
 * server-authoritative. A subscription refresh cannot be manufactured offline:
 * plan access and payment state must come from the billing service.
 */
export async function subscriptionRefreshLocalFirst(_planCode: PlanCode | string = "starter") {
  const [subscription, licensePayload] = await Promise.all([
    getSubscriptionStatus(),
    getOfflineLicense(),
  ]);
  const license = parseOfflineLicenseToken(licensePayload);
  if (!license) {
    throw new Error("The server did not return a valid signed device licence. Reconnect this device and try again.");
  }
  // While the launch promotion runs the server signs every licence for the full
  // plan, but still reports the shop's own plan on the subscription, which is what
  // it returns to afterwards. Comparing the two directly then refused every shop
  // not already on the top plan and never stored the licence the promotion issued.
  const subscriptionPlanCode = subscription.freeAccessUntil
    ? FREE_ACCESS_PLAN_CODE
    : String(subscription.planCode ?? "starter");
  if (license.plan !== subscriptionPlanCode) {
    throw new Error("The server returned inconsistent subscription and device licence plans. Try again after reconnecting this device.");
  }

  // Feature access intentionally trusts the signed device licence ahead of the
  // display-only subscription snapshot. Persist both before reporting success,
  // otherwise a paid plan can remain visibly locked behind a stale licence.
  await writeOfflineLicenseToken(license, "subscription-refresh");
  await writeSubscriptionSnapshot(subscription as unknown as Record<string, unknown>);
  return { success: true, pendingSync: false, subscription };
}
