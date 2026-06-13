import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "@/lib/api/http";

describe("resolveApiBaseUrl (production API safety)", () => {
  it("throws in production when VITE_API_BASE_URL is missing or empty", () => {
    expect(() => resolveApiBaseUrl({ isProd: true, fromEnv: undefined, fromStorage: null })).toThrow(/VITE_API_BASE_URL/);
    expect(() => resolveApiBaseUrl({ isProd: true, fromEnv: "", fromStorage: null })).toThrow(/VITE_API_BASE_URL/);
  });

  it("ignores the localStorage override in production (token-exfiltration guard)", () => {
    expect(
      resolveApiBaseUrl({ isProd: true, fromEnv: "https://api.kiranaos.app", fromStorage: "http://evil.example/api" }),
    ).toBe("https://api.kiranaos.app");
  });

  it("never falls back to localhost in production", () => {
    expect(() => resolveApiBaseUrl({ isProd: true, fromEnv: undefined, fromStorage: "http://localhost:3000/api" })).toThrow();
  });

  it("allows the localStorage override in development", () => {
    expect(
      resolveApiBaseUrl({ isProd: false, fromEnv: "https://api.x", fromStorage: "http://localhost:9999/api" }),
    ).toBe("http://localhost:9999/api");
  });

  it("falls back to localhost in development when nothing is set", () => {
    expect(resolveApiBaseUrl({ isProd: false, fromEnv: undefined, fromStorage: null })).toBe("http://localhost:3000/api");
  });

  it("strips a trailing slash", () => {
    expect(resolveApiBaseUrl({ isProd: true, fromEnv: "https://api.x/", fromStorage: null })).toBe("https://api.x");
  });
});
