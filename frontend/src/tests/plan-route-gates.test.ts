import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("plan-protected application routes", () => {
  it("gates advanced pages even when users navigate directly by URL", () => {
    const source = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");
    expect(source).toContain('component={ProductPricing} featureName="dynamic_customer_pricing"');
    expect(source).toContain('component={Offers} featureName="dynamic_customer_pricing"');
    expect(source).toContain('component={StaffPage} featureName="staff_login"');
    expect(source).toContain('component={AuditLogsPage} featureName="audit_logs"');
    expect(source).toContain('component={StockTransfers} featureName="multi_store"');
    expect(source).toContain('component={IntegrationsSettings} featureName="api_webhook_later"');
  });
});
