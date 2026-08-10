import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transfers = readFileSync("src/features/core/inventory/pages/StockTransfersPage.tsx", "utf8");
const taxes = readFileSync("src/features/core/settings/pages/TaxesSettingsPage.tsx", "utf8");

describe("multi-GSTIN transfer and reporting UI", () => {
  it("collects a registration identity without claiming GST portal verification", () => {
    expect(transfers).toContain('value="inherit"');
    expect(transfers).toContain('value="distinct"');
    expect(transfers).toContain('value="unregistered"');
    expect(transfers).toContain("gstLegalName");
    expect(transfers).toContain("gstTradeName");
    expect(transfers).toContain("local format/checksum validation—not GST portal verification");
    expect(transfers).not.toContain("GSTIN verified by GST portal");
  });

  it("previews and submits the correct transfer evidence", () => {
    for (const contract of [
      "declaredTaxableValue",
      'documentType: distinctSupply ? "tax_invoice"',
      '"delivery_challan"',
      "documentNumber",
      "documentDate",
      "movementReason",
      "ownerPin",
    ]) expect(transfers).toContain(contract);
    expect(transfers).toContain("Distinct-registration supply");
    expect(transfers).toContain("Same GST registration");
    expect(transfers).toContain("E-way applicability review");
    expect(transfers).toContain("does not create or submit a legal e-way bill");
  });

  it("resolves threshold-triggered reviews without claiming portal submission", () => {
    for (const contract of [
      "/compliance-review",
      'value="external_reference_recorded"',
      'value="not_required_after_review"',
      "12-digit e-way bill number",
      "reviewOwnerPin",
      'invalidateQueries({ queryKey: ["gst-compliance-readiness"] })',
      "not portal-verified",
    ]) expect(transfers).toContain(contract);
    expect(transfers).toContain("does not verify the e-way bill portal");
  });

  it("supports auditable multi-line shipment dispatch, partial receipt, and cancellation", () => {
    for (const contract of [
      'setFulfillmentMode("shipment")',
      "draftLines.map",
      "Dispatch and receive",
      "Build one auditable shipment with multiple product lines",
      "expectedArrivalDate",
      "carrierName",
      "trackingNumber",
      "/receive",
      "Receive only what physically arrived",
      "remainingBaseQty",
      "Cannot receive more than the remaining quantity",
      "/cancel",
      "only unreceived quantities return to source availability",
      "Owner PIN approval",
    ]) expect(transfers).toContain(contract);
  });

  it("keeps GST working papers scoped to one explicit seller registration", () => {
    expect(taxes).toContain("selectedSellerGstin");
    expect(taxes).toContain("requireSellerRegistration");
    expect(taxes).toContain("sellerGstin=${encodeURIComponent(sellerGstin)}");
    expect(taxes).toContain("GST returns and working papers are registration-specific");
    expect(taxes).toContain("immutable bill seller snapshots");
    expect(taxes).toContain("portal status is not verified");
  });
});
