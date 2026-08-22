import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_TRIAL_DAYS,
  getPlanConfig,
  PLAN_CONFIGS,
  PLAN_CODES,
  planAtLeast,
  validatePlanCode,
  deserializeFeatures,
  FIRST_YEAR_ONBOARDING_SKU,
  isOnboardingServiceAvailable,
  getPlanConfigForBusinessType,
} from "./planConfig.js";
import { businessTypeFromSettings, parseShopSettings } from "../shops/businessProfiles.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function seedPlans(tx = db) {
  const plans = [];
  for (const code of PLAN_CODES) {
    const plan = PLAN_CONFIGS[code];
    plans.push(
      await tx.plan.upsert({
        where: { code },
        update: {
          name: plan.name,
          priceMonthlyPaise: plan.priceMonthlyPaise,
          priceYearlyPaise: plan.priceYearlyPaise,
          maxDevices: plan.maxDevices,
          maxStores: plan.maxStores,
          maxStaff: plan.maxStaff,
          featuresJson: JSON.stringify(plan.features),
          isActive: code !== "standard",
        },
        create: {
          code,
          name: plan.name,
          priceMonthlyPaise: plan.priceMonthlyPaise,
          priceYearlyPaise: plan.priceYearlyPaise,
          maxDevices: plan.maxDevices,
          maxStores: plan.maxStores,
          maxStaff: plan.maxStaff,
          featuresJson: JSON.stringify(plan.features),
          isActive: code !== "standard",
        },
      })
    );
  }
  return plans;
}

export async function listPlans(businessType = "kirana") {
  await ensurePlansSeeded();
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthlyPaise: "asc" } });
  return plans.map((plan) => serializePlan(planForBusinessType(plan, businessType)));
}

export async function ensurePlansSeeded(client = db) {
  const existing = await client.plan.findMany({
    select: { code: true, name: true, priceMonthlyPaise: true, priceYearlyPaise: true, maxDevices: true, maxStores: true, maxStaff: true, featuresJson: true, isActive: true },
  });
  const byCode = new Map(existing.map((plan) => [plan.code, plan]));
  const catalogChanged = PLAN_CODES.some((code) => {
    const stored = byCode.get(code);
    const expected = PLAN_CONFIGS[code];
    return !stored
      || stored.name !== expected.name
      || stored.priceMonthlyPaise !== expected.priceMonthlyPaise
      || stored.priceYearlyPaise !== expected.priceYearlyPaise
      || stored.maxDevices !== expected.maxDevices
      || stored.maxStores !== expected.maxStores
      || stored.maxStaff !== expected.maxStaff
      || stored.featuresJson !== JSON.stringify(expected.features)
      || stored.isActive !== (code !== "standard");
  });
  if (catalogChanged) await seedPlans(client);
}

export async function getCurrentSubscription(shopId, client = db) {
  await ensurePlansSeeded(client);
  const subscription = await client.subscription.findUnique({ where: { shopId } });
  if (!subscription) {
    const shop = await client.shop.findUnique({
      where: { id: shopId },
      select: { createdAt: true, settingsJson: true },
    });
    if (!shop) throw new AppError("Shop not found", 404);
    const businessType = businessTypeFromSettings(parseShopSettings(shop.settingsJson));
    return fallbackSubscription(
      shopId,
      getPlanConfigForBusinessType("starter", businessType),
      shop.createdAt,
    );
  }
  const normalized = normalizeSubscriptionDates(subscription);
  const plan = await getPlanByCode(normalized.planCode, client);
  const entitledPlan = subscriptionPlanSnapshot(plan, normalized);
  return {
    ...normalized,
    active: isSubscriptionActive(normalized),
    source: "subscription",
    plan: serializePlan(entitledPlan),
    foundingCustomer: normalized.provider === "founding",
    foundingEndsAt: normalized.provider === "founding" ? normalized.trialEndsAt : null,
    intendedPaidPlanCode: normalized.intendedPaidPlanCode ?? normalized.planCode,
    warning: warningForSubscription(normalized),
  };
}

export async function getEffectivePlan(shopId, client = db) {
  const subscription = await getCurrentSubscription(shopId, client);
  const planCode = subscription.planCode || "starter";
  const catalogPlan = await getPlanByCode(planCode, client);
  const plan = subscriptionPlanSnapshot(catalogPlan, subscription);
  return {
    planCode,
    plan: serializePlan(plan),
    features: deserializeFeatures(plan.featuresJson),
    limits: planLimits(plan),
    subscription,
  };
}

export async function activateManualSubscription(shopId, planCode, period = "monthly", options = {}) {
  if (!validatePlanCode(planCode)) throw new AppError("Invalid plan code", 400);
  await ensurePlansSeeded();
  const now = options.paidAt ? new Date(options.paidAt) : new Date();
  const currentPeriodEnd = addPeriod(now, period);
  const provider = options.provider ?? "manual";

  return db.$transaction(async (tx) => {
    const plan = await getBillablePlan(shopId, planCode, tx);
    const amountPaise = options.amountPaise ?? (period === "yearly" ? plan.priceYearlyPaise : plan.priceMonthlyPaise);
    const before = await tx.subscription.findUnique({ where: { shopId } });
    const subscription = await tx.subscription.upsert({
      where: { shopId },
      update: {
        planCode,
        status: "active",
        provider,
        currentPeriodStart: now,
        currentPeriodEnd,
        trialEndsAt: null,
        graceEndsAt: addDays(currentPeriodEnd, DEFAULT_GRACE_DAYS),
        cancelledAt: null,
        lockedPriceMonthlyPaise: plan.priceMonthlyPaise,
        lockedPriceYearlyPaise: plan.priceYearlyPaise,
        entitledFeaturesJson: plan.featuresJson,
        intendedPaidPlanCode: planCode,
      },
      create: {
        shopId,
        planCode,
        status: "active",
        provider,
        currentPeriodStart: now,
        currentPeriodEnd,
        graceEndsAt: addDays(currentPeriodEnd, DEFAULT_GRACE_DAYS),
        lockedPriceMonthlyPaise: plan.priceMonthlyPaise,
        lockedPriceYearlyPaise: plan.priceYearlyPaise,
        entitledFeaturesJson: plan.featuresJson,
        intendedPaidPlanCode: planCode,
      },
    });

    const paymentTransaction = await tx.paymentTransaction.create({
      data: {
        shopId,
        subscriptionId: subscription.id,
        provider,
        amountPaise,
        currency: "INR",
        status: "paid",
        paidAt: now,
        rawPayloadJson: JSON.stringify({ source: "manual_activation", note: options.note ?? null }),
      },
    });

    await createSubscriptionAudit(tx, {
      shopId,
      userId: options.userId ?? null,
      action: "SUBSCRIPTION_ACTIVATED",
      entityId: subscription.id,
      deviceId: options.deviceId,
      req: options.req ?? null,
      before,
      after: subscription,
      metadata: { provider, planCode, period, amountPaise, transactionId: paymentTransaction.id },
    });

    return { subscription: normalizeSubscriptionDates(subscription), paymentTransaction };
  }, { isolationLevel: "Serializable" });
}

export async function activateSubscriptionAfterPayment({
  shopId,
  userId = null,
  planCode,
  provider = "razorpay",
  providerPaymentId = null,
  transactionId = null,
  billingCycle = "monthly",
  tx = db,
  deviceId = undefined,
  req = null,
} = {}) {
  if (!shopId) throw new AppError("Shop is required", 400);
  if (!validatePlanCode(planCode)) throw new AppError("Invalid plan code", 400);
  await ensurePlansSeeded(tx);

  const now = new Date();
  const current = await tx.subscription.findUnique({ where: { shopId } });
  const paidPlan = await getBillablePlan(shopId, planCode, tx);
  const currentActive = isSubscriptionActive(current);
  const samePlan = current?.planCode === planCode;
  const startsAt = currentActive && samePlan && current.currentPeriodEnd && current.currentPeriodEnd > now
    ? new Date(current.currentPeriodEnd)
    : now;
  const endsAt = addPeriod(startsAt, billingCycle);
  const action = currentActive && samePlan ? "renewed" : current && current.planCode !== planCode ? "plan_changed" : "activated";

  const subscription = await tx.subscription.upsert({
    where: { shopId },
    update: {
      planCode,
      status: "active",
      provider,
      providerSubscriptionId: providerPaymentId,
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
      trialEndsAt: null,
      graceEndsAt: addDays(endsAt, DEFAULT_GRACE_DAYS),
      cancelledAt: null,
      lockedPriceMonthlyPaise: paidPlan.priceMonthlyPaise,
      lockedPriceYearlyPaise: paidPlan.priceYearlyPaise,
      entitledFeaturesJson: paidPlan.featuresJson,
      intendedPaidPlanCode: planCode,
    },
    create: {
      shopId,
      planCode,
      status: "active",
      provider,
      providerSubscriptionId: providerPaymentId,
      currentPeriodStart: startsAt,
      currentPeriodEnd: endsAt,
      graceEndsAt: addDays(endsAt, DEFAULT_GRACE_DAYS),
      lockedPriceMonthlyPaise: paidPlan.priceMonthlyPaise,
      lockedPriceYearlyPaise: paidPlan.priceYearlyPaise,
      entitledFeaturesJson: paidPlan.featuresJson,
      intendedPaidPlanCode: planCode,
    },
  });

  if (transactionId) {
    await tx.paymentTransaction.updateMany({
      where: { id: transactionId, shopId },
      data: { subscriptionId: subscription.id },
    });
  }

  await createSubscriptionAudit(tx, {
    shopId,
    userId,
    action: action === "renewed" ? "SUBSCRIPTION_RENEWED" : action === "plan_changed" ? "SUBSCRIPTION_PLAN_CHANGED" : "SUBSCRIPTION_ACTIVATED",
    entityId: subscription.id,
    deviceId,
    req,
    before: current,
    after: subscription,
    metadata: { provider, providerPaymentId, transactionId, planCode, billingCycle, currentPeriodStart: startsAt, currentPeriodEnd: endsAt },
  });

  return { subscription: normalizeSubscriptionDates(subscription), action };
}


export async function reconcileSubscriptionAfterRefund({
  shopId,
  subscriptionId = null,
  providerPaymentId = null,
  transactionId = null,
  eventId = null,
  tx = db,
} = {}) {
  if (!shopId) return { subscriptionChanged: false, reason: "Missing shopId" };

  const subscription = subscriptionId
    ? await tx.subscription.findFirst({ where: { id: subscriptionId, shopId } })
    : await tx.subscription.findUnique({ where: { shopId } });

  if (!subscription) return { subscriptionChanged: false, reason: "Subscription not found" };

  const paymentMatchesSubscription =
    !providerPaymentId || !subscription.providerSubscriptionId || subscription.providerSubscriptionId === providerPaymentId;

  if (!paymentMatchesSubscription) {
    return { subscriptionChanged: false, reason: "Refunded payment does not match current subscription payment" };
  }

  const now = new Date();
  const updated = await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "cancelled",
      currentPeriodEnd: now,
      graceEndsAt: now,
      cancelledAt: now,
    },
  });

  await createSubscriptionAudit(tx, {
    shopId,
    userId: null,
    action: "SUBSCRIPTION_REFUND_RECONCILED",
    entityId: subscription.id,
    before: subscription,
    after: updated,
    metadata: { providerPaymentId, transactionId, eventId, previousStatus: subscription.status },
  });

  return { subscriptionChanged: true, subscription: normalizeSubscriptionDates(updated) };
}

export async function changePlan(shopId, planCode, actor = {}) {
  if (!validatePlanCode(planCode)) throw new AppError("Invalid plan code", 400);
  await ensurePlansSeeded();
  return db.$transaction(async (tx) => {
    const nextPlan = await getBillablePlan(shopId, planCode, tx);
    const now = new Date();
    const current = await tx.subscription.findUnique({ where: { shopId } });
    const next = current
      ? await tx.subscription.update({
        where: { shopId },
        data: {
          planCode,
          lockedPriceMonthlyPaise: nextPlan.priceMonthlyPaise,
          lockedPriceYearlyPaise: nextPlan.priceYearlyPaise,
          entitledFeaturesJson: nextPlan.featuresJson,
          intendedPaidPlanCode: planCode,
          updatedAt: now,
        },
      })
      : await tx.subscription.create({
        data: {
          shopId,
          planCode,
          status: "trial",
          provider: "admin",
          currentPeriodStart: now,
          currentPeriodEnd: addDays(now, DEFAULT_TRIAL_DAYS),
          trialEndsAt: addDays(now, DEFAULT_TRIAL_DAYS),
          graceEndsAt: addDays(addDays(now, DEFAULT_TRIAL_DAYS), DEFAULT_GRACE_DAYS),
          lockedPriceMonthlyPaise: nextPlan.priceMonthlyPaise,
          lockedPriceYearlyPaise: nextPlan.priceYearlyPaise,
          entitledFeaturesJson: nextPlan.featuresJson,
          intendedPaidPlanCode: planCode,
        },
      });
    await createSubscriptionAudit(tx, {
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId,
      req: actor.req ?? null,
      action: current ? "SUBSCRIPTION_PLAN_CHANGED" : "SUBSCRIPTION_TRIAL_GRANTED",
      entityId: next.id,
      before: current,
      after: next,
      metadata: { planCode, source: "internal_override" },
    });
    return next;
  }, { isolationLevel: "Serializable" });
}

export async function grantFoundingCustomer(shopId, intendedPaidPlanCode = "starter", options = {}) {
  if (!validatePlanCode(intendedPaidPlanCode)) throw new AppError("Invalid intended paid plan", 400);
  const now = options.startsAt ? new Date(options.startsAt) : new Date();
  const trialEndsAt = options.endsAt ? new Date(options.endsAt) : addDays(now, 365);
  if (!(trialEndsAt > now)) throw new AppError("Founding-customer end date must be in the future", 400);
  await ensurePlansSeeded();
  return db.$transaction(async (tx) => {
    const plan = await getBillablePlan(shopId, intendedPaidPlanCode, tx);
    const before = await tx.subscription.findUnique({ where: { shopId } });
    const subscription = await tx.subscription.upsert({
      where: { shopId },
      update: {
        planCode: intendedPaidPlanCode, status: "trial", provider: "founding",
        currentPeriodStart: now, currentPeriodEnd: trialEndsAt, trialEndsAt,
        graceEndsAt: addDays(trialEndsAt, DEFAULT_GRACE_DAYS), cancelledAt: null,
        intendedPaidPlanCode, lockedPriceMonthlyPaise: plan.priceMonthlyPaise,
        lockedPriceYearlyPaise: plan.priceYearlyPaise, entitledFeaturesJson: plan.featuresJson,
      },
      create: {
        shopId, planCode: intendedPaidPlanCode, status: "trial", provider: "founding",
        currentPeriodStart: now, currentPeriodEnd: trialEndsAt, trialEndsAt,
        graceEndsAt: addDays(trialEndsAt, DEFAULT_GRACE_DAYS), intendedPaidPlanCode,
        lockedPriceMonthlyPaise: plan.priceMonthlyPaise, lockedPriceYearlyPaise: plan.priceYearlyPaise,
        entitledFeaturesJson: plan.featuresJson,
      },
    });
    await createSubscriptionAudit(tx, {
      shopId,
      userId: options.userId ?? null,
      deviceId: options.deviceId,
      req: options.req ?? null,
      action: "SUBSCRIPTION_FOUNDING_GRANTED",
      entityId: subscription.id,
      before,
      after: subscription,
      metadata: { intendedPaidPlanCode, trialEndsAt, source: "internal_override" },
    });
    return subscription;
  }, { isolationLevel: "Serializable" });
}

export async function recordOnboardingPurchase(shopId, userId, input = {}, actor = {}) {
  const businessType = await getShopBusinessType(shopId);
  if (!isOnboardingServiceAvailable(businessType)) {
    const error = new AppError("Kirana Starter is self-serve and has no paid launch service", 422);
    error.code = "ONBOARDING_NOT_SOLD_FOR_KIRANA";
    throw error;
  }
  const includes = input.includes ?? FIRST_YEAR_ONBOARDING_SKU.includes;
  return db.$transaction(async (tx) => {
    const purchase = await tx.onboardingPurchase.create({ data: {
      shopId, recordedByUserId: userId ?? null, sku: FIRST_YEAR_ONBOARDING_SKU.code,
      amountPaise: input.amountPaise ?? FIRST_YEAR_ONBOARDING_SKU.amountPaise,
      status: input.status ?? "recorded", includesJson: JSON.stringify(includes),
      deliveredAt: input.status === "delivered" ? (input.deliveredAt ?? new Date()) : null,
      notes: input.notes ?? null,
    }});
    await createSubscriptionAudit(tx, {
      shopId,
      userId: actor.userId ?? userId ?? null,
      deviceId: actor.deviceId,
      req: actor.req ?? null,
      action: "SUBSCRIPTION_ONBOARDING_PURCHASE_RECORDED",
      entityId: purchase.id,
      after: purchase,
      metadata: { sku: purchase.sku, amountPaise: purchase.amountPaise, status: purchase.status },
    });
    return purchase;
  }, { isolationLevel: "Serializable" });
}

export async function listOnboardingPurchases(shopId) {
  return db.onboardingPurchase.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } });
}

export async function getBillablePlan(shopId, planCode, client = db) {
  const plan = await getPlanByCode(planCode, client);
  const current = await client.subscription.findUnique({ where: { shopId } });
  if (current?.planCode === planCode) return subscriptionPlanSnapshot(plan, current);
  const businessType = await getShopBusinessType(shopId, client);
  return planForBusinessType(plan, businessType);
}

export async function cancelSubscription(shopId, actor = {}) {
  return db.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { shopId } });
    if (!subscription) return getCurrentSubscription(shopId, tx);
    const cancelled = await tx.subscription.update({
      where: { shopId },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
    await createSubscriptionAudit(tx, {
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId,
      req: actor.req ?? null,
      action: "SUBSCRIPTION_CANCELLED",
      entityId: cancelled.id,
      before: subscription,
      after: cancelled,
    });
    return cancelled;
  }, { isolationLevel: "Serializable" });
}

export async function extendGrace(shopId, days, actor = {}) {
  return db.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({ where: { shopId } });
    if (!subscription) throw new AppError("Subscription not found", 404);
    const graceBase = subscription.graceEndsAt && subscription.graceEndsAt > new Date()
      ? subscription.graceEndsAt
      : new Date();
    const extended = await tx.subscription.update({
      where: { shopId },
      data: { status: "grace", graceEndsAt: addDays(graceBase, days) },
    });
    await createSubscriptionAudit(tx, {
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId,
      req: actor.req ?? null,
      action: "SUBSCRIPTION_GRACE_EXTENDED",
      entityId: extended.id,
      before: subscription,
      after: extended,
      metadata: { days, source: "internal_override" },
    });
    return extended;
  }, { isolationLevel: "Serializable" });
}

export function isSubscriptionActive(subscription) {
  if (!subscription) return true;
  const now = new Date();
  if (subscription.status === "cancelled") return !!subscription.currentPeriodEnd && subscription.currentPeriodEnd > now;
  if (["expired", "payment_failed"].includes(subscription.status)) return false;
  if (subscription.status === "trial") {
    if (!subscription.trialEndsAt || subscription.trialEndsAt > now) return true;
    return !!subscription.graceEndsAt && subscription.graceEndsAt > now;
  }
  if (subscription.status === "grace") return !!subscription.graceEndsAt && subscription.graceEndsAt > now;
  if (subscription.status === "active") {
    if (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now) return true;
    // The period has ended but nothing flipped the row to "grace" — this deployment runs no
    // subscription scheduler, so status stays "active" indefinitely. Honor the grace window that
    // was provisioned at activation (currentPeriodEnd + DEFAULT_GRACE_DAYS) so a paying shop is
    // not cut off the instant the period rolls over; access ends only once grace itself elapses.
    return !!subscription.graceEndsAt && subscription.graceEndsAt > now;
  }
  return false;
}

export async function getSubscriptionStatus(shopId) {
  const subscription = await getCurrentSubscription(shopId);
  return {
    status: subscription.status,
    active: subscription.active,
    planCode: subscription.planCode,
    source: subscription.source,
    warning: subscription.warning,
  };
}

export function canUseFeature(planCode, featureName) {
  return getPlanConfig(planCode).features.includes(featureName);
}

export function isPlanAtLeast(planCode, minimumPlanCode) {
  return planAtLeast(planCode, minimumPlanCode);
}

export async function getPlanByCode(planCode, client = db) {
  const plan = await client.plan.findUnique({ where: { code: planCode } });
  if (plan) return plan;
  const cfg = getPlanConfig(planCode);
  return {
    id: `fallback-${cfg.code}`,
    code: cfg.code,
    name: cfg.name,
    priceMonthlyPaise: cfg.priceMonthlyPaise,
    priceYearlyPaise: cfg.priceYearlyPaise,
    maxDevices: cfg.maxDevices,
    maxStores: cfg.maxStores,
    maxStaff: cfg.maxStaff,
    featuresJson: JSON.stringify(cfg.features),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fallbackSubscription(shopId, starterPlan = getPlanConfig("starter"), trialStartedAt = new Date()) {
  const now = new Date();
  const parsedTrialStart = new Date(trialStartedAt);
  const trialStart = Number.isNaN(parsedTrialStart.getTime()) ? now : parsedTrialStart;
  const trialEndsAt = addDays(trialStart, DEFAULT_TRIAL_DAYS);
  const fallback = {
    id: null,
    shopId,
    planCode: "starter",
    status: "trial",
    provider: "manual",
    providerSubscriptionId: null,
    currentPeriodStart: trialStart,
    currentPeriodEnd: trialEndsAt,
    trialEndsAt,
    graceEndsAt: addDays(trialEndsAt, DEFAULT_GRACE_DAYS),
    cancelledAt: null,
    createdAt: trialStart,
    updatedAt: trialStart,
    source: "fallback/trial",
    plan: serializePlan(starterPlan),
    warning: "No persisted subscription found; Starter trial is anchored to the shop creation date.",
  };
  return { ...fallback, active: isSubscriptionActive(fallback) };
}

function serializePlan(plan) {
  return {
    id: plan.id ?? plan.code,
    code: plan.code,
    name: plan.name,
    priceMonthlyPaise: plan.priceMonthlyPaise,
    priceYearlyPaise: plan.priceYearlyPaise,
    maxDevices: plan.maxDevices,
    maxStores: plan.maxStores,
    maxStaff: plan.maxStaff,
    features: plan.features ?? deserializeFeatures(plan.featuresJson),
    isActive: plan.isActive ?? true,
  };
}

function planLimits(plan) {
  return {
    maxDevices: plan.maxDevices,
    maxStores: plan.maxStores,
    maxStaff: plan.maxStaff,
  };
}

function subscriptionPlanSnapshot(plan, subscription) {
  if (!subscription) return plan;
  return {
    ...plan,
    priceMonthlyPaise: subscription.lockedPriceMonthlyPaise ?? plan.priceMonthlyPaise,
    priceYearlyPaise: subscription.lockedPriceYearlyPaise ?? plan.priceYearlyPaise,
    featuresJson: subscription.entitledFeaturesJson ?? plan.featuresJson,
  };
}

function planForBusinessType(plan, businessType) {
  if (!plan || plan.code === "standard") return plan;
  const configured = getPlanConfigForBusinessType(plan.code, businessType);
  return {
    ...plan,
    priceMonthlyPaise: configured.priceMonthlyPaise,
    priceYearlyPaise: configured.priceYearlyPaise,
    featuresJson: JSON.stringify(configured.features),
  };
}

async function getShopBusinessType(shopId, client = db) {
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  return businessTypeFromSettings(parseShopSettings(shop?.settingsJson));
}

function warningForSubscription(subscription) {
  if (subscription.status === "grace") return "Subscription is in grace period.";
  if (subscription.status === "cancelled" && subscription.currentPeriodEnd > new Date()) {
    return `Subscription is cancelled; paid access continues until ${subscription.currentPeriodEnd.toISOString()}.`;
  }
  if (["expired", "cancelled", "payment_failed"].includes(subscription.status)) {
    return "Subscription is not active. Old data viewing is allowed, premium/cloud actions are blocked.";
  }
  return null;
}

function normalizeSubscriptionDates(subscription) {
  return {
    ...subscription,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialEndsAt: subscription.trialEndsAt,
    graceEndsAt: subscription.graceEndsAt,
  };
}

function addPeriod(date, period) {
  const d = new Date(date);
  if (period === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function createSubscriptionAudit(tx, {
  shopId,
  userId = null,
  deviceId = undefined,
  action,
  entityId = null,
  before = undefined,
  after = undefined,
  metadata = {},
  req = null,
}) {
  const audit = await createAuditLog({
    shopId,
    userId,
    deviceId,
    action,
    entityType: "subscription",
    entityId,
    before,
    after,
    metadata,
    req,
    client: tx,
  });
  if (!audit) {
    throw new AppError(
      "Subscription change was not saved because its audit record could not be stored",
      503,
      "SUBSCRIPTION_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}
