import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Customers/Udhar first-load performance contracts", () => {
  it("loads customer detail locally while the shared cloud summary refresh runs independently", () => {
    const content = source("../features/core/customers/pages/CustomerDetailPage.tsx");
    const local = content.slice(content.indexOf("const detailQuery = useQuery"), content.indexOf("const authoritativeQuery = useQuery"));
    expect(local).toContain("loadCustomerDetail(id)");
    expect(local).toContain("loadCachedAuthoritativeSummary()");
    expect(local).not.toContain("resolveAuthoritativeUdharSummary");
    expect(local).not.toContain("repairLedgerDriftFromServer");
    expect(content).toContain('queryKey: ["customers-authoritative-summary-refresh"]');
    expect(content).toContain("appliedSummary.current = { id, data: resolved");
  });
  it("defers the financial integrity scan and indexes ledger rows in one pass", () => {
    const content = source("../features/core/customers/customer-ledger-data.ts");
    const loader = content.slice(content.indexOf("export async function loadCustomersWithLedger"));

    expect(content).toContain("requestIdleCallback");
    expect(content).toContain("ledgerByCustomerId");
    expect(loader).not.toMatch(/allCustomers\.map[\s\S]*?ledger\.filter/);
  });

  it("does not block the local customer list on a live server summary", () => {
    const content = source("../features/core/customers/pages/CustomersPage.tsx");
    const hook = content.slice(content.indexOf("function useCustomersLedgerList"), content.indexOf("function money"));

    expect(hook).toContain("loadCachedAuthoritativeSummary()");
    expect(hook).toContain('queryKey: ["customers-authoritative-summary-refresh"]');
    expect(hook).not.toMatch(/queryFn:\s*async[\s\S]*?await resolveAuthoritativeUdharSummary/);
  });

  it("hydrates a fresh device directly from the customer API without blocking local paint", () => {
    const content = source("../features/core/customers/pages/CustomersPage.tsx");
    const hook = content.slice(content.indexOf("function useCustomersLedgerList"), content.indexOf("function money"));

    expect(hook).toContain('queryKey: ["customers-ledger-server-refresh"]');
    expect(hook).toContain("listCustomersFromServer({ limit: 1_000 })");
    expect(hook).toContain("await cacheCustomers(merged)");
    expect(hook.indexOf("const localQuery = useQuery")).toBeLessThan(hook.indexOf("const serverCustomersQuery = useQuery"));
  });

  it("keeps the legacy Udhar loader local-first and refreshes server truth separately", () => {
    const content = source("../features/core/udhar/pages/UdharPage.tsx");
    const loader = content.slice(content.indexOf("async function loadUdharHome"), content.indexOf("function readInstantUdharHome"));

    expect(loader).toContain("getLocalUdharSummaryAsync()");
    expect(loader).not.toContain("resolveAuthoritativeUdharSummary");
    expect(content).toContain('queryKey: ["customers-authoritative-summary-refresh"]');
    expect(content).toContain("placeholderData: readInstantUdharHome");
  });
});
