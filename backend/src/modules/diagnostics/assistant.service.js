import { detectFocus, generateIncidentReport } from "./incident-report.service.js";

// AI Support Assistant (Diagnostics §5). Answers natural-language problems
// ("why is my stock negative?", "my bills aren't syncing") by READING the shop's
// real diagnostics (errors, sync, device health, audit) rather than giving generic
// tips. High confidence => explain + fix; low confidence => escalate with a full
// incident report. An LLM narrative is used when configured; otherwise the answer
// is composed deterministically from the diagnostics + a grounded knowledge base.

const KNOWLEDGE_BASE = {
  printer: {
    title: "Printer / receipt problems",
    steps: [
      "Check the printer is powered on and its cable or Bluetooth is connected.",
      "If you use the Artha hardware bridge, confirm it is running on this device (Settings → Printer → Test).",
      "Print a test receipt from Settings → Printer. Browser printing always works as a fallback.",
    ],
  },
  sync: {
    title: "Bills or changes not syncing",
    steps: [
      "Check this device is online — local billing keeps working offline, but backup pauses.",
      "Open Sync Status to see exactly what is pending or failed, with the reason.",
      "Use Retry on Sync Status; conflicts need you to pick which version to keep.",
    ],
  },
  inventory: {
    title: "Stock looks wrong or negative",
    steps: [
      "Negative stock usually means items were sold or returned on another device before this one synced.",
      "Open Sync Status first — a failed inventory sync is the most common cause.",
      "Then adjust the stock (Inventory → Adjustments) to the correct physical count.",
    ],
  },
  billing: {
    title: "A bill is missing or wrong",
    steps: [
      "Check Billing History and the Recycle Bin — cancelled/edited bills move there, they are not deleted.",
      "If it was made on another device, it appears here once that device syncs.",
      "Open Sync Status to confirm nothing is stuck pending backup.",
    ],
  },
  reporting: {
    title: "Dashboard or report numbers look off",
    steps: [
      "Pending or failed syncs from other devices can make totals look low until they back up — check Sync Status.",
      "Confirm the date range and that you are viewing the right store location.",
      "Refresh the page to pull the latest figures from the cloud.",
    ],
  },
  performance: {
    title: "App is slow, stuck, or crashing",
    steps: [
      "Reload the screen. Your local data is safe.",
      "If the device is low on storage, free some space — it can block saving and syncing.",
      "If it persists, sign out and back in to rebuild local storage, then Report a problem.",
    ],
  },
  general: {
    title: "General help",
    steps: [
      "Reload the affected screen — local data stays safe.",
      "If it continues, use Report a problem so the details reach a developer.",
    ],
  },
};

/**
 * answerSupportQuestion — grounded troubleshooting answer for a user's question.
 * Reads the shop's real diagnostics and returns { answer, steps, confidence,
 * resolved, escalate, incidentReport? }.
 */
export async function answerSupportQuestion({ shopId, deviceId = null, question, useAi = true } = {}) {
  const focus = detectFocus(question);
  const report = await generateIncidentReport({ shopId, deviceId, problemSummary: question, useAi });
  const kb = KNOWLEDGE_BASE[focus] ?? KNOWLEDGE_BASE.general;

  const confident = report.confidenceScore >= 0.6;

  let answer;
  if (report.aiNarrative) {
    answer = report.aiNarrative;
  } else if (confident) {
    answer = `${report.possibleRootCause}\n\n${report.suggestedSolution}`;
  } else {
    answer = `I couldn't pinpoint a single cause from your shop's diagnostics yet. Here's the most relevant guidance, and I've prepared a full report you can send to support.\n\n${report.possibleRootCause}`;
  }

  return {
    focus,
    topic: kb.title,
    answer,
    steps: kb.steps,
    confidence: report.confidenceScore,
    confidenceLabel: report.confidenceLabel,
    resolved: confident,
    escalate: !confident,
    // Attach the full developer-readable report only when we are NOT confident, so
    // the user can escalate it (§6). When confident we keep the response light.
    incidentReport: confident ? null : report,
    aiProvider: report.aiProvider,
    generatedAt: report.generatedAt,
  };
}
