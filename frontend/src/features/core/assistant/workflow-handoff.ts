import paths from "./workflow-paths.json";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import { normalizeStaffRole, routeAccessFor, serverPermissions } from "@/features/core/staff/role-access";

/** Only reviewed IDs resolve. Normal page gates still check features and trade. */
export function workflowPath(id: unknown): string | null {
  if (typeof id !== "string" || !Object.hasOwn(paths, id)) return null;
  const path = paths[id as keyof typeof paths];
  const session = loadAuthSession();
  if (!session.user) return null;
  return routeAccessFor(path, normalizeStaffRole(session.user.role), serverPermissions(session.user)).allowed ? path : null;
}
