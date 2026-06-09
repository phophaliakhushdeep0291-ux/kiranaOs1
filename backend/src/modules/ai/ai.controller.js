import * as svc from "./ai.service.js";

export async function parseCommand(req, res, next) {
  try {
    const data = await svc.parseCommand(req.shopId, req.user?.userId, req.body);
    res.json({ success: true, data });
  } catch (err) {
    const msg = (err.message ?? "").toLowerCase();
    const status = err.status ?? err.statusCode ?? 0;

    // Missing key entirely
    const noKeyConfigured = msg.includes("no ai api key configured");
    const invalidKey = status === 401 || msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("incorrect api key");
    const quotaExceeded = status === 429 || msg.includes("exceeded your current quota") || msg.includes("quota") || msg.includes("billing");
    const rateLimited = msg.includes("rate limit") || msg.includes("too many requests");

    if (noKeyConfigured || (invalidKey && !quotaExceeded)) {
      return res.status(503).json({
        success: false,
        error: "No AI key configured. Add GROQ_API_KEY (free) to .env — get one at https://console.groq.com",
        code: "AI_KEY_MISSING",
      });
    }

    if (quotaExceeded) {
      return res.status(503).json({
        success: false,
        error: "OpenAI quota exceeded. Switch to free Groq: add GROQ_API_KEY to .env (https://console.groq.com)",
        code: "AI_QUOTA_EXCEEDED",
      });
    }

    if (rateLimited) {
      return res.status(429).json({
        success: false,
        error: "AI rate limit hit. Wait a moment and try again.",
        code: "AI_RATE_LIMITED",
      });
    }
    next(err);
  }
}

export async function logAction(req, res, next) {
  try {
    const data = await svc.logAction(req.shopId, req.user?.userId, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Placeholder for Whisper transcription
export async function transcribe(_req, res) {
  res.status(501).json({
    success: false,
    error: "Audio transcription endpoint not yet implemented. Use browser Web Speech API for now.",
  });
}
