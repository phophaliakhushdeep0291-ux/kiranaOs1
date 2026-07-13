import { retryWebhookDelivery } from "../modules/integrations/integrations.service.js";
import { JOB_NAMES } from "./queueNames.js";

export async function handleWebhookJob(job) {
  if (job.name !== JOB_NAMES.DELIVER_WEBHOOK) {
    const error = new Error(`Unknown webhook job: ${job.name}`);
    error.code = "UNKNOWN_WEBHOOK_JOB";
    throw error;
  }
  const { shopId, deliveryId } = job.data || {};
  if (!shopId || !deliveryId) {
    const error = new Error("shopId and deliveryId are required for webhook jobs");
    error.code = "INVALID_WEBHOOK_JOB_PAYLOAD";
    throw error;
  }
  const delivery = await retryWebhookDelivery(shopId, deliveryId);
  if (delivery.status !== "delivered") {
    const error = new Error(delivery.lastError || "Webhook delivery failed");
    error.code = "WEBHOOK_DELIVERY_FAILED";
    throw error;
  }
  return { deliveryId: delivery.id, status: delivery.status, attemptCount: delivery.attemptCount };
}
