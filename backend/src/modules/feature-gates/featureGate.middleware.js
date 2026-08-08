import {
  requireActiveSubscriptionAccess,
  requireFeatureAccess,
  requireContinuityAccess,
  requirePlanAtLeastAccess,
} from "./featureGate.service.js";

export function requireFeature(featureName) {
  return async (req, _res, next) => {
    try {
      await requireFeatureAccess(req.shopId, featureName);
      next();
    } catch (err) { next(err); }
  };
}

export function requireContinuityAction(actionName) {
  return async (req, _res, next) => {
    try { await requireContinuityAccess(req.shopId, actionName); next(); }
    catch (err) { next(err); }
  };
}

export function requireActiveSubscription() {
  return async (req, _res, next) => {
    try {
      await requireActiveSubscriptionAccess(req.shopId);
      next();
    } catch (err) { next(err); }
  };
}

export function requirePlanAtLeast(planCode) {
  return async (req, _res, next) => {
    try {
      await requirePlanAtLeastAccess(req.shopId, planCode);
      next();
    } catch (err) { next(err); }
  };
}
