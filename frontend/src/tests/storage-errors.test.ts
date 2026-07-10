import { describe, expect, it } from "vitest";
import { STORAGE_FULL_CODE, StorageFullError, isQuotaExceededError } from "@/lib/offline/storage-errors";

describe("isQuotaExceededError", () => {
  it("matches a bare QuotaExceededError by name", () => {
    const err = new Error("quota");
    err.name = "QuotaExceededError";
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("matches Dexie-style wrapping via .inner", () => {
    const inner = new Error("quota");
    inner.name = "QuotaExceededError";
    const wrapped = Object.assign(new Error("Transaction aborted"), { inner });
    expect(isQuotaExceededError(wrapped)).toBe(true);
  });

  it("matches nested .cause chains", () => {
    const root = new Error("quota");
    root.name = "QuotaExceededError";
    const mid = Object.assign(new Error("mid"), { cause: root });
    const outer = Object.assign(new Error("outer"), { cause: mid });
    expect(isQuotaExceededError(outer)).toBe(true);
  });

  it("matches the legacy DOMException code 22", () => {
    expect(isQuotaExceededError(Object.assign(new Error("legacy"), { code: 22 }))).toBe(true);
  });

  it("rejects ordinary errors, null, and non-objects", () => {
    expect(isQuotaExceededError(new Error("boom"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError("QuotaExceededError")).toBe(false);
  });

  it("does not recurse forever on cyclic causes", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isQuotaExceededError(a)).toBe(false);
  });
});

describe("StorageFullError", () => {
  it("carries the STORAGE_FULL code and a user-actionable message", () => {
    const err = new StorageFullError();
    expect(err.code).toBe(STORAGE_FULL_CODE);
    expect(err.message).toMatch(/storage is full/i);
    expect(err.message).toMatch(/try saving again/i);
  });
});
