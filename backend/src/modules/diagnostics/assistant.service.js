import { detectFocus, generateIncidentReport } from "./incident-report.service.js";
import { getUdharSummary } from "../udhar/udhar.service.js";
import { getSalesSummary } from "../reports/reports.service.js";

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

// ── Intent classification ─────────────────────────────────────────────────────
// One assistant, three intents (§5 troubleshoot, §8 how-to, §9 data). Problem
// words win first (a "why is inventory negative?" is a diagnosis, not a how-to).
const PROBLEM_WORDS = /not working|isn'?t working|does ?n'?t work|error|failed|failing|broken|stuck|frozen|freeze|crash|wrong|incorrect|negative|lost|missing|can'?t|cannot|won'?t|slow|not syncing|not saving/i;
const DATA_WORDS = /how much|profit|sales|revenue|turnover|\bowe[sd]?\b|owing|outstanding|udhar|receivable|summary|summaris|summariz|today|this month|this week|\btotal\b|export|download|which product|not selling|dead stock/i;
const HOWTO_WORDS = /how do i|how to|how can i|where is|where do i|steps to|guide|tutorial|set up|enable/i;

export function classifyIntent(question = "") {
  const q = String(question);
  if (PROBLEM_WORDS.test(q)) return "troubleshoot";
  if (HOWTO_WORDS.test(q) && !DATA_WORDS.test(q)) return "howto";
  if (DATA_WORDS.test(q)) return "data";
  if (HOWTO_WORDS.test(q)) return "howto";
  return "troubleshoot";
}

// ── Help center (§8): curated how-to articles ─────────────────────────────────
const HELP_ARTICLES = [
  { id: "gst-bill", title: "Create a GST bill", keywords: ["gst", "tax invoice", "gst bill", "tax bill"], steps: ["Open Billing.", "Add products — GST is applied from each product's tax rate.", "Select the customer (a GST invoice needs their details).", "Complete payment; the receipt shows the GST breakup."] },
  { id: "restore-product", title: "Restore a deleted product", keywords: ["restore", "deleted product", "recover product", "undo delete", "recycle bin"], steps: ["Open Recycle Bin from the menu.", "Find the product under deleted items.", "Click Restore — it returns with its details and stock."] },
  { id: "add-product", title: "Add a product", keywords: ["add product", "new product", "create product"], steps: ["Open Products → Add Product.", "Enter name, price, and unit; add stock, MRP, or barcode as needed.", "Save — it's immediately available in Billing."] },
  { id: "record-udhar-payment", title: "Record an udhar (credit) payment", keywords: ["udhar payment", "record payment", "customer paid", "credit payment", "collect udhar"], steps: ["Open Customers and select the customer.", "Use Record Payment.", "Enter the amount and mode — their outstanding balance updates."] },
  { id: "daily-closing", title: "Close the day (daily closing)", keywords: ["daily closing", "close the day", "end of day", "cash drawer", "day close"], steps: ["Open Daily Closing.", "Review sales, cash, UPI, and expected cash in the drawer.", "Enter the counted cash and save the closing."] },
  { id: "add-discount", title: "Give a discount on a bill", keywords: ["discount", "reduce price", "offer on bill"], steps: ["In Billing, use the discount field on the bill or a line item.", "Enter a flat amount or a percentage — the total updates instantly."] },
];

function scoreArticle(article, q) {
  return article.keywords.reduce((score, keyword) => score + (q.includes(keyword) ? keyword.split(" ").length : 0), 0);
}

function answerHowTo(question) {
  const q = String(question).toLowerCase();
  const best = HELP_ARTICLES.map((article) => ({ article, score: scoreArticle(article, q) })).sort((a, b) => b.score - a.score)[0];
  if (!best || best.score === 0) {
    return { topic: "Help", answer: "I couldn't find a specific how-to for that. Try rephrasing, or open the relevant screen — most actions have inline hints.", steps: [], article: null, confidence: 0.3, confidenceLabel: "low", resolved: false, escalate: false, incidentReport: null, aiProvider: null };
  }
  return { topic: best.article.title, answer: `Here's how to ${best.article.title.toLowerCase()}:`, steps: best.article.steps, article: best.article.id, confidence: 0.85, confidenceLabel: "high", resolved: true, escalate: false, incidentReport: null, aiProvider: null };
}

// ── Data assistant (§9): reuse the already-correct business services ──────────
function formatRupees(amount) {
  return `₹${(Number(amount) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatPaise(paise) {
  return formatRupees((Number(paise) || 0) / 100);
}
function detectRange(q) {
  if (/month/i.test(q)) return "month";
  if (/week/i.test(q)) return "week";
  if (/year/i.test(q)) return "year";
  return "today";
}
function dataResult(kind, answer, steps, data) {
  return { topic: "Business data", kind, answer, steps, data, confidence: 0.9, confidenceLabel: "high", resolved: true, escalate: false, incidentReport: null, aiProvider: null };
}

async function answerData({ shopId, question }) {
  const q = String(question).toLowerCase();

  if (/\bowe[sd]?\b|owing|outstanding|udhar|receivable|who.*(owe|pay|due)|money.*due/.test(q)) {
    const summary = await getUdharSummary(shopId);
    const steps = summary.customers.slice(0, 5).map((c) => `${c.name || "Customer"} — ${formatRupees(c.udharAmount)}`);
    const answer = summary.customers.length
      ? `${summary.customers.length} customer(s) owe you a total of ${formatRupees(summary.totalOutstanding)}.`
      : "No customer currently owes you money — all udhar is cleared.";
    return dataResult("outstanding_udhar", answer, steps, { totalOutstanding: summary.totalOutstanding, customerCount: summary.customers.length });
  }

  if (/profit|margin|earn|sales|revenue|turnover|summar|how much.*(sell|sales|made|earn)|business/.test(q)) {
    const range = detectRange(q);
    const r = await getSalesSummary(shopId, { range, includeProfit: true });
    const steps = [`Sales: ${formatPaise(r.totalSalesPaise)} across ${r.totalBills} bill(s)`, `Cash ${formatPaise(r.cashSalesPaise)} · UPI ${formatPaise(r.upiSalesPaise)} · Bank ${formatPaise(r.bankSalesPaise)} · Udhar ${formatPaise(r.udharSalesPaise)}`];
    if (typeof r.grossProfitPaise === "number") steps.unshift(`Estimated gross profit: ${formatPaise(r.grossProfitPaise)}`);
    return dataResult("sales_summary", `Here's your ${r.range} summary.`, steps, { range: r.range, totalSalesPaise: r.totalSalesPaise, grossProfitPaise: r.grossProfitPaise ?? null, totalBills: r.totalBills });
  }

  if (/not selling|slow.?moving|dead stock|worst.*(product|selling)/.test(q)) {
    return dataResult("not_selling", "To find products that aren't selling, open Reports → Inventory Health — it lists slow-moving and dead stock for the period.", [], {});
  }

  if (/export|download|pdf|excel|spreadsheet/.test(q)) {
    return dataResult("export", "You can export GST, sales, udhar, and bill reports as PDF or Excel from the Reports page — open Reports and use Export on the report you need.", [], {});
  }

  return dataResult("data_help", "I can show your outstanding udhar, today's or this month's sales and profit, and point you to detailed reports. Try: \"who owes me money\", \"today's profit\", or \"this month's sales\".", [], {});
}

/**
 * answerAssistant — the single AI assistant entry point (§5 + §8 + §9). Classifies
 * the question and routes to troubleshooting, a how-to article, or business data.
 */
export async function answerAssistant({ shopId, deviceId = null, question, useAi = true } = {}) {
  const intent = classifyIntent(question);
  if (intent === "howto") return { intent, focus: "howto", ...answerHowTo(question) };
  if (intent === "data") {
    try {
      return { intent, focus: "data", ...(await answerData({ shopId, question })) };
    } catch {
      return { intent, focus: "data", ...dataResult("data_error", "I couldn't pull that figure just now. Open Reports for the full breakdown, or try again in a moment.", [], {}) };
    }
  }
  return { intent: "troubleshoot", ...(await answerSupportQuestion({ shopId, deviceId, question, useAi })) };
}
