import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { englishTranslations } from "@/features/core/settings/translations/english";

const page = readFileSync("src/features/core/settings/pages/IntegrationsSettingsPage.tsx", "utf8");
const routes = readFileSync("../backend/src/modules/integrations/integrations.routes.js", "utf8");
const service = readFileSync("../backend/src/modules/integrations/flipkart-seller.service.js", "utf8");

describe("Flipkart marketplace order sync contract", () => {
  it("exposes a user-operated, owner-approved sync with visible reconciliation", () => {
    expect(page).toContain('"/integrations/flipkart/orders/sync"');
    expect(page).toContain("ownerPin");
    expect(page).toContain("flipkartResult.issues");
    expect(page).toContain("flipkartRangeValid");
    expect(routes).toContain('requireOwnerPin, validate(flipkartOrderSyncSchema)');
  });

  it("never guesses payment, tenant, location, or SKU truth", () => {
    expect(service).toContain("FLIPKART_CONNECTOR_NOT_FOUND");
    expect(service).toContain("LOCATION_UNMAPPED");
    expect(service).toContain("SKU_AMBIGUOUS");
    expect(service).toContain('paymentStatus: "unpaid"');
    expect(englishTranslations["settings.integrations.flipkartSafetyHelp"]).toContain("Payment stays unpaid");
  });

  it("uses idempotent provider identity and bounded pulls", () => {
    expect(service).toContain("flipkart:shipment:");
    expect(service).toContain("MAX_PROVIDER_PAGES");
    expect(service).toContain("DETAIL_BATCH_SIZE = 25");
    expect(routes).toContain('requireFeature("api_webhook_later")');
  });
});
