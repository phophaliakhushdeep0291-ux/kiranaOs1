import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transfers = readFileSync("src/features/core/inventory/pages/StockTransfersPage.tsx", "utf8");
const taxes = readFileSync("src/features/core/settings/pages/TaxesSettingsPage.tsx", "utf8");

/**
 * The screen's prose now lives in the dictionary, so the wording assertions read
 * it there. Splitting them this way keeps the guarantee that actually matters —
 * this app must never claim it verified a GSTIN against the portal, or that it
 * submitted a legal e-way bill — while letting the screen be translated. Pinning
 * English inside the component would have made translating it a test failure,
 * which is how a compliance check turns into a reason to leave a screen in
 * English.
 *
 * Each wording check is paired with the key the screen renders, so prose cannot
 * sit correct-but-unused in the catalogue either.
 */
const stockEn = readFileSync("src/features/core/settings/translations/inventory.ts", "utf8");

describe("multi-GSTIN transfer and reporting UI", () => {
  it("collects a registration identity without claiming GST portal verification", () => {
    expect(transfers).toContain('value="inherit"');
    expect(transfers).toContain('value="distinct"');
    expect(transfers).toContain('value="unregistered"');
    expect(transfers).toContain("gstLegalName");
    expect(transfers).toContain("gstTradeName");
    expect(stockEn).toContain("local format/checksum validation—not GST portal verification");
    expect(transfers).toContain("inventory.transfers.addLocationHelp");
    expect(stockEn).not.toContain("GSTIN verified by GST portal");
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
    expect(stockEn).toContain("E-way applicability review");
    expect(transfers).toContain("inventory.transfers.ewayPending");
    expect(stockEn).toContain("does not create or submit a legal e-way bill");
    expect(transfers).toContain("inventory.transfers.ewayThresholdHelp");
  });

  it("resolves threshold-triggered reviews without claiming portal submission", () => {
    for (const contract of [
      "/compliance-review",
      'value="external_reference_recorded"',
      'value="not_required_after_review"',
      "reviewOwnerPin",
      'invalidateQueries({ queryKey: ["gst-compliance-readiness"] })',
      "not portal-verified",
    ]) expect(transfers).toContain(contract);
    expect(stockEn).toContain("12-digit e-way bill number");
    expect(transfers).toContain("inventory.transfers.ewayNumber");
    expect(transfers).toContain("does not verify the e-way bill portal");
  });

  it("supports auditable multi-line shipment dispatch, partial receipt, and cancellation", () => {
    for (const contract of [
      'setFulfillmentMode("shipment")',
      "draftLines.map",
      "expectedArrivalDate",
      "carrierName",
      "trackingNumber",
      "/receive",
      "Receive only what physically arrived",
      "remainingBaseQty",
      "/cancel",
      "only unreceived quantities return to source availability",
      "/stores/replenishment-suggestions",
    ]) expect(transfers).toContain(contract);
    for (const wording of [
      "Dispatch and receive",
      "Build one auditable shipment with multiple product lines",
      "Cannot receive more than the remaining quantity",
      "Owner PIN approval",
      "Branch replenishment queue",
      "Nothing moves without owner review",
      "Prepare transfer",
      "open incoming shipments",
    ]) expect(stockEn).toContain(wording);
    for (const key of [
      "inventory.transfers.modeDispatch",
      "inventory.transfers.productsHelp",
      "inventory.transfers.receiveTooMuch",
      "inventory.transfers.ownerPinApproval",
      "inventory.transfers.replenishQueue",
      "inventory.transfers.replenishHelp",
      "inventory.transfers.prepare",
    ]) expect(transfers).toContain(key);
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
