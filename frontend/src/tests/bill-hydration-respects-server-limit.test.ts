import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Cloud hydration asked `/bills` for 5,000 rows against a server that caps the
 * parameter at 2,000, so every hydration answered
 *
 *   400 — Validation failed: limit: Number must be less than or equal to 2000
 *
 * and `safeFetch` swallowed it. Bills were the one table hydration silently never
 * filled, while products, customers and udhar succeeded in the same batch. Found by
 * watching the network tab of a second till during a multi-device sync test; nothing
 * on screen said anything was wrong, because the incremental pull happens to cover
 * the same rows on a device that has been syncing all along.
 *
 * The cap is deliberate — every bill carries its lines, so the answer is already
 * megabytes — so the client pages at the server's maximum rather than the server
 * raising it. These tests hold the two halves of that contract together.
 */

const hydration = readFileSync("src/features/core/sync/cloud-hydration.ts", "utf8");
const billsSchema = readFileSync("../backend/src/modules/bills/bills.schema.js", "utf8");

function serverBillLimitCap(): number {
  // Read from the schema rather than restating it, so raising one side without the
  // other fails here instead of in a shop.
  const match = /limit:\s*z\.coerce\.number\(\)\.min\(1\)\.max\((\d+)\)/.exec(billsSchema);
  expect(match, "the /bills limit cap is no longer a plain literal; update this guard").not.toBeNull();
  return Number(match![1]);
}

function clientBillPageLimit(): number {
  const match = /const BILL_IMPORT_PAGE_LIMIT = (\d+);/.exec(hydration);
  expect(match, "BILL_IMPORT_PAGE_LIMIT is gone; update this guard").not.toBeNull();
  return Number(match![1]);
}

describe("the /bills hydration request the server will actually accept", () => {
  it("never asks for more rows than the endpoint allows", () => {
    expect(clientBillPageLimit()).toBeLessThanOrEqual(serverBillLimitCap());
  });

  it("asks for the server's full page size, so history is not paged more than it needs", () => {
    expect(clientBillPageLimit()).toBe(serverBillLimitCap());
  });

  it("does not send the shared 5,000-row import limit to /bills", () => {
    // products, customers and udhar keep DIRECT_IMPORT_LIMIT; only /bills is capped.
    const billsCall = /\/bills\?from=[^`]*`/.exec(hydration);
    expect(billsCall, "the /bills hydration call moved; update this guard").not.toBeNull();
    expect(billsCall![0]).not.toContain("DIRECT_IMPORT_LIMIT");
    expect(billsCall![0]).toContain("BILL_IMPORT_PAGE_LIMIT");
  });

  it("pages, rather than trusting one request to return the whole window", () => {
    expect(hydration).toContain("BILL_IMPORT_MAX_PAGES");
    expect(hydration).toMatch(/page=\$\{page\}/);
  });
});

describe("a truncated read must not quarantine the shop's history", () => {
  it("only replaces the synced snapshot when the window came back complete", () => {
    // replaceSyncedSnapshot removes synced bills absent from the result. Reached with
    // a partial page it would erase real history, which is worse than the 400 was.
    expect(hydration).toMatch(/if \(complete\) \{\s*await offlineDB\.replaceSyncedSnapshot\("bills"/);
  });

  it("still keeps what it did fetch when the window was incomplete", () => {
    expect(hydration).toMatch(/\} else if \(merged\.length > 0\) \{\s*await offlineDB\.putMany\("bills", merged\);/);
  });
});
