import OpenAI from "openai";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { getSyncDiagnostics } from "../sync/sync-diagnostics.service.js";
import { getLatestHealthForDevice, listLatestHealthPerDevice } from "../devices/deviceHealth.service.js";

// AI Incident Report (Diagnostics §6). Composes everything from Phases 1-4
// (recent errors, sync diagnostics, device health, audit trail, DB status) into a
// developer-readable report with a deterministic probable-root-cause + confidence.
// An optional LLM narrative is layered on top when a Groq/OpenAI key is present —
// but the report is ALWAYS produced without one (graceful degradation).

// ── Optional LLM provider (absence of a key is NOT an error here) ──────────────
function getReportProvider() {
  try {
    if (env.GROQ_API_KEY) {
      return { client: new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" }), model: env.GROQ_MODEL || "llama3-8b-8192", provider: "groq" };
    }
    if (env.OPENAI_API_KEY) {
      return { client: new OpenAI({ apiKey: env.OPENAI_API_KEY }), model: env.OPENAI_MODEL || "gpt-4o-mini", provider: "openai" };
    }
  } catch {
    /* treat as "no provider" */
  }
  return null;
}

// ── Focus detection from the user's own words ─────────────────────────────────
const FOCUS_RULES = [
  [/print|printer|receipt|kot/i, "printer"],
  [/sync|backup|upload|not saving|cloud/i, "sync"],
  [/stock|inventory|quantity|negative|out of stock/i, "inventory"],
  [/bill|invoice|lost|cancel|estimate/i, "billing"],
  [/dashboard|report|number|total|profit|sales figure/i, "reporting"],
  [/slow|crash|freeze|hang|stuck|not loading/i, "performance"],
];

export function detectFocus(text = "") {
  for (const [pattern, focus] of FOCUS_RULES) if (pattern.test(text)) return focus;
  return "general";
}

function safeReasons(health) {
  try {
    return JSON.parse(health?.extraJson || "{}")?.reasons ?? [];
  } catch {
    return [];
  }
}

// ── Deterministic root-cause analysis ─────────────────────────────────────────
// Pure so it can be unit-tested. Builds weighted candidates from the signals,
// boosts the one that matches what the user described, and derives a confidence.
export function analyzeIncident({ errorGroups = [], sync = null, deviceHealth = null } = {}, problemSummary = "", focus = detectFocus(problemSummary)) {
  const candidates = [];
  const push = (category, score, cause, solution) => candidates.push({ category, score, cause, solution });

  if (deviceHealth) {
    const reasons = safeReasons(deviceHealth);
    if (reasons.includes("storage_critical") || reasons.includes("storage_low")) {
      push("inventory", 70, "The device is very low on storage, which can block saving bills and syncing.", "Free up space on the device (clear other apps' caches or photos), then reopen Artha.");
    }
    if (reasons.includes("db_error") || deviceHealth.dbStatus === "error") {
      push("performance", 82, "The app's local database on this device is unhealthy.", "Restart the app. If it persists, sign out and back in to rebuild local storage — data already backed up stays safe.");
    }
    if (reasons.includes("printer_offline") || reasons.includes("printer_error") || deviceHealth.printerStatus === "offline" || deviceHealth.printerStatus === "error") {
      push("printer", 85, "The printer / local hardware bridge is not responding.", "Check the printer power and cable, and confirm the Artha hardware bridge is running on this device, then print a test receipt.");
    }
    if (reasons.includes("offline") || deviceHealth.online === false) {
      push("sync", 60, "The device is offline, so cloud backup is paused (local billing still works).", "Reconnect to the internet; pending changes back up automatically.");
    }
  }

  if (sync?.recentFailures?.length) {
    const top = sync.recentFailures[0];
    const score = 55 + Math.min(20, (sync.counts?.failed ?? 1) * 3);
    push("sync", score, `Some changes could not sync. ${top.explanation}`, top.retryable ? "These retry automatically when the connection is healthy; if they persist, open Sync Status and use Retry." : "Fix the cause shown in Sync Status (for example, recreate a deleted product), then the change will sync.");
  } else if (sync?.counts?.openConflicts) {
    push("sync", 62, `${sync.counts.openConflicts} change(s) conflict with edits made on another device.`, "Open Sync Status → review the conflicts and choose which version to keep.");
  }

  const recurringError = errorGroups.find((g) => g.status === "open" && (g.count ?? 0) >= 3);
  if (recurringError) {
    push("performance", 45 + Math.min(30, recurringError.count), `A recurring app error is happening: "${recurringError.title}".`, "This is recorded for the developers. Reload the screen; if it keeps happening, use Report a problem so the details reach us.");
  }

  if (!candidates.length) {
    return {
      probableRootCause: "No single dominant cause was found in the recent diagnostics. The most recent errors, sync events, and device health are included below for review.",
      suggestedSolution: "Try reloading the affected screen. If the problem continues, use Report a problem so a developer can review the attached diagnostics.",
      confidence: 0.2,
      confidenceLabel: "low",
      signals: [],
    };
  }

  const boosted = candidates
    .map((c) => ({ ...c, score: c.category === focus ? c.score + 25 : c.score }))
    .sort((a, b) => b.score - a.score);
  const best = boosted[0];
  const confidence = Math.max(0, Math.min(1, best.score / 100));
  const confidenceLabel = confidence >= 0.7 ? "high" : confidence >= 0.45 ? "medium" : "low";

  return {
    probableRootCause: best.cause,
    suggestedSolution: best.solution,
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel,
    signals: boosted.map((c) => ({ category: c.category, cause: c.cause, score: c.score })),
  };
}

async function checkDb() {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function latestShopHealth(shopId) {
  const rows = await listLatestHealthPerDevice({ shopId }).catch(() => []);
  return rows[0] ?? null;
}

async function gatherIncidentContext({ shopId, deviceId }) {
  const [errorGroups, sync, deviceHealth, auditRows, dbOk] = await Promise.all([
    db.errorGroup.findMany({
      where: { shopId },
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
      take: 8,
      select: { title: true, source: true, count: true, errorCode: true, status: true, lastSeenAt: true, sampleMessage: true },
    }),
    getSyncDiagnostics(shopId).catch(() => null),
    deviceId ? getLatestHealthForDevice({ shopId, deviceId }).catch(() => null) : latestShopHealth(shopId),
    db.auditLog.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 15, select: { action: true, entityType: true, entityId: true, createdAt: true } }),
    checkDb(),
  ]);
  return { errorGroups, sync, deviceHealth, auditRows, dbOk };
}

function deviceInfo(h) {
  return {
    overallStatus: h.overallStatus,
    healthScore: h.healthScore,
    printer: h.printerStatus,
    storageUsedMb: h.storageUsedMb,
    storageQuotaMb: h.storageQuotaMb,
    batteryLevel: h.batteryLevel,
    ramUsedMb: h.ramUsedMb,
    ramLimitMb: h.ramLimitMb,
    appVersion: h.appVersion,
    os: h.os,
    browser: h.browser,
    reportedAt: h.createdAt,
  };
}

function parseConfidence(text) {
  const match = /confidence:\s*([0-9]*\.?[0-9]+)/i.exec(text || "");
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value > 1 ? value / 100 : value)) : null;
}

function sanitizeForModel(report) {
  return {
    problemSummary: report.problemSummary,
    focus: report.focus,
    recentUserActions: (report.recentUserActions || []).slice(0, 10),
    recentErrors: (report.recentErrors || []).slice(0, 6),
    recentSyncEvents: report.recentSyncEvents,
    deviceInformation: report.deviceInformation,
    networkInformation: report.networkInformation,
    databaseStatus: report.databaseStatus,
    deterministicRootCause: report.possibleRootCause,
    deterministicSolution: report.suggestedSolution,
  };
}

async function maybeGenerateNarrative(report) {
  const provider = getReportProvider();
  if (!provider) return null;
  const completion = await provider.client.chat.completions.create({
    model: provider.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a senior support engineer for Artha, an offline-first retail POS. Given a structured diagnostics report, write a concise, developer-readable incident summary (5-8 sentences): what likely happened, the supporting evidence, the probable root cause, and the recommended fix. Be specific and NEVER invent facts beyond the provided data. Finish with a line 'confidence: X' where X is between 0 and 1.",
      },
      { role: "user", content: JSON.stringify(sanitizeForModel(report)) },
    ],
  });
  const text = completion?.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, provider: provider.provider, confidence: parseConfidence(text) };
}

/**
 * generateIncidentReport — the §6 report. Always returns the full structure from
 * the deterministic analysis; when useAi and a key are present, also attaches an
 * LLM narrative (and lets it refine the confidence). Never throws for AI reasons.
 */
export async function generateIncidentReport({ shopId, deviceId = null, problemSummary = "", useAi = true } = {}) {
  if (!shopId) throw new Error("shopId is required to generate an incident report");
  const focus = detectFocus(problemSummary);
  const ctx = await gatherIncidentContext({ shopId, deviceId });
  const analysis = analyzeIncident(ctx, problemSummary, focus);

  const report = {
    generatedAt: new Date().toISOString(),
    problemSummary: problemSummary || null,
    focus,
    recentUserActions: (ctx.auditRows || []).map((a) => ({ action: a.action, entityType: a.entityType, at: a.createdAt })),
    recentErrors: (ctx.errorGroups || []).map((g) => ({ title: g.title, source: g.source, count: g.count, code: g.errorCode, status: g.status, lastSeenAt: g.lastSeenAt })),
    recentSyncEvents: ctx.sync
      ? { counts: ctx.sync.counts, failures: (ctx.sync.recentFailures || []).slice(0, 5), conflicts: (ctx.sync.recentConflicts || []).slice(0, 5), lastSuccessfulSyncAt: ctx.sync.lastSuccessfulSyncAt }
      : null,
    deviceInformation: ctx.deviceHealth ? deviceInfo(ctx.deviceHealth) : null,
    networkInformation: ctx.deviceHealth ? { online: ctx.deviceHealth.online, networkType: ctx.deviceHealth.networkType } : { online: null, networkType: null },
    databaseStatus: { server: ctx.dbOk ? "ok" : "error", device: ctx.deviceHealth?.dbStatus ?? "unknown" },
    possibleRootCause: analysis.probableRootCause,
    suggestedSolution: analysis.suggestedSolution,
    confidenceScore: analysis.confidence,
    confidenceLabel: analysis.confidenceLabel,
    signals: analysis.signals,
    aiNarrative: null,
    aiProvider: null,
  };

  if (useAi) {
    const narrative = await maybeGenerateNarrative(report).catch(() => null);
    if (narrative) {
      report.aiNarrative = narrative.text;
      report.aiProvider = narrative.provider;
      if (Number.isFinite(narrative.confidence)) report.confidenceScore = narrative.confidence;
    }
  }

  return report;
}
