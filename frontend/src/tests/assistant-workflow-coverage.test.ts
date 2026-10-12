import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import paths from "@/features/core/assistant/workflow-paths.json";
import { workflowPath } from "@/features/core/assistant/workflow-handoff";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import { routeAccessFor, normalizeStaffRole } from "@/features/core/staff/role-access";

vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: vi.fn(() => ({ user: { role: "owner" } })) }));
const root = resolve(import.meta.dirname, "../..");
type Workflow = { id: string; path: string; feature?: string; changesData?: boolean; permission?: string; title: { en: string; hi: string } };
const workflows = JSON.parse(readFileSync(resolve(root, "../backend/src/modules/ai/agent/workflows.json"), "utf8")) as Workflow[];
const routes = readFileSync(resolve(root, "src/app/routes.tsx"), "utf8");
const protectedRoutes = [...routes.matchAll(/<Route path="([^"]+)">\s*<ProtectedRoute([^>]*)/g)].map(match => ({ path: match[1], feature: match[2].match(/featureName="([^"]+)"/)?.[1] }));
const destinations = new Set(Object.values(paths));
afterEach(() => vi.mocked(loadAuthSession).mockReturnValue({ user: { role: "owner" } } as ReturnType<typeof loadAuthSession>));

describe("assistant workflow coverage", () => {
  it("keeps the client allowlist identical to the reviewed server catalogue", () => {
    expect(paths).toEqual(Object.fromEntries(workflows.map(row => [row.id, row.path])));
    expect(workflows.every(row => row.title.en && row.title.hi)).toBe(true);
    for (const path of destinations) expect(path).toMatch(/^\/[a-z0-9/-]+$/);
  });
  it("maps every shop screen, using parent lists to select a specific record", () => {
    expect(protectedRoutes.length).toBeGreaterThan(60);
    const detailParents: Record<string, string> = {
      "/returns": "/returns/new", // Both routes render the same return form.
      "/bills/:id": "/bills", "/customers/:id": "/customers",
      "/products/:productId/pricing": "/products", "/assurance/findings/:id": "/assurance/findings",
    };
    for (const route of protectedRoutes) {
      if (route.path.startsWith("/platform-admin")) continue; // Platform operations are outside shop authorization.
      const path = detailParents[route.path] ?? route.path;
      expect(destinations.has(path), `Missing handoff for ${route.path}`).toBe(true);
      if (route.feature && !detailParents[route.path]) expect(workflows.find(row => row.path === path)?.feature).toBe(route.feature);
    }
  });
  it("maps each trade's routes and feature gates without inventing a URL", () => {
    const directory = resolve(root, "src/features/verticals");
    let count = 0;
    for (const dir of readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory())) {
      let source: string;
      try { source = readFileSync(resolve(directory, dir.name, "pack.ts"), "utf8"); } catch { continue; }
      for (const match of source.matchAll(/\{ path: "([^"]+)", page: "[^"]+"([^}]*)\}/g)) {
        count++;
        expect(destinations.has(match[1]), `Missing ${dir.name}: ${match[1]}`).toBe(true);
        expect(workflows.find(row => row.path === match[1])?.feature).toBe(match[2].match(/featureName: "([^"]+)"/)?.[1]);
      }
    }
    expect(count).toBeGreaterThan(10);
  });
  it("keeps server handoff restrictions aligned with the actual screen guards", () => {
    for (const role of ["owner", "admin", "staff", "viewer"]) {
      for (const row of workflows) {
        const allowed = routeAccessFor(row.path, normalizeStaffRole(role)).allowed;
        if (!allowed) expect(Boolean(row.permission || (role === "viewer" && row.changesData)), `${role}: ${row.id}`).toBe(true);
      }
    }
  });
  it("only resolves reviewed IDs and respects current role permissions", () => {
    expect(workflowPath("expenses")).toBe("/expenses");
    for (const invalid of [null, {}, "__proto__", "https://evil.example", "javascript:alert(1)", "/settings", "platform_admin"]) expect(workflowPath(invalid)).toBeNull();
    vi.mocked(loadAuthSession).mockReturnValue({ user: { role: "viewer" } } as ReturnType<typeof loadAuthSession>);
    expect(workflowPath("expenses")).toBeNull(); expect(workflowPath("returns")).toBeNull(); expect(workflowPath("staff")).toBeNull();
    expect(workflowPath("reports")).toBe("/reports");
    vi.mocked(loadAuthSession).mockReturnValue({ user: { role: "staff" } } as ReturnType<typeof loadAuthSession>);
    expect(workflowPath("integrations")).toBeNull(); expect(workflowPath("accounting")).toBeNull();
    vi.mocked(loadAuthSession).mockReturnValue({}); expect(workflowPath("expenses")).toBeNull();
  });
});
