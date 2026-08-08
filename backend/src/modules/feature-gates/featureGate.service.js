import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { deserializeFeatures, planAtLeast } from "../subscription/planConfig.js";
import { getEffectivePlan, getSubscriptionStatus, isSubscriptionActive } from "../subscription/subscription.service.js";
import { FEATURE_REGISTRY, OLD_DATA_VIEW_FEATURE } from "./featureRegistry.js";

export async function hasFeature(shopId, featureName) {
  if (featureName === OLD_DATA_VIEW_FEATURE) return true; // view_old_data is always allowed so shops are not trapped after expiry.
  const effective = await getEffectivePlan(shopId);
  const subscription = effective.subscription;
  if (!isSubscriptionActive(subscription)) return false;
  return effective.features.includes(featureName);
}

export function isOldDataViewFeature(featureName) {
  return featureName === OLD_DATA_VIEW_FEATURE;
}

// `client` matters when this is called from inside a transaction: reading the
// plan on the root client there is a second connection, which SQLite's
// single-connection pool cannot grant until the transaction ends — the caller
// then stalls until its own transaction expires. Pass `tx` and the read joins
// the transaction instead.
export async function requireFeatureAccess(shopId, featureName, client) {
  if (isOldDataViewFeature(featureName)) return { allowed: true };
  const effective = await getEffectivePlan(shopId, client);
  if (!isSubscriptionActive(effective.subscription)) {
    const err = new AppError("Active subscription required", 402);
    err.code = "SUBSCRIPTION_INACTIVE";
    err.meta = { status: effective.subscription.status, planCode: effective.planCode };
    throw err;
  }
  if (!effective.features.includes(featureName)) {
    const err = new AppError("Feature not available on current plan", 403);
    err.code = "FEATURE_NOT_INCLUDED";
    err.meta = { featureName, planCode: effective.planCode, requiredPlan: FEATURE_REGISTRY[featureName]?.minimumPlan };
    throw err;
  }
  return { allowed: true, planCode: effective.planCode };
}

export async function requireActiveSubscriptionAccess(shopId) {
  const status = await getSubscriptionStatus(shopId);
  if (!status.active) {
    const err = new AppError("Active subscription required", 402);
    err.code = "SUBSCRIPTION_INACTIVE";
    err.meta = status;
    throw err;
  }
  return status;
}

export async function requirePlanAtLeastAccess(shopId, planCode) {
  const effective = await getEffectivePlan(shopId);
  if (!isSubscriptionActive(effective.subscription)) {
    const err = new AppError("Active subscription required", 402);
    err.code = "SUBSCRIPTION_INACTIVE";
    throw err;
  }
  if (!planAtLeast(effective.planCode, planCode)) {
    const err = new AppError(`Plan ${planCode} or higher required`, 403);
    err.code = "PLAN_TOO_LOW";
    err.meta = { currentPlan: effective.planCode, requiredPlan: planCode };
    throw err;
  }
  return effective;
}

export async function getPlanLimits(shopId) {
  return (await getEffectivePlan(shopId)).limits;
}

export async function canUseDevice(shopId) {
  const limits = await getPlanLimits(shopId);
  const activeCount = await db.device.count({ where: { shopId, status: "active" } });
  return { allowed: activeCount < limits.maxDevices, activeCount, maxDevices: limits.maxDevices };
}

export async function canAddStaff(shopId) {
  const limits = await getPlanLimits(shopId);
  const staffCount = await db.user.count({ where: { shopId, role: { in: ["staff", "admin"] } } });
  return { allowed: staffCount < limits.maxStaff, staffCount, maxStaff: limits.maxStaff };
}

export async function getReportRangeLimit(shopId) {
  const effective = await getEffectivePlan(shopId);
  const features = new Set(deserializeFeatures(effective.plan.featuresJson ?? JSON.stringify(effective.features)));
  if (features.has("yearly_reports")) return { days: 365, feature: "yearly_reports" };
  if (features.has("monthly_reports")) return { days: 31, feature: "monthly_reports" };
  if (features.has("thirty_day_reports")) return { days: 30, feature: "thirty_day_reports" };
  return { days: 7, feature: "seven_day_local_reports" };
}
