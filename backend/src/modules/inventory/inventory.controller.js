import * as svc from "./inventory.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function getInventory(req, res, next) {
  try {
    const data = await svc.getInventory(req.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getLowStock(req, res, next) {
  try {
    const data = await svc.getLowStock(req.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function purchase(req, res, next) {
  try {
    const data = await svc.recordPurchase(req.shopId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function damage(req, res, next) {
  try {
    const data = await svc.recordDamage(req.shopId, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "STOCK_DAMAGED",
      entityType: "Product",
      entityId: data.productId,
      before: { stockBaseQty: data.oldStockBaseQty },
      after: { stockBaseQty: data.newStockBaseQty },
      metadata: {
        productName: data.productName,
        quantity: data.quantity,
        enteredUnit: data.enteredUnit,
        qtyRemoved: data.qtyRemoved,
        changeBaseQty: data.changeBaseQty,
        damageLossValue: data.damageLossValue,
        note: data.note,
        oldStockBaseQty: data.oldStockBaseQty,
        newStockBaseQty: data.newStockBaseQty,
      },
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function correction(req, res, next) {
  try {
    const data = await svc.correctStock(req.shopId, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "STOCK_CORRECTED",
      entityType: "Product",
      entityId: data.productId,
      before: { stockBaseQty: data.oldStockBaseQty },
      after: { stockBaseQty: data.newStockBaseQty },
      metadata: {
        productName: data.productName,
        changeBaseQty: data.changeBaseQty,
        note: data.note,
        oldStockBaseQty: data.oldStockBaseQty,
        newStockBaseQty: data.newStockBaseQty,
      },
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getLedger(req, res, next) {
  try {
    const data = await svc.getLedger(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
