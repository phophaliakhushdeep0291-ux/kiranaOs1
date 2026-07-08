import { describe, expect, it } from "vitest";
import { getLocalDashboardSnapshot } from "@/features/reports/queries";
import { writeInstantMemoryCache } from "@/lib/offline/instant-cache";

describe("dashboard payment dedupe", () => {
  it("does not double count local and server cash/UPI rows on the same synced bill", () => {
    writeInstantMemoryCache("customers", []);
    writeInstantMemoryCache("customer_ledger", []);
    writeInstantMemoryCache("bills", [
      {
        id: "server_bill_split",
        status: "completed",
        billType: "normal_sale",
        createdAt: "2026-06-07T11:20:00.000Z",
        grandTotal: 1180,
        creditAmount: 380,
        payments: [
          { id: "payment_local_cash", bill_id: "server_bill_split", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
          { id: "server_payment_cash", bill_id: "server_bill_split", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:03.000Z", sync_status: "synced" },
          { id: "payment_local_upi", bill_id: "server_bill_split", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
          { id: "server_payment_upi", bill_id: "server_bill_split", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:03.000Z", sync_status: "synced" },
        ],
      },
    ], 10_000);

    const snapshot = getLocalDashboardSnapshot(new Date("2026-06-07T12:00:00.000Z"));
    expect(snapshot.cash).toBe(650);
    expect(snapshot.upi).toBe(150);
    expect(snapshot.credit).toBe(380);
    expect(snapshot.revenue).toBe(1180);
  });
});
