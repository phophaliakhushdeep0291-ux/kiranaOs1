import { describe, expect, it } from "vitest";
import { ApiClientError, isRecoverableNetworkError } from "@/lib/api/http";

describe("offline-first recoverable network errors", () => {
  it.each([0, 408, 429, 500, 503])("uses local data for HTTP status %s", (status) => {
    expect(isRecoverableNetworkError(new ApiClientError("temporary", status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("does not hide permanent HTTP status %s", (status) => {
    expect(isRecoverableNetworkError(new ApiClientError("permanent", status))).toBe(false);
  });

  it("treats browser fetch failures as recoverable", () => {
    expect(isRecoverableNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });
});
