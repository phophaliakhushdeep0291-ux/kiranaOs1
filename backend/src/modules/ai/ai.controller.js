import * as svc from "./ai.service.js";
import { AppError } from "../../middleware/error.js";
import { getUploadedAudioFile, removeUploadedAudioFile } from "./ai.upload.js";
import { createPurchaseInvoiceDraft } from "../finance/accounting-document.service.js";

function sendAiProviderError(err, res) {
  const msg = (err.message ?? "").toLowerCase();
  const status = err.status ?? err.statusCode ?? 0;

  const noKeyConfigured = err.code === "AI_KEY_MISSING" || msg.includes("no ai api key configured");
  const invalidKey = status === 401
    || msg.includes("authentication")
    || msg.includes("invalid api key")
    || msg.includes("incorrect api key");
  const quotaExceeded = (status === 429 && (msg.includes("quota") || msg.includes("billing")))
    || msg.includes("exceeded your current quota");
  const rateLimited = status === 429 || msg.includes("rate limit") || msg.includes("too many requests");

  if (noKeyConfigured || (invalidKey && !quotaExceeded)) {
    res.status(503).json({
      success: false,
      error: "AI is not configured for this server. Add a valid GROQ_API_KEY or OPENAI_API_KEY.",
      code: "AI_KEY_MISSING",
    });
    return true;
  }

  if (quotaExceeded) {
    res.status(503).json({
      success: false,
      error: "The AI provider quota is unavailable. Check provider billing or configure the fallback provider.",
      code: "AI_QUOTA_EXCEEDED",
    });
    return true;
  }

  if (rateLimited) {
    res.status(429).json({
      success: false,
      error: "AI rate limit hit. Wait a moment and try again.",
      code: "AI_RATE_LIMITED",
    });
    return true;
  }

  return false;
}

export async function parseCommand(req, res, next) {
  try {
    const data = await svc.parseCommand(req.shopId, req.user?.userId, req.body);
    res.json({ success: true, data });
  } catch (err) {
    if (sendAiProviderError(err, res)) return;
    next(err);
  }
}

export async function logAction(req, res, next) {
  try {
    const data = await svc.logAction(req.shopId, req.user?.userId, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function transcribe(req, res, next) {
  const file = getUploadedAudioFile(req);
  if (!file) return next(new AppError("Audio file is required", 400, "AUDIO_FILE_REQUIRED"));

  try {
    const data = await svc.transcribeAudio(file);
    res.json({ success: true, data });
  } catch (err) {
    if (sendAiProviderError(err, res)) return;
    next(err);
  } finally {
    await removeUploadedAudioFile(file);
  }
}

export async function extractPurchaseInvoice(req, res, next) {
  try {
    const result = await createPurchaseInvoiceDraft(req.shopId, req.invoiceImage, req.user);
    res.json({ success: true, data: { draft: result.document.extracted, document: result.document, duplicate: result.duplicate } });
  } catch (err) {
    if (sendAiProviderError(err, res)) return;
    next(err);
  }
}
