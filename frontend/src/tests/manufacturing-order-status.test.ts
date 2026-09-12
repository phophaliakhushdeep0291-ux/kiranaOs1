import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canCancelTradeOrder, lineCountKey, localDay, tradeOrderDocuments, tradeOrderStatusKey } from "@/features/verticals/manufacturing/trade-order-status";
import { manufacturingEn } from "@/features/core/settings/translations/manufacturing";

const statuses = ["draft", "confirmed", "allocated", "packed", "dispatched", "invoiced", "returned", "cancelled"];

describe("part-shipped orders", () => {
  const page = readFileSync(new URL("../features/verticals/manufacturing/pages/ManufacturingPage.tsx", import.meta.url), "utf8");

  it("names the status an order sits in while the rest is still owed", () => {
    expect(tradeOrderStatusKey("partially_dispatched")).toBe("manufacturing.orders.status.partiallyDispatched");
    expect(manufacturingEn).toHaveProperty("manufacturing.orders.status.partiallyDispatched");
    // It must not fall through to the transient "updating" label, which is what
    // the register showed for any status it did not know.
    expect(tradeOrderStatusKey("partially_dispatched")).not.toBe("manufacturing.orders.status.updating");
  });

  it("prints what shipped and invoices it while the back-order is still open", () => {
    const open = tradeOrderDocuments({ status: "partially_dispatched", billId: "bill-1" });
    expect(open).toEqual({ packingList: true, label: true, invoice: true });
    // Without an invoice yet, only the shipping paperwork exists.
    expect(tradeOrderDocuments({ status: "partially_dispatched" }).invoice).toBe(false);
  });

  it("lets a back-order be allocated again and invoiced per consignment", () => {
    expect(page).toContain('order.status === "confirmed" || order.status === "partially_dispatched"');
    expect(page).toContain('["dispatched", "partially_dispatched"].includes(order.status)');
  });

  it("packs what is reserved for this consignment, not the whole line", () => {
    // Packing the ordered quantity would claim goods the shop has not reserved.
    expect(page).not.toContain("packedQuantity: Number(item.quantity) }))");
    expect(page).toContain("(item.allocations ?? []).filter((row) => !row.dispatchId)");
  });

  it("still refuses to cancel an order once goods have gone out", () => {
    for (const status of ["dispatched", "partially_dispatched", "invoiced"]) {
      expect(canCancelTradeOrder(status)).toBe(false);
    }
  });
});

describe("export orders reach the invoice", () => {
  const page = readFileSync(new URL("../features/verticals/manufacturing/pages/ManufacturingPage.tsx", import.meta.url), "utf8");

  it("offers the invoice to any dispatched order, not just domestic ones", () => {
    // The button used to be gated on orderType === "domestic", which left an
    // export dispatched forever with its stock gone and no sale recorded.
    expect(page).not.toContain('order.status === "dispatched" && order.orderType === "domestic"');
    // The gate is the shipping state alone; the order's trade type is irrelevant.
    expect(page).toContain('["dispatched", "partially_dispatched"].includes(order.status) ? <Button');
  });

  it("prints an export on a commercial invoice and a domestic sale on a tax invoice", () => {
    expect(page).toContain('order.orderType === "export" ? "commercial-invoice" : "tax-invoice"');
  });

  it("no longer tells the user export invoicing is unavailable", () => {
    expect(page).not.toContain("manufacturing.invoice.exportPending");
    expect(manufacturingEn).not.toHaveProperty("manufacturing.invoice.exportPending");
  });

  it("asks for the shipping bill, which Table 6A is rejected without", () => {
    expect(manufacturingEn["manufacturing.orders.exportDispatchWarning"]).toMatch(/shipping bill/i);
    expect(manufacturingEn["manufacturing.orders.exportDispatchWarning"]).not.toMatch(/cannot be created/i);
  });
});

describe("wholesale order register status", () => {
  it("names every settled status in the dictionary and shows a claim in progress as updating", () => {
    for (const status of statuses) expect(tradeOrderStatusKey(status)).toBe(`manufacturing.orders.status.${status}`);
    for (const claim of ["allocating", "packing", "dispatching", "invoicing", "returning"]) expect(tradeOrderStatusKey(claim)).toBe("manufacturing.orders.status.updating");
    for (const status of [...statuses, "updating"]) expect(manufacturingEn).toHaveProperty(`manufacturing.orders.status.${status}`);
  });

  it("offers cancellation exactly where the server accepts it", () => {
    expect(statuses.filter(canCancelTradeOrder)).toEqual(["draft", "confirmed", "allocated", "packed"]);
  });

  it("prints documents only for goods that are being packed or have shipped", () => {
    expect(tradeOrderDocuments({ status: "cancelled" })).toEqual({ packingList: false, label: false, invoice: false });
    expect(tradeOrderDocuments({ status: "confirmed" })).toEqual({ packingList: false, label: false, invoice: false });
    expect(tradeOrderDocuments({ status: "allocated" })).toEqual({ packingList: true, label: false, invoice: false });
    expect(tradeOrderDocuments({ status: "dispatched" })).toEqual({ packingList: true, label: true, invoice: false });
    expect(tradeOrderDocuments({ status: "invoiced", billId: "bill-1" })).toEqual({ packingList: true, label: true, invoice: true });
  });

  it("says 1 line, not 1 lines", () => {
    expect(lineCountKey(1)).toBe("manufacturing.orders.lineOne");
    expect(lineCountKey(2)).toBe("manufacturing.orders.lineMany");
  });

  it("dates a dispatch by the device calendar, not UTC", () => {
    // 00:30 on 12 September in the device's zone is still 11 September in UTC east of Greenwich.
    expect(localDay(new Date(2026, 8, 12, 0, 30))).toBe("2026-09-12");
    const page = readFileSync("src/features/verticals/manufacturing/pages/ManufacturingPage.tsx", "utf8");
    expect(page).not.toMatch(/dispatchDate: new Date\(\)\.toISOString\(\)/);
  });

  it("only offers batch-tracked products on a wholesale order", () => {
    const page = readFileSync("src/features/verticals/manufacturing/pages/ManufacturingPage.tsx", "utf8");
    expect(page).toMatch(/filter\(\(row\) => row\.batchTrackingEnabled\)/);
    expect(page).toMatch(/products=\{orderableProducts\}/);
  });
});
