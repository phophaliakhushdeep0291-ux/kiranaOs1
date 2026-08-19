import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { createTransfer, getBranchReplenishmentSuggestions } from "./stores.service.js";

/**
 * Turning replenishment suggestions into transfers without anyone watching. The
 * suggestions themselves are already reviewed-and-explained reads; what was
 * missing is executing them on a schedule.
 *
 * Every default here is the cautious one, because this is the only unattended
 * writer in the system that moves stock:
 *
 *   - disabled unless the owner turns it on, so an upgrade never starts shipping
 *   - "shipment" rather than "instant", so stock lands in transit and a human at
 *     the branch still receives it
 *   - capped per run and per transfer, so a bad threshold cannot empty the warehouse
 *
 * Re-running is safe without any lock of its own: the suggestion query subtracts
 * stock already in transit, so a second run inside the delivery window sees the
 * first run's van and stops suggesting what is already on the way.
 */
export const REPLENISHMENT_DEFAULTS = Object.freeze({
  enabled: false,
  minTransferBaseQty: 1,
  maxLinesPerTransfer: 25,
  maxTransfersPerRun: 10,
  fulfillmentMode: "shipment",
});

export function readReplenishmentPolicy(shop) {
  let parsed = {};
  try {
    const settings = typeof shop?.settingsJson === "string" ? JSON.parse(shop.settingsJson) : shop?.settingsJson;
    parsed = settings?.replenishment ?? {};
  } catch {
    // A malformed settings blob must not be read as "enabled". Falling back to the
    // defaults keeps the unattended writer switched off.
    parsed = {};
  }
  const positiveInt = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  };
  return {
    enabled: parsed.enabled === true,
    minTransferBaseQty: Number.isFinite(Number(parsed.minTransferBaseQty)) && Number(parsed.minTransferBaseQty) > 0
      ? Number(parsed.minTransferBaseQty)
      : REPLENISHMENT_DEFAULTS.minTransferBaseQty,
    maxLinesPerTransfer: positiveInt(parsed.maxLinesPerTransfer, REPLENISHMENT_DEFAULTS.maxLinesPerTransfer),
    maxTransfersPerRun: positiveInt(parsed.maxTransfersPerRun, REPLENISHMENT_DEFAULTS.maxTransfersPerRun),
    fulfillmentMode: parsed.fulfillmentMode === "instant" ? "instant" : REPLENISHMENT_DEFAULTS.fulfillmentMode,
  };
}

/**
 * Pure: decide what would ship, and say why anything was left behind. Skips are
 * returned rather than dropped so an owner can see that a product was considered
 * and rejected, instead of wondering why the shelf is still empty.
 */
export function planReplenishmentRun(suggestions, policy, perPackProductIds = new Set()) {
  const skipped = [];
  const byDestination = new Map();

  for (const suggestion of suggestions) {
    const quantityBaseQty = Number(suggestion.recommendedTransferBaseQty) || 0;
    if (perPackProductIds.has(suggestion.productId)) {
      // A per-pack product cannot move as an untyped lump — the transfer needs to
      // say which size is on the van. The suggestion is product-level, so this one
      // is left for a human rather than guessed at.
      skipped.push({ ...suggestionRef(suggestion), reason: "per_pack_needs_size" });
      continue;
    }
    if (quantityBaseQty < policy.minTransferBaseQty) {
      skipped.push({ ...suggestionRef(suggestion), reason: "below_minimum" });
      continue;
    }
    const locationId = suggestion.destinationLocation?.id;
    if (!locationId) {
      skipped.push({ ...suggestionRef(suggestion), reason: "no_destination" });
      continue;
    }
    if (!byDestination.has(locationId)) {
      byDestination.set(locationId, { toLocationId: locationId, destinationName: suggestion.destinationLocation.name, items: [] });
    }
    const group = byDestination.get(locationId);
    if (group.items.length >= policy.maxLinesPerTransfer) {
      skipped.push({ ...suggestionRef(suggestion), reason: "transfer_line_cap" });
      continue;
    }
    group.items.push({ productId: suggestion.productId, productName: suggestion.productName, quantityBaseQty });
  }

  const all = [...byDestination.values()].filter((group) => group.items.length > 0);
  const transfers = all.slice(0, policy.maxTransfersPerRun);
  for (const group of all.slice(policy.maxTransfersPerRun)) {
    for (const item of group.items) {
      skipped.push({ productId: item.productId, productName: item.productName, destinationLocationId: group.toLocationId, reason: "run_transfer_cap" });
    }
  }
  return { transfers, skipped };
}

function suggestionRef(suggestion) {
  return {
    productId: suggestion.productId,
    productName: suggestion.productName,
    destinationLocationId: suggestion.destinationLocation?.id ?? null,
    recommendedTransferBaseQty: Number(suggestion.recommendedTransferBaseQty) || 0,
  };
}

export async function runUnattendedReplenishment(shopId, options = {}) {
  const dryRun = options.dryRun === true;
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, settingsJson: true } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");

  const policy = readReplenishmentPolicy(shop);
  const startedAt = new Date().toISOString();
  if (!policy.enabled && !dryRun) {
    return { shopId, startedAt, executed: false, reason: "replenishment_disabled", policy, transfers: [], skipped: [] };
  }

  // Runs as the shop owner rather than as nobody: the transfer, its audit row and
  // its location-capability check all want a real actor, and an unattended write
  // with no name on it is the one nobody can investigate later.
  const owner = await db.user.findFirst({ where: { shopId, role: "owner" }, select: { id: true }, orderBy: { createdAt: "asc" } });

  const { suggestions, sourceLocation } = await getBranchReplenishmentSuggestions(shopId);
  const productIds = [...new Set(suggestions.map((row) => row.productId))];
  const perPackRows = productIds.length
    ? await db.product.findMany({ where: { shopId, id: { in: productIds }, packagingMode: "per_pack" }, select: { id: true } })
    : [];
  const plan = planReplenishmentRun(suggestions, policy, new Set(perPackRows.map((row) => row.id)));

  if (dryRun) {
    return { shopId, startedAt, executed: false, reason: "dry_run", policy, sourceLocation, ...plan, created: [] };
  }
  if (!sourceLocation) {
    return { shopId, startedAt, executed: false, reason: "no_source_location", policy, transfers: [], skipped: plan.skipped };
  }

  const created = [];
  const failed = [];
  for (const group of plan.transfers) {
    try {
      const transfer = await createTransfer(shopId, {
        fromLocationId: sourceLocation.id,
        toLocationId: group.toLocationId,
        fulfillmentMode: policy.fulfillmentMode,
        movementReason: "branch_transfer",
        note: `Automatic replenishment ${startedAt.slice(0, 10)}`,
        items: group.items.map((item) => ({ productId: item.productId, quantityBaseQty: item.quantityBaseQty })),
      }, owner?.id ?? null, "owner", null);
      created.push({ transferId: transfer.id, toLocationId: group.toLocationId, destinationName: group.destinationName, lineCount: group.items.length });
    } catch (error) {
      // One branch failing must not strand the others: the rest of the run still
      // ships, and the failure is reported with the code that caused it.
      failed.push({ toLocationId: group.toLocationId, destinationName: group.destinationName, code: error.code ?? "TRANSFER_FAILED", message: error.message });
    }
  }

  await createAuditLog({
    shopId, userId: owner?.id ?? null, module: "stores", action: "REPLENISHMENT_RUN_EXECUTED",
    entityType: "StoreLocation", entityId: sourceLocation.id,
    after: { startedAt, policy, createdCount: created.length, failedCount: failed.length, skippedCount: plan.skipped.length },
  });

  return { shopId, startedAt, executed: true, reason: null, policy, sourceLocation, created, failed, skipped: plan.skipped, transfers: plan.transfers };
}
