import db from "../../db.js";
import { getGstInvoiceRegister } from "./compliance.service.js";
import { buildTaxReview } from "./tax-review.engine.js";

export async function getTaxReview(shopId, query, dependencies = { db, getGstInvoiceRegister }) {
  const register = await dependencies.getGstInvoiceRegister(shopId, { ...query, range: "custom" });
  const scope = { shopId, ...(query.locationId ? { locationId: query.locationId } : {}) };
  const dates = { gte: new Date(register.from), lte: new Date(register.to) };
  const [purchases, expenses] = await Promise.all([
    dependencies.db.purchaseReceipt.findMany({
      where: { ...scope, createdAt: dates },
      select: { id: true, supplierId: true, supplierInvoiceNumber: true, supplierInvoiceAmount: true, matchStatus: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    dependencies.db.expense.findMany({
      where: { ...scope, deletedAt: null, spentAt: dates },
      select: { id: true, vendor: true },
      orderBy: [{ spentAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return buildTaxReview({ register, purchases, expenses, locationId: query.locationId || null });
}
