import { describe, expect, it } from "vitest";
import { withCustomerFinancialLock } from "@/features/core/ledger/customer-financial-lock";

describe("customer financial lock", () => {
  it("runs same-customer decisions one at a time in this app instance", async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const run = (label: string) => withCustomerFinancialLock("customer_lock_test", async () => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(`${label}:start`);
      await Promise.resolve();
      order.push(`${label}:end`);
      active -= 1;
      return label;
    });

    await expect(Promise.all([run("a"), run("b")])).resolves.toEqual(["a", "b"]);
    expect(peak).toBe(1);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not block independent customers behind each other", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let secondStarted = false;
    const first = withCustomerFinancialLock("customer_a", () => hold);
    const second = withCustomerFinancialLock("customer_b", async () => { secondStarted = true; });

    await second;
    expect(secondStarted).toBe(true);
    release();
    await first;
  });
});
