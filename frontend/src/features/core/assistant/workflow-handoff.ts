import { parseSpokenNavigation } from "@/features/core/voice/spoken-navigation";
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

/** Exact page commands use the same reviewed destinations and role guard as buttons. */
export function spokenWorkflowPath(command: string): string | null {
  // A bare noun can answer a clarification; only explicit page commands bypass AI.
  if (!/open|ओपन|खोल|दिखा/iu.test(command)) return null;
  const intent = parseSpokenNavigation(command);
  return intent?.route ? workflowPath(intent.route.slice(1)) : null;
}
