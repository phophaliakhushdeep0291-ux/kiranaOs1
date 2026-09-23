import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { assertLocationCapability } from "../stores/location-access.service.js";
import { reconcileTaxInvoices } from "./tax-reconciliation.js";

export async function reconcileForShop(shopId, input, user, client = db) {
  // Registration-wide comparison requires access to every branch of that
  // registration, not merely the branch selected in the browser.
  const [shop, locations] = await Promise.all([
    client.shop.findUnique({ where: { id: shopId }, select: { gstNumber: true } }),
    client.storeLocation.findMany({ where: { shopId, gstNumber: input.recipientGstin }, select: { id: true } }),
  ]);
  if (!locations.length && shop?.gstNumber !== input.recipientGstin) {
    throw new AppError("The recipient GSTIN is not configured for this shop", 403, "TAX_REGISTRATION_ACCESS_DENIED");
  }
  // A shop-only registration has no branch mapping to establish an admin's
  // complete scope, so only its owner may review a registration-wide import.
  if (!locations.length && user?.role !== "owner") {
    throw new AppError("The owner must review an unmapped registration", 403, "TAX_REGISTRATION_ACCESS_DENIED");
  }
  for (const location of locations) await assertLocationCapability({ shopId, userId: user?.userId, role: user?.role, locationId: location.id, client });
  return reconcileTaxInvoices(input);
}
