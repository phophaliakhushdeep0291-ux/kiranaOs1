import { apiRequest } from "@/lib/api/http";
import { buildWhatsappMessageUrl, buildWhatsappShareUrl, type BillShareInput } from "./share";

export type BillWhatsappState = "not_sent" | "opened_share_sheet" | "sent_via_api" | "failed";
export interface BillWhatsappIntent { billId: string; idempotencyKey: string; input: BillShareInput; showGst: boolean; showPreviousUdhar: boolean }
const QUEUE_KEY = "kirana:bill-whatsapp-intents:v1";

function load(): BillWhatsappIntent[] {
  try { const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function save(value: BillWhatsappIntent[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(value)); }
export function queuedBillWhatsappIntents() { return load(); }

export async function deliverBillWhatsapp(intent: BillWhatsappIntent): Promise<{ state: BillWhatsappState; queued?: boolean }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const pending = load();
    if (!pending.some((item) => item.idempotencyKey === intent.idempotencyKey)) save([...pending, intent]);
    return { state: "not_sent", queued: true };
  }
  const response = await apiRequest<{ data: { path: "api" | "deep_link"; state: BillWhatsappState; message?: string } }>(`/bills/${encodeURIComponent(intent.billId)}/whatsapp`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: intent.idempotencyKey, customerMobile: intent.input.customerMobile, showGst: intent.showGst, showPreviousUdhar: intent.showPreviousUdhar, mode: "auto" }),
  });
  if (response.data.path === "api") return { state: response.data.state };
  const popup = window.open(response.data.message ? buildWhatsappMessageUrl(intent.input.customerMobile, response.data.message) : buildWhatsappShareUrl(intent.input), "_blank", "noopener,noreferrer");
  if (!popup) return { state: "not_sent" };
  await apiRequest(`/bills/${encodeURIComponent(intent.billId)}/whatsapp`, { method: "POST", body: JSON.stringify({ idempotencyKey: intent.idempotencyKey, showGst: intent.showGst, showPreviousUdhar: intent.showPreviousUdhar, mode: "deep_link_opened" }) });
  return { state: "opened_share_sheet" };
}

export async function flushBillWhatsappQueue(sender = deliverBillWhatsapp) {
  for (const intent of load()) {
    try {
      const result = await sender(intent);
      if (!result.queued) save(load().filter((item) => item.idempotencyKey !== intent.idempotencyKey));
    } catch { /* retain for the next reconnect */ }
  }
}
if (typeof window !== "undefined") window.addEventListener("online", () => { void flushBillWhatsappQueue(); });
