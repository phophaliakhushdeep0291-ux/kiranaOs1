import type { FeatureName } from "@/features/subscription/plans";

export type InnovationStatus = "available" | "architecture_ready" | "backend_required" | "future";

export interface InnovationFeature {
  id: string;
  title: string;
  hindiLabel: string;
  featureName: FeatureName;
  status: InnovationStatus;
  planNote: string;
  entryHref: string;
  summary: string;
  currentFrontend: string[];
  backendRequirements: string[];
  safetyNotes: string[];
}

export const INNOVATION_FEATURES: InnovationFeature[] = [
  {
    id: "voice-billing",
    title: "Hindi/Hinglish voice billing",
    hindiLabel: "बोलकर बिल",
    featureName: "hindi_voice_billing",
    status: "available",
    planNote: "Pro feature with browser speech recognition plus secured OpenAI/Groq transcription fallback.",
    entryHref: "/billing",
    summary: "Shopkeeper says: ‘Ramesh ke naam 2 kilo chini 45 rupay kilo, ek tel packet 120, 500 udhar.’ The parser should convert speech into customer, cart items, rates, payment mode and credit amount.",
    currentFrontend: ["Global and billing microphones capture browser speech first and fall back to recorded cloud transcription when required.", "Every parsed voice bill remains a reviewable local-first draft; voice never confirms a financial action."],
    backendRequirements: ["Configure a supported server-side transcription provider for cloud fallback.", "Monitor provider rate limits and quota.", "Keep the existing manual/offline command path available."],
    safetyNotes: ["Never auto-confirm voice bills without shopkeeper review.", "Low-confidence items must ask for manual selection.", "Billing must still work offline through normal search buttons."],
  },
  {
    id: "whatsapp-reminders",
    title: "WhatsApp udhar reminders",
    hindiLabel: "WhatsApp याद दिलाना",
    featureName: "whatsapp_reminders",
    status: "backend_required",
    planNote: "Pro only. UI is gated; actual sending needs backend/WhatsApp provider.",
    entryHref: "/customers?filter=udhar",
    summary: "One-click udhar reminder with customer statement, reminder logs and editable templates.",
    currentFrontend: ["Customer and udhar pages already show Pro-gated reminder entry points.", "Customer statement and ledger data are available locally."],
    backendRequirements: ["WhatsApp Business API provider integration.", "Template approval and language templates.", "Reminder log endpoint and delivery status webhook."],
    safetyNotes: ["Do not send reminders without customer number and owner action.", "Show delivery failures clearly.", "Respect plan lock below Pro."],
  },
  {
    id: "smart-daily-closing",
    title: "Smart daily closing",
    hindiLabel: "दिन बंद रिपोर्ट",
    featureName: "smart_daily_closing",
    status: "available",
    planNote: "Standard and above for daily summaries; current local report works offline.",
    entryHref: "/daily-closing",
    summary: "Owner gets sales, cash expected, UPI received, udhar given, old udhar recovered and pending sync warning.",
    currentFrontend: ["Daily closing page calculates from local IndexedDB.", "Pending sync warning marks reports as local estimates."],
    backendRequirements: ["Optional cloud-confirmed closing snapshots after sync.", "Owner approval/lock daily closing endpoint if needed."],
    safetyNotes: ["Do not show fake numbers; calculate only from bills/payments/ledger.", "Mark local estimates when unsynced data exists."],
  },
  {
    id: "customer-trust-score",
    title: "Customer trust score",
    hindiLabel: "ग्राहक भरोसा स्कोर",
    featureName: "customer_trust_score",
    status: "available",
    planNote: "Growth and above for advanced udhar intelligence.",
    entryHref: "/customers",
    summary: "Classifies customers as pays on time, delays often, high pending, risky customer or good customer.",
    currentFrontend: ["Customer/udhar module calculates trust score from ledger and ageing.", "Bad customer warning and ageing buckets are already visible."],
    backendRequirements: ["Cloud aggregation for multi-device ledger history.", "Optional scheduled risk recalculation."],
    safetyNotes: ["Trust score should guide owner; never block a customer automatically.", "Show reasons behind the score."],
  },
  {
    id: "smart-price-memory",
    title: "Smart price memory",
    hindiLabel: "पुराना रेट याद",
    featureName: "smart_price_memory",
    status: "architecture_ready",
    planNote: "Growth feature. Uses customer/product sale history after enough data exists.",
    entryHref: "/billing",
    summary: "Suggest last price sold to this customer, wholesale/retail rate and warns below minimum price.",
    currentFrontend: ["Products support min/retail/wholesale/slab/customer-specific pricing fields.", "Billing has minimum price PIN protection and customer selection."],
    backendRequirements: ["Historical price lookup by customer/product.", "Suggestion endpoint or local aggregation over bill_items.", "Reason metadata: last sold date, quantity slab, customer override."],
    safetyNotes: ["Never auto-change price silently.", "Below-minimum selling must require owner PIN."],
  },
  {
    id: "no-barcode-fast-billing",
    title: "No-barcode fast billing",
    hindiLabel: "बिना बारकोड तेज़ बिल",
    featureName: "no_barcode_fast_billing",
    status: "available",
    planNote: "Starter and above. Designed for kirana shops without barcode discipline.",
    entryHref: "/billing",
    summary: "Fast billing through aliases, recent products, favourites, category buttons, short codes and Hindi names.",
    currentFrontend: ["Billing has recent/favorite/category quick buttons and Hindi/English search.", "Product aliases and units support loose/custom billing."],
    backendRequirements: ["Optional cloud product alias learning.", "Optional import/export of short codes."],
    safetyNotes: ["Quick actions must still add real local product/custom item rows.", "Rate and quantity remain editable before confirm."],
  },
  {
    id: "offline-confidence-meter",
    title: "Offline confidence meter",
    hindiLabel: "डेटा सुरक्षित मीटर",
    featureName: "offline_confidence_meter",
    status: "available",
    planNote: "Starter and above. Helps shopkeeper trust offline-first behavior.",
    entryHref: "/sync-status",
    summary: "Shows all data safe locally, pending sync count, last cloud backup, offline grace left and sync failed warning.",
    currentFrontend: ["Sync status page reads local queue/conflicts and subscription sync permission.", "Offline confidence component reads Dexie and subscription grace state."],
    backendRequirements: ["Reliable /sync/status and cloud backup timestamps for confirmed server status."],
    safetyNotes: ["Never hide failed sync.", "Billing must not block while cloud backup is running."],
  },
  {
    id: "recovery-mode",
    title: "Recovery mode",
    hindiLabel: "रिकवरी मोड",
    featureName: "recovery_mode",
    status: "architecture_ready",
    planNote: "Standard and above. Basic checks are local; full backup restore needs backend/snapshot service.",
    entryHref: "/recovery-mode",
    summary: "Restore last unsaved bill, inspect local DB health, retry pending sync operations and prepare local backup restore flow.",
    currentFrontend: ["Billing draft is saved locally and restores on billing page.", "Failed/pending sync operations can be retried from recovery mode."],
    backendRequirements: ["Encrypted local backup snapshots.", "Cloud snapshot list and restore endpoint.", "DB corruption repair/export diagnostics."],
    safetyNotes: ["Recovery must never delete financial records automatically.", "Show clear owner warning before any destructive repair."],
  },
];
