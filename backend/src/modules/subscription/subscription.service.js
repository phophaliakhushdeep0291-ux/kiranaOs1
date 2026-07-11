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
} from "./planConfig.js";

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
          isActive: true,
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
          isActive: true,
        },
      })
    );
  }
  return plans;
}

export async function listPlans() {
  await ensurePlansSeeded();
  const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthlyPaise: "asc" } });
  return plans.map(serializePlan);
}

export async function ensurePlansSeeded(client = db) {
  const count = await client.plan.count();
  if (count < PLAN_CODES.length) await seedPlans(client);
}

export async function getCurrentSubscription(shopId, client = db) {
  await ensurePlansSeeded(client);
  const subscription = await client.subscription.findUnique({ where: { shopId } });
  if (!subscription) return fallbackSubscription(shopId);
  const normalized = normalizeSubscriptionDates(subscription);
  const plan = await getPlanByCode(normalized.planCode, client);
  return {
    ...normalized,
    active: isSubscriptionActive(normalized),
    source: "subscription",
    plan: serializePlan(plan),
    warning: warningForSubscription(normalized),
  };
}

export async function getEffectivePlan(shopId, client = db) {
  const subscription = await getCurrentSubscription(shopId, client);
  const planCode = subscription.planCode || "starter";
  const plan = await getPlanByCode(planCode, client);
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
  const plan = await getPlanByCode(planCode);
  const now = options.paidAt ? new Date(options.paidAt) : new Date();
  const currentPeriodEnd = addPeriod(now, period);
  const amountPaise = options.amountPaise ?? (period === "yearly" ? plan.priceYearlyPaise : plan.priceMonthlyPaise);
  const provider = options.provider ?? "manual";

  return db.$transaction(async (tx) => {
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
      },
      create: {
        shopId,
        planCode,
        status: "active",
        provider,
        currentPeriodStart: now,
        currentPeriodEnd,
        graceEndsAt: addDays(currentPeriodEnd, DEFAULT_GRACE_DAYS),
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
      metadata: { provider, planCode, period, amountPaise, transactionId: paymentTransaction.id },
    });

    return { subscription: normalizeSubscriptionDates(subscription), paymentTransaction };
  });
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
} = {}) {
  if (!shopId) throw new AppError("Shop is required", 400);
  if (!validatePlanCode(planCode)) throw new AppError("Invalid plan code", 400);
  await ensurePlansSeeded(tx);

  const now = new Date();
  const current = await tx.subscription.findUnique({ where: { shopId } });
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
    metadata: { providerPaymentId, transactionId, eventId, previousStatus: subscription.status },
  });

  return { subscriptionChanged: true, subscription: normalizeSubscriptionDates(updated) };
}

export async function changePlan(shopId, planCode) {
  if (!validatePlanCode(planCode)) throw new AppError("Invalid plan code", 400);
  await ensurePlansSeeded();
  const now = new Date();
  const current = await db.subscription.findUnique({ where: { shopId } });
  if (!current) {
    const trialEnd = addDays(now, DEFAULT_TRIAL_DAYS);
    return db.subscription.create({
      data: {
        shopId,
        planCode,
        status: "trial",
        provider: "admin",
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        trialEndsAt: trialEnd,
        graceEndsAt: addDays(trialEnd, DEFAULT_GRACE_DAYS),
      },
    });
  }
  return db.subscription.update({
    where: { shopId },
    data: { planCode, updatedAt: now },
  });
}

export async function cancelSubscription(shopId) {
  const subscription = await db.subscription.findUnique({ where: { shopId } });
  if (!subscription) return fallbackSubscription(shopId);
  return db.subscription.update({
    where: { shopId },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
}

export async function extendGrace(shopId, days) {
  const subscription = await db.subscription.findUnique({ where: { shopId } });
  if (!subscription) throw new AppError("Subscription not found", 404);
  const graceBase = subscription.graceEndsAt && subscription.graceEndsAt > new Date()
    ? subscription.graceEndsAt
    : new Date();
  return db.subscription.update({
    where: { shopId },
    data: { status: "grace", graceEndsAt: addDays(graceBase, days) },
  });
}

export function isSubscriptionActive(subscription) {
  if (!subscription) return true;
  const now = new Date();
  if (["cancelled", "expired", "payment_failed"].includes(subscription.status)) return false;
  if (subscription.status === "trial") return !subscription.trialEndsAt || subscription.trialEndsAt > now;
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

function fallbackSubscription(shopId) {
  const now = new Date();
  const trialEndsAt = addDays(now, DEFAULT_TRIAL_DAYS);
  return {
    id: null,
    shopId,
    planCode: "starter",
    status: "trial",
    provider: "manual",
    providerSubscriptionId: null,
    currentPeriodStart: now,
    currentPeriodEnd: trialEndsAt,
    trialEndsAt,
    graceEndsAt: addDays(trialEndsAt, DEFAULT_GRACE_DAYS),
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    active: true,
    source: "fallback/trial",
    plan: serializePlan(getPlanConfig("starter")),
    warning: "No persisted subscription found; using starter trial fallback.",
  };
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

function warningForSubscription(subscription) {
  if (subscription.status === "grace") return "Subscription is in grace period.";
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

async function createSubscriptionAudit(tx, { shopId, userId = null, action, entityId = null, metadata = {} }) {
  if (!shopId || !action || !tx.auditLog) return null;
  try {
    return await tx.auditLog.create({
      data: {
        shopId,
        userId,
        action,
        entityType: "subscription",
        entityId,
        metadataJson: JSON.stringify(metadata),
      },
    });
  } catch {
    return null;
  }
}
