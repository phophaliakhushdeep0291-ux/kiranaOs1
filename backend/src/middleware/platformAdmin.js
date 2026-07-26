import db from "../db.js";
import { env } from "../config/env.js";
import { AppError } from "./error.js";

// Cross-tenant platform-admin access (Diagnostics §10) lives ONLY behind this gate.
// Membership is an explicit env allowlist (PLATFORM_ADMIN_EMAILS, comma-separated)
// so it is trivial to audit and revoke and is never persisted in tenant data.
// Empty allowlist = the feature is off and nobody is a platform admin.
const ADMIN_EMAILS = new Set(
  String(env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isPlatformAdminEmail(email) {
  return Boolean(email) && ADMIN_EMAILS.has(String(email).toLowerCase());
}

export function platformAdminConfigured() {
  return ADMIN_EMAILS.size > 0;
}

// The caller's email is resolved fresh from the DB — never trusted from the client
// or a stale JWT claim. Must run behind requireAuth.
export async function resolveIsPlatformAdmin(req) {
  const userId = req.user?.userId;
  if (!userId) return { isPlatformAdmin: false, email: null };
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = user?.email ?? null;
  return { isPlatformAdmin: isPlatformAdminEmail(email), email };
}

export async function requirePlatformAdmin(req, _res, next) {
  try {
    if (!req.user?.userId) throw new AppError("Not authenticated", 401);
    const { isPlatformAdmin, email } = await resolveIsPlatformAdmin(req);
    if (!isPlatformAdmin) throw new AppError("Platform admin access required", 403, "PLATFORM_ADMIN_REQUIRED");
    req.platformAdminEmail = email;
    next();
  } catch (err) {
    next(err);
  }
}
