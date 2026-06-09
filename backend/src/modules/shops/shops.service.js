import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

export async function getShop(shopId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("Shop not found", 404);
  return shop;
}

export async function updateShop(shopId, data) {
  return db.shop.update({ where: { id: shopId }, data });
}
