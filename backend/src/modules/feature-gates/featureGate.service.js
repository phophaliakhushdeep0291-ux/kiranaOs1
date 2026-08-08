import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import {
  deserializeFeatures,
  planAtLeast,
  SHOP_TYPE_ENTITLEMENTS_V1,
  SHOP_TYPE_FEATURES,
} from "../subscription/planConfig.js";
import { getEffectivePlan, getSubscriptionStatus, isSubscriptionActive } from "../subscription/subscription.service.js";
import { FEATURE_REGISTRY, OLD_DATA_VIEW_FEATURE } from "./featureRegistry.js";

export async function hasFeature(shopId, featureName) {
  if (featureName === OLD_DATA_VIEW_FEATURE) return true; // view_old_data is always allowed so shops are not trapped after expiry.
  const effective = await getEffectivePlan(shopId);
  const subscription = effective.subscription;
  if (!isSubscriptionActive(subscription)) return false;
  return effective.features.includes(featureName) || hasLegacyShopTypeAccess(effective.features, featureName);
}

export function isOldDataViewFeature(featureName) {
  return featureName === OLD_DATA_VIEW_FEATURE;
}

export async function requireFeatureAccess(shopId, featureName) {
  if (isOldDataViewFeature(featureName)) return { allowed: true };
  const effective = await getEffectivePlan(shopId);
  if (!isSubscriptionActive(effective.subscription)) {
    const err = new AppError("Active subscription required", 402);
    err.code = "SUBSCRIPTION_INACTIVE";
    err.meta = { status: effective.subscription.status, planCode: effective.planCode };
    throw err;
  }
  if (!effective.features.includes(featureName) && !hasLegacyShopTypeAccess(effective.features, featureName)) {
    const err = new AppError("Feature not available on current plan", 403);
    err.code = "FEATURE_NOT_INCLUDED";
    err.meta = { featureName, planCode: effective.planCode, requiredPlan: FEATURE_REGISTRY[featureName]?.minimumPlan };
    throw err;
  }
  return { allowed: true, planCode: effective.planCode };
}

function hasLegacyShopTypeAccess(features, featureName) {
  return SHOP_TYPE_FEATURES.includes(featureName) && !features.includes(SHOP_TYPE_ENTITLEMENTS_V1);
}

// Continuity actions are deliberately narrow: a lapsed shop can finish the sale
// at the counter and take its data away. This does not reopen any other mutation.
export async function requireContinuityAccess(shopId, featureName) {
  const effective = await getEffectivePlan(shopId);
  if (!isSubscriptionActive(effective.subscription)) {
    if (["complete_sale", "export_data"].includes(featureName)) return { allowed: true, continuityMode: true };
    throw new AppError("Action is unavailable after subscription expiry", 402, "SUBSCRIPTION_INACTIVE");
  }
  const entitledFeature = featureName === "complete_sale" ? "basic_billing" : "csv_import_export";
  if (featureName === "complete_sale" || effective.features.includes(entitledFeature)) return { allowed: true, continuityMode: false };
  throw new AppError("Feature not available on current plan", 403, "FEATURE_NOT_INCLUDED");
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
