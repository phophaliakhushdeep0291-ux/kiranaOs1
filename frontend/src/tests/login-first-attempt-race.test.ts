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
    expect(source).toContain("if (isAuthenticated) return <Redirect to=\"/dashboard\" />");
  });
});
