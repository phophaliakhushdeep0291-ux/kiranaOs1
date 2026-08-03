import type { FeatureName } from "@/features/core/subscription/plans";

export interface InnovationFeature {
  id: string;
  title: string;
  hindiLabel: string;
  featureName: FeatureName;
  planNote: string;
  entryHref: string;
  summary: string;
}

// Customer-facing Smart Tools lists only workflows that have a real entry
// point and working data path. Product roadmap or architecture placeholders do
// not belong in runtime navigation.
export const INNOVATION_FEATURES: InnovationFeature[] = [
  {
    id: "voice-billing",
    title: "Hindi/Hinglish voice billing",
    hindiLabel: "Bolkar bill",
    featureName: "hindi_voice_billing",
    planNote: "Browser speech works first; secured OpenAI/Groq transcription is the online fallback.",
    entryHref: "/billing",
    summary: "Speak a billing command, review the parsed customer, items, rates, and payment, then confirm through the normal protected bill flow.",
  },
  {
    id: "whatsapp-reminders",
    title: "WhatsApp udhar reminders",
    hindiLabel: "Udhar yaad dilana",
    featureName: "whatsapp_reminders",
    planNote: "Uses live provider, Redis queue, worker health, templates, and delivery logs.",
    entryHref: "/settings/notifications",
    summary: "Send a customer reminder from their ledger and see whether it was queued, accepted, skipped, or failed.",
  },
  {
    id: "smart-daily-closing",
    title: "Smart daily closing",
    hindiLabel: "Din band report",
    featureName: "smart_daily_closing",
    planNote: "Works offline and labels estimates when device changes are still pending sync.",
    entryHref: "/daily-closing",
    summary: "Review sales, expected cash, UPI, udhar, collections, and the exact sync state before closing the counter.",
  },
  {
    id: "customer-trust-score",
    title: "Customer trust score",
    hindiLabel: "Grahak bharosa score",
    featureName: "customer_trust_score",
    planNote: "Calculated from the real customer ledger, ageing, and payment behaviour.",
    entryHref: "/customers",
    summary: "See ageing buckets and risk guidance with the underlying ledger still available for owner judgement.",
  },
  {
    id: "no-barcode-fast-billing",
    title: "No-barcode fast billing",
    hindiLabel: "Bina barcode tez bill",
    featureName: "no_barcode_fast_billing",
    planNote: "Uses products, aliases, categories, favourites, recent items, units, and pricing rules.",
    entryHref: "/billing",
    summary: "Find and add real catalogue items quickly even when the store does not maintain barcodes.",
  },
  {
    id: "offline-confidence-meter",
    title: "Offline confidence meter",
    hindiLabel: "Data safety meter",
    featureName: "offline_confidence_meter",
    planNote: "Reads the actual local queue, conflicts, connectivity, and subscription grace state.",
    entryHref: "/sync-status",
    summary: "Know what is safe locally, what is pending, and what needs owner attention without blocking offline billing.",
  },
  {
    id: "recovery-mode",
    title: "Recovery mode",
    hindiLabel: "Surakshit recovery",
    featureName: "recovery_mode",
    planNote: "Combines draft recovery, IndexedDB health checks, sync retry, and encrypted backup history.",
    entryHref: "/recovery-mode",
    summary: "Recover unfinished work and inspect real data-health evidence without destructive automatic repair.",
  },
];
