import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { requestLocationId, resolveOperationalLocation } from "./location-context.service.js";

const CAPABILITY_FIELD = {
  sell: "canSell",
  purchase: "canPurchase",
  inventory: "canManageInventory",
  transfer: "canTransfer",
};

function denied(locationId, capability) {
  const error = new AppError("You are not assigned to this store location for that action", 403, "LOCATION_ACCESS_DENIED");
  error.publicData = { locationId, capability };
  return error;
}

export async function getUserLocationAccess(shopId, userId, client = db) {
  return client.userLocationAccess.findMany({
    where: { shopId, userId, active: true },
    orderBy: { createdAt: "asc" },
    include: { location: true },
  });
}

export async function assertLocationCapability({ shopId, userId, role, locationId, capability = "view", client = db }) {
  if (role === "owner") return true;
  const assignments = await client.userLocationAccess.findMany({ where: { shopId, userId, active: true } });
  // Backward compatibility: existing staff remain shop-wide until the owner creates
  // their first explicit assignment. From that point forward, access is deny-by-default.
  if (assignments.length === 0) return true;
  const row = assignments.find((assignment) => assignment.locationId === locationId);
  if (!row) throw denied(locationId, capability);
  const field = CAPABILITY_FIELD[capability];
  if (field && !row[field]) throw denied(locationId, capability);
  return true;
}

export async function accessibleLocationIds(shopId, userId, role, client = db) {
  if (role === "owner") return null;
  const rows = await client.userLocationAccess.findMany({ where: { shopId, userId, active: true }, select: { locationId: true } });
  return rows.length ? rows.map((row) => row.locationId) : null;
}

export function requireLocationAccess(capability = "view") {
  return async function locationAccessMiddleware(req, _res, next) {
    try {
      const location = await resolveOperationalLocation(req.shopId, requestLocationId(req));
      await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: location.id, capability });
      req.operationalLocation = location;
      next();
    } catch (error) { next(error); }
  };
}

export function requireLocationParamAccess(capability = "view", parameter = "id") {
  return async function locationParamAccessMiddleware(req, _res, next) {
    try {
      const location = await resolveOperationalLocation(req.shopId, req.params?.[parameter]);
      await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId: location.id, capability });
      req.operationalLocation = location;
      next();
    } catch (error) { next(error); }
  };
}
