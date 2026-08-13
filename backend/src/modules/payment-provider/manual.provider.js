import { activateManualSubscription } from "../subscription/subscription.service.js";

export async function activateManualPayment(shopId, input) {
  return activateManualSubscription(shopId, input.planCode, input.period, {
    provider: "manual",
    amountPaise: input.amountPaise,
    note: input.note,
    userId: input.userId ?? null,
    deviceId: input.deviceId,
    req: input.req ?? null,
  });
}
