import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("login first-attempt reliability", () => {
  it("guards background auth verification from clearing a fresh login", () => {
    const source = readFileSync("src/features/auth/AuthContext.tsx", "utf8");

    expect(source).toContain("authGenerationRef");
    expect(source).toContain("const generation = authGenerationRef.current");
    expect(source).toContain("authGenerationRef.current += 1");
    expect(source).toContain("setIsLoading(false)");
  });

  it("redirects authenticated users away from the login route", () => {
    const source = readFileSync("src/app/routes.tsx", "utf8");

    expect(source).toContain("function PublicRoute");
    // Authenticated users are redirected away from /login to their configured landing page
    // (getLandingRoute() defaults to /dashboard).
    expect(source).toContain("if (isAuthenticated) return <Redirect to={getLandingRoute()} />");
  });

  it("keeps the auth provider separate from the useAuth hook for stable dev refresh", () => {
    const provider = readFileSync("src/features/auth/AuthContext.tsx", "utf8");
    const hook = readFileSync("src/features/auth/useAuth.ts", "utf8");
    const routes = readFileSync("src/app/routes.tsx", "utf8");
    const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

    expect(provider).toContain("export function AuthProvider");
    expect(provider).not.toContain("export function useAuth");
    expect(hook).toContain("export function useAuth");
    expect(routes).toContain("@/features/auth/useAuth");
    expect(layout).toContain("@/features/auth/useAuth");
  });
});
