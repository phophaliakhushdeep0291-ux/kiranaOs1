import { AppError } from "../../../middleware/error.js";
import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { registerBillLifecycle } from "../../../shared/bill-lifecycle.js";
import { warrantyEndFrom } from "./units.service.js";

const refusal = (message) => ({ code: "TRACKED_UNIT_REQUIRED", status: 409, message });
registerSaleGuard(async ({ shopId, tx, items, productMap, body }) => {
  // Estimates also move inventory in the billing contract; reserve their unit too.
  const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  const registered = await tx.productUnit.findMany({ where: { shopId, productId: { in: productIds }, deletedAt: null } });
  const trackedProducts = new Set(registered.map((unit) => unit.productId));
  const byId = new Map(registered.map((unit) => [unit.id, unit]));
  const picked = new Set();
  for (const item of items) {
    if (!item.trackedUnitId && !trackedProducts.has(item.productId)) continue;
    const unit = byId.get(item.trackedUnitId);
    if (!unit || unit.productId !== item.productId || !productMap[item.productId]) return refusal("Choose an IMEI or serial from this product's register before saving the bill.");
    if (!["in_stock", "returned"].includes(unit.status) || picked.has(unit.id)) return refusal("This IMEI or serial is no longer available. Choose another unit.");
    if (Number(item.quantity) !== 1) return refusal("Each serial number must be billed as one whole unit.");
    picked.add(unit.id);
  }
  if (!picked.size) return null;
  return {
    decorateBillItem({ item, billItem }) {
      const unit = byId.get(item.trackedUnitId);
      if (!unit) return null;
      if (Number(billItem.quantityInBaseUnit) !== 1) throw new AppError("A serial number represents one base unit; select the single-piece selling unit.", 409, "TRACKED_UNIT_QUANTITY");
      const identity = [unit.imei && `IMEI ${unit.imei}`, unit.imei2 && `IMEI2 ${unit.imei2}`, unit.serialNumber && `S/N ${unit.serialNumber}`].filter(Boolean).join(" · ");
      return { trackedUnitId: unit.id, note: [billItem.note, identity].filter(Boolean).join(" · ") };
    },
    async onConfirmed({ tx, bill, billNo }) {
      for (const line of bill.items) {
        const unit = byId.get(line.trackedUnitId);
        if (!unit) continue;
        const soldAt = bill.createdAt;
        const claimed = await tx.productUnit.updateMany({
          where: { id: unit.id, shopId, deletedAt: null, status: unit.status, billId: unit.billId },
          data: { status: "sold", billId: bill.id, billNumber: billNo, soldAt,
            customerId: bill.customerId, customerName: bill.customerName, customerPhone: body.customerMobile ?? "",
            sellingPrice: Number(line.lineTotal), warrantyUntil: warrantyEndFrom(soldAt, unit.warrantyMonths) },
        });
        if (claimed.count !== 1) throw new AppError("This unit was sold at another counter. Choose another serial number.", 409, "UNIT_ALREADY_SOLD");
      }
    },
  };
});

registerBillLifecycle({
  async restore({ tx, shopId, bill }) {
    for (const line of bill.items) {
      if (!line.trackedUnitId) continue;
      const unit = await tx.productUnit.findFirst({ where: { id: line.trackedUnitId, shopId, deletedAt: null } });
      if (!unit) throw new AppError("Restore the linked serial record before restoring this bill.", 409, "UNIT_STATUS_CHANGED");
      const claimed = await tx.productUnit.updateMany({
        where: { id: unit.id, shopId, status: "in_stock", billId: null, deletedAt: null },
        data: { status: "sold", billId: bill.id, billNumber: bill.billNo, soldAt: bill.createdAt,
          customerId: bill.customerId, customerName: bill.customerName, customerPhone: unit.customerPhone,
          sellingPrice: Number(line.lineTotal), warrantyUntil: warrantyEndFrom(bill.createdAt, unit.warrantyMonths) },
      });
      if (claimed.count !== 1) throw new AppError("This serial has moved since cancellation. The bill cannot be restored.", 409, "UNIT_STATUS_CHANGED");
    }
  },
  async cancel({ tx, shopId, bill }) {
    for (const line of bill.items) {
      if (!line.trackedUnitId) continue;
      const result = await tx.productUnit.updateMany({
        where: { id: line.trackedUnitId, shopId, billId: bill.id, status: "sold", deletedAt: null },
        data: { status: "in_stock", billId: null, billNumber: null, soldAt: null, sellingPrice: 0,
          customerId: null, customerName: null, customerPhone: "", warrantyUntil: null },
      });
      if (result.count !== 1) throw new AppError("The linked serial record changed. Resolve its return or service status before cancelling this bill.", 409, "UNIT_STATUS_CHANGED");
    }
  },
  async return({ tx, shopId, bill, original, requests }) {
    for (const line of bill.items) {
      if (!line.trackedUnitId) continue;
      if (Math.abs(Number(line.quantity)) !== 1) throw new AppError("Return the whole serialised unit, not a fraction.", 409, "TRACKED_UNIT_QUANTITY");
      // A serialised line is unique; never guess which of two identical models came back.
      const request = requests.find((item) => item.originalBillItemId === line.originalBillItemId);
      if (!request) throw new AppError("Choose the original bill line for this serial number.", 409, "TRACKED_UNIT_RETURN_LINE");
      const result = await tx.productUnit.updateMany({
        where: { id: line.trackedUnitId, shopId, billId: original.id, status: "sold", deletedAt: null },
        data: { status: request.damaged ? "scrapped" : "returned", condition: "open_box", warrantyUntil: null },
      });
      if (result.count !== 1) throw new AppError("This serial number has already been returned or its status changed.", 409, "UNIT_STATUS_CHANGED");
    }
  },
});
