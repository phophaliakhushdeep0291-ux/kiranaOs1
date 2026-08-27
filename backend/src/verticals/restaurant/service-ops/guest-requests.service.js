import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: new Set(["acknowledged", "completed", "cancelled"]),
  acknowledged: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
});

async function writeRequiredGuestRequestAudit(client, entry) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Guest request change was not saved because its audit record could not be stored",
      503,
      "GUEST_REQUEST_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

export async function listGuestRequests(shopId, query = {}) {
  return db.restaurantGuestRequest.findMany({
    where: { shopId, ...(query.status ? { status: query.status } : {}) },
    orderBy: { requestedAt: "desc" },
    take: Number(query.limit ?? 100),
  });
}

export async function setGuestRequestStatus(shopId, id, status, user, req) {
  return db.$transaction(async (tx) => {
    const existing = await tx.restaurantGuestRequest.findFirst({ where: { id, shopId } });
    if (!existing) throw new AppError("Guest request not found.", 404, "GUEST_REQUEST_NOT_FOUND");
    if (existing.status === status) return existing;
    if (!ALLOWED_TRANSITIONS[existing.status]?.has(status)) {
      throw new AppError(
        `Guest request cannot move from ${existing.status} to ${status}.`,
        409,
        "GUEST_REQUEST_INVALID_TRANSITION",
      );
    }
    const now = new Date();
    const claimed = await tx.restaurantGuestRequest.updateMany({
      where: { id, shopId, status: existing.status },
      data: {
        status,
        ...(status === "acknowledged" ? { acknowledgedAt: existing.acknowledgedAt || now } : {}),
        ...(status === "completed" || status === "cancelled"
          ? { acknowledgedAt: existing.acknowledgedAt || now, completedAt: now }
          : {}),
      },
    });
    if (claimed.count !== 1) {
      throw new AppError(
        "This guest request was changed by another device; refresh and try again.",
        409,
        "GUEST_REQUEST_UPDATE_CONFLICT",
      );
    }
    const updated = await tx.restaurantGuestRequest.findUniqueOrThrow({ where: { id } });
    await writeRequiredGuestRequestAudit(tx, {
      shopId, userId: user?.userId ?? user?.id ?? null,
      action: "RESTAURANT_GUEST_REQUEST_UPDATED",
      entityType: "RestaurantGuestRequest", entityId: id,
      before: { status: existing.status }, after: { status }, req,
    });
    return updated;
  });
}
