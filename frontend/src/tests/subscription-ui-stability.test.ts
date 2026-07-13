import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("subscription UI stability", () => {
  it("keeps the last scoped snapshot during background refreshes", () => {
    const access = read("../features/subscription/access.ts");
    expect(access).toContain("subscriptionSnapshotMemoryScope");
    expect(access).toContain("readSubscriptionSnapshotShared");
    expect(access).toContain("if (!subscriptionSnapshotMemory) setLoading(true)");
    expect(access).not.toContain("const refresh = useCallback(async () => {\n    setLoading(true)");
  });

  it("routes current-plan management to a working management screen", () => {
    const plans = read("../features/subscription/pages/PlansPage.tsx");
    const subscription = read("../features/subscription/pages/SubscriptionPage.tsx");
    expect(plans).toContain('isCurrent ? navigate("/subscription") : setTargetPlan(plan.code)');
    expect(subscription).toContain("<CancelSubscriptionDialog");
    expect(subscription).toContain("open={cancelOpen}");
    expect(subscription).toContain("onCancelled={refresh}");
  });
});
