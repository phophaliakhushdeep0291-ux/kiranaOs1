import * as svc from "./diagnostics.service.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { generateIncidentReport } from "./incident-report.service.js";
import { answerAssistant } from "./assistant.service.js";

function headerDeviceId(req) {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Prefer the server-verified device from the session; the header is only a fallback
// (requireAuth already rejects a header that disagrees with the session's device).
function resolveDeviceId(req) {
  return req.user?.deviceId ?? headerDeviceId(req);
}

export async function reportError(req, res, next) {
  try {
    const result = await svc.recordErrorEvent({
      ...req.body,
      source: "frontend",
      shopId: req.shopId ?? null,
      userId: req.user?.userId ?? null,
      deviceId: resolveDeviceId(req),
    });
    // recordErrorEvent never throws; a null result just means the event was dropped.
    res.status(202).json({ success: true, data: result ?? { recorded: false } });
  } catch (err) {
    next(err);
  }
}

export async function createSupportRequest(req, res, next) {
  try {
    let screenshotKey = null;
    if (req.body.screenshot) {
      screenshotKey = await svc.maybeUploadScreenshot(req.body.screenshot, { shopId: req.shopId });
    }
    // Auto-attach a compact, deterministic diagnosis (§6) so a triaging developer
    // sees the probable cause immediately. useAi:false keeps the report POST fast
    // and free; the full report (with the LLM narrative) is one endpoint call away.
    const incidentReport = await generateIncidentReport({
      shopId: req.shopId,
      deviceId: resolveDeviceId(req),
      problemSummary: req.body.description,
      useAi: false,
    }).catch(() => null);
    const serverDiagnosis = incidentReport
      ? {
          focus: incidentReport.focus,
          possibleRootCause: incidentReport.possibleRootCause,
          suggestedSolution: incidentReport.suggestedSolution,
          confidenceScore: incidentReport.confidenceScore,
          confidenceLabel: incidentReport.confidenceLabel,
          topSignals: (incidentReport.signals ?? []).slice(0, 3),
        }
      : null;

    const request = await svc.createSupportRequest({
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      deviceId: resolveDeviceId(req),
      description: req.body.description,
      page: req.body.page,
      appVersion: req.body.appVersion,
      context: { ...(req.body.context ?? {}), serverDiagnosis },
      screenshotKey,
    });
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SUPPORT_REQUEST_CREATED",
      entityType: "SupportRequest",
      entityId: request.id,
      metadata: { page: req.body.page ?? null, hasScreenshot: Boolean(screenshotKey) },
      req,
    });
    res.status(201).json({
      success: true,
      message: "Thanks — your report was sent to support.",
      data: { id: request.id, status: request.status, createdAt: request.createdAt },
    });
  } catch (err) {
    next(err);
  }
}

export async function listErrors(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.listErrorGroups({ shopId: req.shopId, status: req.query.status, limit: req.query.limit }),
    });
  } catch (err) {
    next(err);
  }
}

export async function getErrorGroup(req, res, next) {
  try {
    const detail = await svc.getErrorGroupDetail({ shopId: req.shopId, id: req.params.id });
    if (!detail) return next(new AppError("Error group not found", 404, "ERROR_GROUP_NOT_FOUND"));
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
}

export async function listSupport(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.listSupportRequests({ shopId: req.shopId, status: req.query.status, limit: req.query.limit }),
    });
  } catch (err) {
    next(err);
  }
}

export async function incidentReport(req, res, next) {
  try {
    const report = await generateIncidentReport({
      shopId: req.shopId,
      deviceId: resolveDeviceId(req),
      problemSummary: typeof req.query.problem === "string" ? req.query.problem : "",
    });
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

export async function assistant(req, res, next) {
  try {
    const result = await answerAssistant({
      shopId: req.shopId,
      deviceId: resolveDeviceId(req),
      // Learning-layer answers ("what do I sell the most?") are personal to the
      // asker, so the assistant needs to know who is asking.
      userId: req.user?.userId ?? null,
      question: req.body.question,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
