import { getActivityAnalytics } from "./analytics.service.js";
import { getRecentActivity, recordActivityBatch } from "./activity.service.js";
import { getAllInsights, classifyInsightQuestion, narrateInsight, runInsight } from "./insights.service.js";
import { getPersonalization, getReplenishmentSuggestions } from "./personalization.service.js";

function headerDeviceId(req) {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Prefer the server-verified device from the session; the header is only a
// fallback (requireAuth already rejects a header that disagrees with the
// session's device).
function resolveDeviceId(req) {
  return req.user?.deviceId ?? headerDeviceId(req);
}

/**
 * Ingest. Always answers 202, even when nothing was stored: a POS must never see
 * an error toast because a telemetry batch failed. The counts in the response
 * are how a client (and an operator) can still tell that events were dropped.
 */
export async function ingest(req, res, next) {
  try {
    const result = await recordActivityBatch(req.body.events, {
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      orgId: req.user?.orgId ?? null,
      deviceId: resolveDeviceId(req),
      source: "pos",
    });
    res.status(202).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function recent(req, res, next) {
  try {
    const data = await getRecentActivity({
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      limit: req.query.limit ?? 10,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function personalization(req, res, next) {
  try {
    const data = await getPersonalization({
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      limit: req.query.limit ?? 10,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function replenishment(req, res, next) {
  try {
    const data = await getReplenishmentSuggestions({ shopId: req.shopId, limit: req.query.limit ?? 10 });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * Insights. With `?question=…` this answers that one question; without it, the
 * whole panel. Both go through the same deterministic calculations.
 */
export async function insights(req, res, next) {
  try {
    const context = { shopId: req.shopId, userId: req.user?.userId ?? null, days: req.query.days ?? 30 };
    if (req.query.question) {
      const key = classifyInsightQuestion(req.query.question);
      const result = key ? await runInsight(key, context) : null;
      return res.json({
        success: true,
        data: {
          matched: Boolean(key),
          insight: key,
          result,
          narrative: narrateInsight(result),
        },
      });
    }
    const data = await getAllInsights(context);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function analytics(req, res, next) {
  try {
    const data = await getActivityAnalytics({
      shopId: req.shopId,
      days: req.query.days ?? 30,
      limit: req.query.limit ?? 10,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
