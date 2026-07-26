// LAYER 3 — transparent risk scoring.
//
// Every number below is recorded in the finding's scoreBreakdownJson, so any
// score can be recomputed by hand from the persisted breakdown alone. No model
// output ever enters this calculation. See docs/AUDIT_RISK_SCORING.md.
//
//   contribution(rule) = min(MAX_RULE_CONTRIBUTION,
//                            round(weight × severityMultiplier))
//   base               = Σ contributions          (clamped to 0..100)
//   final              = clamp(round(base × materiality × history), 0, 100)
//   confidence         = 1 − Σ deductions          (floor 0.3)
import {
  BASELINE_STATUS,
  MAX_RULE_CONTRIBUTION,
  SEVERITY_MULTIPLIER,
  riskLevelForScore,
} from "./assurance.constants.js";

// Materiality: bigger money means a bigger score, but the multiplier is
// bounded so a large amount can never manufacture a finding on its own.
export const MATERIALITY_BANDS = Object.freeze([
  { maxPaise: 50000, multiplier: 0.8, label: "under ₹500" },
  { maxPaise: 500000, multiplier: 1.0, label: "₹500–₹5,000" },
  { maxPaise: 2500000, multiplier: 1.15, label: "₹5,000–₹25,000" },
  { maxPaise: Number.MAX_SAFE_INTEGER, multiplier: 1.3, label: "above ₹25,000" },
]);

export const HISTORY_MODIFIERS = Object.freeze({
  NONE: { multiplier: 1, label: "no prior findings for this entity" },
  REPEAT: { multiplier: 1.1, label: "entity has prior confirmed findings" },
  CHRONIC: { multiplier: 1.2, label: "entity has three or more prior confirmed findings" },
});

const CONFIDENCE_DEDUCTIONS = Object.freeze({
  INSUFFICIENT_BASELINE: { amount: 0.15, label: "a triggered rule relied on a baseline with insufficient history" },
  ADVISORY_ATTRIBUTION: { amount: 0.1, label: "actor attribution for this record type is advisory only" },
  OFFLINE_ORIGIN: { amount: 0.05, label: "record originated offline, so client timestamps are not authoritative" },
});

const CONFIDENCE_FLOOR = 0.3;

export function materialityFor(amountPaise) {
  const magnitude = Math.abs(Number(amountPaise ?? 0));
  const band = MATERIALITY_BANDS.find((candidate) => magnitude <= candidate.maxPaise) ?? MATERIALITY_BANDS.at(-1);
  return { multiplier: band.multiplier, band: band.label, amountPaise: magnitude };
}

export function historyModifierFor(priorConfirmedFindings = 0) {
  if (priorConfirmedFindings >= 3) return { ...HISTORY_MODIFIERS.CHRONIC, priorConfirmedFindings };
  if (priorConfirmedFindings >= 1) return { ...HISTORY_MODIFIERS.REPEAT, priorConfirmedFindings };
  return { ...HISTORY_MODIFIERS.NONE, priorConfirmedFindings };
}

/**
 * @param {Array<{rule, details}>} triggeredRules
 * @param {{amountPaise?: number, priorConfirmedFindings?: number, weightOverrides?: Map<string, number>}} options
 */
export function scoreFinding(triggeredRules, options = {}) {
  const { amountPaise = 0, priorConfirmedFindings = 0, weightOverrides = new Map() } = options;

  const contributions = triggeredRules.map(({ rule, details }) => {
    const configuredWeight = weightOverrides.get(rule.ruleCode);
    const weight = Number.isFinite(configuredWeight) ? configuredWeight : rule.defaultWeight;
    const severityMultiplier = SEVERITY_MULTIPLIER[rule.severity] ?? 1;
    const raw = weight * severityMultiplier;
    const scoreContribution = Math.min(MAX_RULE_CONTRIBUTION, Math.round(raw));
    return {
      ruleCode: rule.ruleCode,
      ruleVersion: rule.version,
      category: rule.category,
      severity: rule.severity,
      weight,
      weightSource: Number.isFinite(configuredWeight) ? "shop_override" : "rule_default",
      severityMultiplier,
      rawContribution: Number(raw.toFixed(2)),
      cappedAt: raw > MAX_RULE_CONTRIBUTION ? MAX_RULE_CONTRIBUTION : null,
      scoreContribution,
      details,
    };
  });

  const summedBase = contributions.reduce((total, entry) => total + entry.scoreContribution, 0);
  const baseScore = Math.min(100, summedBase);
  const materiality = materialityFor(amountPaise);
  const history = historyModifierFor(priorConfirmedFindings);

  const preClampScore = baseScore * materiality.multiplier * history.multiplier;
  const finalScore = Math.max(0, Math.min(100, Math.round(preClampScore)));
  const riskLevel = riskLevelForScore(finalScore);
  const confidence = computeConfidence(triggeredRules, options);

  return {
    baseScore,
    summedContributions: summedBase,
    baseScoreClampedAt100: summedBase > 100,
    materialityMultiplier: materiality.multiplier,
    materialityBand: materiality.band,
    historyMultiplier: history.multiplier,
    historyLabel: history.label,
    priorConfirmedFindings: history.priorConfirmedFindings,
    preClampScore: Number(preClampScore.toFixed(2)),
    finalScore,
    riskLevel,
    confidence: confidence.value,
    confidenceReasons: confidence.reasons,
    triggeredRules: contributions,
    formula: "final = clamp(round(min(100, Σ min(60, weight × severityMultiplier)) × materiality × history), 0, 100)",
  };
}

function computeConfidence(triggeredRules, options) {
  const reasons = [];
  let value = 1;

  const usedInsufficientBaseline = triggeredRules.some(({ details }) => {
    if (!details || typeof details !== "object") return false;
    return details.baselineStatus === BASELINE_STATUS.INSUFFICIENT_DATA || details.sampleCount === 0;
  });
  if (usedInsufficientBaseline) {
    value -= CONFIDENCE_DEDUCTIONS.INSUFFICIENT_BASELINE.amount;
    reasons.push(CONFIDENCE_DEDUCTIONS.INSUFFICIENT_BASELINE.label);
  }

  const advisoryAttribution = triggeredRules.some(({ details }) => {
    if (!details || typeof details !== "object") return false;
    return details.staffAttributionAvailable === false || details.userIdAttributionAvailable === false;
  });
  if (advisoryAttribution) {
    value -= CONFIDENCE_DEDUCTIONS.ADVISORY_ATTRIBUTION.amount;
    reasons.push(CONFIDENCE_DEDUCTIONS.ADVISORY_ATTRIBUTION.label);
  }

  if (options.offlineOrigin) {
    value -= CONFIDENCE_DEDUCTIONS.OFFLINE_ORIGIN.amount;
    reasons.push(CONFIDENCE_DEDUCTIONS.OFFLINE_ORIGIN.label);
  }

  return {
    value: Number(Math.max(CONFIDENCE_FLOOR, value).toFixed(2)),
    reasons: reasons.length ? reasons : ["all triggered rules used complete, server-authoritative data"],
  };
}
