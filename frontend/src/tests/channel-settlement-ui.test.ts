import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { automaticMapping, parseHeader } from "@/features/core/reports/pages/ChannelSettlementsPage";
import { PLAN_DEFINITIONS } from "@/features/core/subscription/plans";

const source = readFileSync("src/features/core/reports/pages/ChannelSettlementsPage.tsx", "utf8");
const apiSource = readFileSync("src/features/core/reports/channel-settlement-api.ts", "utf8");
const reportsTranslations = readFileSync("src/features/core/settings/translations/reports.ts", "utf8");

describe("channel settlement operator UI", () => {
  it("parses quoted CSV headers and suggests only recognized canonical mappings", () => {
    const headers = parseHeader('"Order ID",Order Date,"Gross, INR",Paid Net,Unrelated');
    expect(headers).toEqual(["Order ID", "Order Date", "Gross, INR", "Paid Net", "Unrelated"]);
    expect(automaticMapping(headers)).toEqual({
      externalOrderId: "Order ID",
      orderDate: "Order Date",
      paidNet: "Paid Net",
    });
  });

  it("keeps import and resolution owner-approved and explicitly suggestion-only", () => {
    expect(source).toContain("OwnerPinModal");
    expect(source).toContain('t("reports.settlement.importedHint"');
    expect(reportsTranslations).toContain("No payment or order was posted automatically");
    expect(source).toContain('t("reports.settlement.evidenceHint")');
    expect(reportsTranslations).toContain("Nothing is posted automatically");
    expect(source).toContain('action: "match" | "ignore" | "reverse"');
    expect(apiSource).toContain("/accounting/channel-settlements/import");
    expect(apiSource).toContain("/accounting/channel-settlement-rows/");
  });

  it("is restricted to the Business plan contract", () => {
    expect(PLAN_DEFINITIONS.starter.features).not.toContain("channel_settlement");
    expect(PLAN_DEFINITIONS.growth.features).not.toContain("channel_settlement");
    expect(PLAN_DEFINITIONS.pro.features).toContain("channel_settlement");
  });
});
