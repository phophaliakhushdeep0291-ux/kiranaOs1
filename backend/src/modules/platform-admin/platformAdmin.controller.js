import { getPlatformOverview } from "./platformAdmin.service.js";
import { resolveIsPlatformAdmin } from "../../middleware/platformAdmin.js";

// Any authenticated user may ask whether THEY are a platform admin, so the
// frontend can decide whether to reveal the admin area — without leaking any
// cross-tenant data (that stays behind requirePlatformAdmin on /overview).
export async function access(req, res, next) {
  try {
    const { isPlatformAdmin } = await resolveIsPlatformAdmin(req);
    res.json({ success: true, data: { isPlatformAdmin } });
  } catch (err) {
    next(err);
  }
}

export async function overview(req, res, next) {
  try {
    res.json({ success: true, data: await getPlatformOverview() });
  } catch (err) {
    next(err);
  }
}
