import assert from "node:assert/strict";
import { acquireShopMaintenanceLock, getActiveShopMaintenanceLock, releaseShopMaintenanceLock } from "../src/modules/backups/maintenance-lock.service.js";

let row = null;
const database = { shopMaintenanceLock: {
  updateMany: async ({ where, data }) => { if (row?.shopId === where.shopId && row.expiresAt <= where.expiresAt.lte) { row = { ...row, ...data }; return { count: 1 }; } return { count: 0 }; },
  create: async ({ data }) => { if (row) { const error = new Error("unique"); error.code = "P2002"; throw error; } row = data; return row; },
  deleteMany: async ({ where }) => { if (row?.shopId === where.shopId && row.tokenHash === where.tokenHash) { row = null; return { count: 1 }; } return { count: 0 }; },
  findFirst: async ({ where }) => row?.shopId === where.shopId && row.expiresAt > where.expiresAt.gt ? { reason: row.reason, expiresAt: row.expiresAt } : null,
} };

const first = await acquireShopMaintenanceLock("shop-1", "owner-1", "restore", { database, ttlMs: 60_000 });
assert.equal((await getActiveShopMaintenanceLock("shop-1", { database }))?.reason, "restore");
await assert.rejects(() => acquireShopMaintenanceLock("shop-1", "owner-1", "restore", { database }), (error) => error.code === "SHOP_MAINTENANCE_LOCKED");
assert.equal(await releaseShopMaintenanceLock("shop-1", "wrong", { database }), false);
assert.equal(await releaseShopMaintenanceLock("shop-1", first.token, { database }), true);
assert.equal(await getActiveShopMaintenanceLock("shop-1", { database }), null);
console.log("Shop maintenance lock examples passed");
