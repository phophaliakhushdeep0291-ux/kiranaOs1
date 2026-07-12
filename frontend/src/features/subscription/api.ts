import { apiRequest } from "@/lib/api/http";
import type { PlanCode, SubscriptionState } from "@/features/subscription/plans";

export type BillingCycle = "monthly" | "yearly";

export interface SubscriptionPlanDto {
  id?: string;
  code: PlanCode | string;
  name: string;
  priceMonthlyPaise?: number;
  priceYearlyPaise?: number;
  maxDevices?: number;
  maxStores?: number;
  maxStaff?: number;
  features?: string[];
  isActive?: boolean;
}

export interface SubscriptionStatusDto {
  id?: string | null;
  shopId?: string;
  planCode: PlanCode | string;
  status: SubscriptionState | string;
  active?: boolean;
  source?: string;
  provider?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  graceEndsAt?: string | null;
  offlineGraceEndsAt?: string | null;
  syncAllowed?: boolean;
  paymentFailed?: boolean;
  features?: string[] | Record<string, boolean>;
  plan?: SubscriptionPlanDto;
  warning?: string | null;
}

export interface UpgradeRequestDto {
  planCode: PlanCode;
  billingCycle?: BillingCycle;
  provider?: "razorpay";
}

export interface SubscriptionCheckoutDto {
  provider: "razorpay";
  razorpayKeyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  planCode: PlanCode | string;
  billingCycle: BillingCycle;
  transactionId: string;
}

export interface VerifySubscriptionPaymentDto {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  transactionId: string;
}

export interface VerifySubscriptionPaymentResultDto {
  activated?: boolean;
  action?: string;
  subscription?: SubscriptionStatusDto;
  transaction?: Record<string, unknown>;
  idempotent?: boolean;
}

export function getSubscriptionStatus() {
  return apiRequest<SubscriptionStatusDto>("/subscription/current", {
    method: "GET",
    cache: "no-store",
    background: true,
  });
}

export function listSubscriptionPlans() {
  return apiRequest<SubscriptionPlanDto[]>("/subscription/plans", {
    method: "GET",
    cache: "no-store",
    skipAuth: true,
    skipDevice: true,
    background: true,
  });
}

export function requestSubscriptionUpgrade(data: UpgradeRequestDto) {
  return apiRequest<SubscriptionCheckoutDto>("/subscription/checkout", {
    method: "POST",
    body: JSON.stringify({
      billingCycle: "monthly",
      provider: "razorpay",
      ...data,
    }),
  });
}

export function verifySubscriptionPayment(data: VerifySubscriptionPaymentDto) {
  return apiRequest<VerifySubscriptionPaymentResultDto>("/subscription/verify-payment", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Cancel the active subscription. Backend requires owner role + owner PIN
 * (sent in the body). Returns the updated subscription row (status "cancelled").
 */
export function cancelSubscription(ownerPin?: string) {
  return apiRequest<SubscriptionStatusDto>("/subscription/cancel", {
    method: "POST",
    body: JSON.stringify(ownerPin ? { ownerPin } : {}),
  });
}
