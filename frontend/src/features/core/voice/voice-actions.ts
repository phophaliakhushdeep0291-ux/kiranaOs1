import { offlineDB } from "@/lib/offline/db";
import { parseCustomerDraft, parseInventoryDraft, parsePaymentDraft, parseProductDraft } from "./voice-command-parser";
import { recordVoiceCommandAudit } from "./voice-audit";
import type { PaymentDraft, VoiceIntent, VoiceSearchIntent, VoiceToastPayload } from "./voice-types";

export function dispatchAfterNavigation(eventName: string, detail: unknown) {
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }, 350);
}

type ExecuteVoiceActionInput = {
  spoken: string;
  intent: VoiceIntent;
  currentLocation: string;
  setLocation: (route: string) => void;
  setStatus: (message: string) => void;
  toast: (payload: VoiceToastPayload) => void;
};

type VoiceSummary = {
  billCount: number;
  revenue: number;
  pendingSync: number;
  failedSync: number;
  udharBalance: number;
};

/**
 * Deliberately NOT lib/money's formatMoney: this text gets read aloud, and
 * "one thousand two hundred thirty four rupees fifty paise" is worse to listen
 * to than the rounded figure. Whole rupees only, built once rather than per call.
 */
const SPOKEN_RUPEE_FORMAT = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function formatSpokenMoney(amount: number) {
  return SPOKEN_RUPEE_FORMAT.format(amount);
}

function readNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function isToday(value: unknown) {
  if (!value) return false;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

async function loadVoiceSummary(): Promise<VoiceSummary> {
  const [bills, ledger, outbox] = await Promise.all([
    offlineDB.getAll<Record<string, unknown>>("bills").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("customer_ledger").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("sync_outbox").catch(() => []),
  ]);
  const todaysBills = bills.filter((bill) => {
    const status = String(bill.status ?? bill.bill_status ?? "").toLowerCase();
    const type = String(bill.type ?? bill.bill_type ?? "").toLowerCase();
    const rough = Boolean(bill.is_rough_estimate ?? bill.isRoughEstimate);
    return isToday(bill.created_at ?? bill.createdAt ?? bill.bill_date) && status !== "cancelled" && type !== "estimate" && !rough;
  });
  const revenue = todaysBills.reduce((sum, bill) => sum + readNumber(bill.total ?? bill.total_amount ?? bill.grand_total), 0);
  const udharBalance = ledger.reduce((sum, entry) => {
    const amount = readNumber(entry.signed_amount ?? entry.amount);
    return sum + amount;
  }, 0);
  const pendingSync = outbox.filter((row) => ["PENDING", "SYNCING"].includes(String(row.status ?? "PENDING"))).length;
  const failedSync = outbox.filter((row) => String(row.status ?? "").toUpperCase() === "FAILED").length;
  return { billCount: todaysBills.length, revenue, pendingSync, failedSync, udharBalance };
}

async function buildDashboardSummaryMessage() {
  const summary = await loadVoiceSummary();
  return `Today: ${summary.billCount} bills, ${formatSpokenMoney(summary.revenue)} sales, ${formatSpokenMoney(summary.udharBalance)} net udhar ledger impact, ${summary.pendingSync} pending sync${summary.failedSync ? `, ${summary.failedSync} failed sync` : ""}.`;
}

async function buildPendingSyncMessage() {
  const outbox = await offlineDB.getAll<Record<string, unknown>>("sync_outbox").catch(() => []);
  const pending = outbox.filter((row) => ["PENDING", "SYNCING"].includes(String(row.status ?? "PENDING"))).length;
  const failed = outbox.filter((row) => String(row.status ?? "").toUpperCase() === "FAILED").length;
  return failed ? `${pending} sync operations are pending and ${failed} failed operations need retry.` : `${pending} sync operations are pending.`;
}

function routeForSearch(search: VoiceSearchIntent) {
  if (search.target === "customer") return "/customers";
  if (search.target === "bill") return "/bills";
  if (search.target === "udhar") return "/udhar";
  if (search.target === "global") return "/dashboard";
  return "/products";
}

function eventForSearch(search: VoiceSearchIntent) {
  if (search.target === "customer") return "kirana:voice-customer-search";
  if (search.target === "bill") return "kirana:voice-bill-search";
  if (search.target === "udhar") return "kirana:voice-udhar-search";
  return "kirana:voice-product-search";
}

async function performVoiceAction({ spoken, intent, currentLocation, setLocation, setStatus, toast }: ExecuteVoiceActionInput) {
  const message = intent.message ?? "Command processed.";

  if (intent.action === "navigate" && intent.route) {
    setLocation(intent.route);
    setStatus(message);
    toast({ title: "Voice assistant", description: message });
    return true;
  }

  if (intent.action === "dashboard_summary") {
    setLocation("/dashboard");
    const summary = await buildDashboardSummaryMessage();
    setStatus(summary);
    toast({ title: "Dashboard summary", description: summary });
    return true;
  }

  if (intent.action === "sync_count") {
    const summary = await buildPendingSyncMessage();
    setStatus(summary);
    toast({ title: "Sync status", description: summary });
    return true;
  }

  if (intent.action === "search" && intent.search) {
    const route = intent.route ?? routeForSearch(intent.search);
    setLocation(route);
    dispatchAfterNavigation(eventForSearch(intent.search), { query: intent.search.query, target: intent.search.target, sourceCommand: spoken });
    setStatus(`Searching ${intent.search.target} for “${intent.search.query}”.`);
    toast({ title: "Voice search", description: `Searching ${intent.search.target} for “${intent.search.query}”.` });
    return true;
  }

  if (intent.action === "billing_command") {
    setLocation("/billing");
    dispatchAfterNavigation("kirana:voice-billing-command", { command: intent.billingCommand ?? spoken, requiresConfirmation: true });
    setStatus("Sent to billing. Review the draft before adding to cart.");
    toast({ title: "Voice assistant", description: "Billing command sent for review." });
    return true;
  }

  if (intent.action === "product_draft") {
    const isProductsRoute = currentLocation.startsWith("/products");
    setLocation("/products");
    dispatchAfterNavigation("kirana:voice-product-draft", { draft: intent.product ?? parseProductDraft(spoken), sourceCommand: spoken, merge: isProductsRoute });
    setStatus(isProductsRoute ? "Product form fields updated by voice. Keep speaking fields or save locally." : "Product form prepared. Review and save locally.");
    toast({ title: "Voice assistant", description: isProductsRoute ? "Product form updated from voice." : "Product form prepared. Review before saving." });
    return true;
  }

  if (intent.action === "customer_draft") {
    const isCustomersRoute = currentLocation.startsWith("/customers");
    setLocation("/customers");
    dispatchAfterNavigation("kirana:voice-customer-draft", { draft: intent.customer ?? parseCustomerDraft(spoken), sourceCommand: spoken, merge: isCustomersRoute });
    setStatus(isCustomersRoute ? "Customer form fields updated by voice. Review before saving." : "Customer form prepared. Review and save locally.");
    toast({ title: "Voice assistant", description: isCustomersRoute ? "Customer form updated from voice." : "Customer form prepared. Review before saving." });
    return true;
  }

  if (intent.action === "inventory_draft") {
    setLocation("/inventory");
    dispatchAfterNavigation("kirana:voice-inventory-draft", { draft: intent.inventory ?? parseInventoryDraft(spoken), sourceCommand: spoken, requiresConfirmation: true, requiresOwnerPin: Boolean(intent.requiresOwnerPin) });
    const suffix = intent.requiresOwnerPin ? " Owner PIN will be required for correction when saving." : "";
    setStatus(`Inventory entry prepared. Review and save locally.${suffix}`);
    toast({ title: "Voice assistant", description: `Inventory entry prepared. Review before saving.${suffix}` });
    return true;
  }

  if (intent.action === "payment_draft") {
    const draft: PaymentDraft = intent.payment ?? parsePaymentDraft(spoken);
    setLocation("/udhar");
    dispatchAfterNavigation("kirana:voice-payment-draft", { draft, sourceCommand: spoken, requiresConfirmation: true });
    setStatus("Payment form prepared. Review customer, amount, and mode before saving.");
    toast({ title: "Voice assistant", description: "Payment form prepared. Review before saving." });
    return true;
  }

  setStatus(message);
  toast({ title: "Voice assistant", description: message });
  return false;
}

export async function executeVoiceAction(input: ExecuteVoiceActionInput) {
  try {
    const didRun = await performVoiceAction(input);
    await recordVoiceCommandAudit({
      commandText: input.spoken,
      intent: input.intent,
      actionResult: didRun ? "success" : "failed",
      resultMessage: input.intent.message ?? (didRun ? "Command processed." : "Command not recognized."),
      userConfirmed: false,
      pinConfirmed: false,
    });
    return didRun;
  } catch (error) {
    await recordVoiceCommandAudit({
      commandText: input.spoken,
      intent: input.intent,
      actionResult: "failed",
      resultMessage: "Voice command failed.",
      userConfirmed: false,
      pinConfirmed: false,
      error,
    });
    throw error;
  }
}
