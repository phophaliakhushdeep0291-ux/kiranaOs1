import { beforeEach, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api/http";
import { fetchCaOverview, fetchClientShopDetails, generateShopCaCode, revokeShopCaAccess, downloadClientTallyXml, linkClientShop } from "@/features/core/ca-portal/api";
vi.mock("@/lib/api/http", () => ({ apiRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("uses the HTTP client's already-unwrapped payload and preserves period selection", async () => {
  const payload = { clients: [], aggregates: { totalsByCurrency: [] } };
  vi.mocked(apiRequest).mockResolvedValue(payload);
  expect(await fetchCaOverview({ month: "2026-10", status: "not_reviewed" })).toBe(payload);
  expect(apiRequest).toHaveBeenCalledWith("/ca/overview?month=2026-10&status=not_reviewed");
  expect(await fetchClientShopDetails("shop/other?", { from: "2026-10-01", to: "2026-10-02" })).toBe(payload);
  expect(apiRequest).toHaveBeenLastCalledWith("/ca/clients/shop%2Fother%3F?from=2026-10-01&to=2026-10-02");
});
it("forwards owner approval for grant creation/revocation and keeps link data intact", async () => {
  const payload = { id: "grant", code: "CA-test" };
  vi.mocked(apiRequest).mockResolvedValue(payload);
  expect(await generateShopCaCode("1234", 24)).toBe(payload);
  expect(apiRequest).toHaveBeenLastCalledWith("/ca/generate-code", { method: "POST", ownerPin: "1234", body: JSON.stringify({ expiresInHours: 24 }) });
  await revokeShopCaAccess("grant/1", "1234");
  expect(apiRequest).toHaveBeenLastCalledWith("/ca/access/grant%2F1", { method: "DELETE", ownerPin: "1234" });
  expect(await linkClientShop("CA-test", "Client")).toBe(payload);
});
it("downloads the XML blob with an explicit false inventory option", async () => {
  const blob = new Blob(["<ENVELOPE/>"]);
  vi.mocked(apiRequest).mockResolvedValue(blob);
  expect(await downloadClientTallyXml("shop", { inventory: false })).toBe(blob);
  expect(apiRequest).toHaveBeenLastCalledWith("/ca/clients/shop/tally?format=xml&inventory=false", { responseType: "blob" });
});
