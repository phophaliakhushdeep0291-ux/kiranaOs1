import { describe, expect, it } from "vitest";
import { getLocalDashboardSnapshot } from "@/features/reports/queries";
import { writeInstantMemoryCache } from "@/lib/offline/instant-cache";

describe("dashboard payment dedupe", () => {
  it("does not double count local and server cash/UPI rows on the same synced bill", () => {
    // Dates must be RELATIVE to now. The instant cache prunes rows older than RECENT_CACHE_DAYS
    // (30) at write time AND getLocalDashboardSnapshot prunes again on read against the real
    // clock, so any hardcoded past date silently drops the bill and the snapshot reads 0.
    const now = new Date();
    const at = (msAfter: number) => new Date(now.getTime() + msAfter).toISOString();
    const billTime = at(0);

    writeInstantMemoryCache("customers", []);
    writeInstantMemoryCache("customer_ledger", []);
    writeInstantMemoryCache("bills", [
      {
        id: "server_bill_split",
        status: "completed",
        billType: "normal_sale",
        createdAt: billTime,
        grandTotal: 1180,
        creditAmount: 380,
        payments: [
          { id: "payment_local_cash", bill_id: "server_bill_split", mode: "cash", amount: 650, paid_at: billTime, sync_status: "pending_sync" },
          { id: "server_payment_cash", bill_id: "server_bill_split", mode: "cash", amount: 650, paid_at: at(3000), sync_status: "synced" },
          { id: "payment_local_upi", bill_id: "server_bill_split", mode: "upi", amount: 150, paid_at: billTime, sync_status: "pending_sync" },
          { id: "server_payment_upi", bill_id: "server_bill_split", mode: "upi", amount: 150, paid_at: at(3000), sync_status: "synced" },
        ],
      },
    ]);

    const snapshot = getLocalDashboardSnapshot(now);

    expect(snapshot.cash).toBe(650);
    expect(snapshot.upi).toBe(150);
    expect(snapshot.credit).toBe(380);
    expect(snapshot.revenue).toBe(1180);
  });
});
