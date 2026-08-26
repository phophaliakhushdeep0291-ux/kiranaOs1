import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export async function listGuestRequests(shopId, query = {}) {
  return db.restaurantGuestRequest.findMany({
    where: { shopId, ...(query.status ? { status: query.status } : {}) },
    orderBy: { requestedAt: "desc" },
    take: Number(query.limit ?? 100),
  });
}

export async function setGuestRequestStatus(shopId, id, status, user, req) {
  const existing = await db.restaurantGuestRequest.findFirst({ where: { id, shopId } });
  if (!existing) throw new AppError("Guest request not found.", 404);
  const now = new Date();
  const updated = await db.restaurantGuestRequest.update({
    where: { id },
    data: {
      status,
      ...(status === "acknowledged" ? { acknowledgedAt: now } : {}),
      ...(status === "completed" || status === "cancelled" ? { completedAt: now } : {}),
    },
  });
  await createAuditLog({ shopId, userId: user?.id, action: "RESTAURANT_GUEST_REQUEST_UPDATED", entityType: "RestaurantGuestRequest", entityId: id, before: { status: existing.status }, after: { status }, req });
  return updated;
}
