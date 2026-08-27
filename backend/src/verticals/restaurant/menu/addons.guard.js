import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { decrementLocationInventory } from "../../../modules/stores/location-context.service.js";
import { moneyShadows, round2 } from "../../../utils/money.js";
import { validateSelection } from "./addons.service.js";
import { stockLedgerProvenance } from "../../../modules/inventory/stock-ledger-provenance.js";
import { guestSnapshot } from "../storefront/guest-billing.guard.js";

function refusal(message, code = "MENU_ADDON_SELECTION_INVALID", status = 409) {
  return { code, message, status };
}

/** Aggregate linked option stock once per ingredient for a single bill. */
export function aggregateAddonConsumption(lines = []) {
  const byProduct = new Map();
  for (const line of lines) {
    const soldQty = Math.max(0, Number(line.quantity ?? 0));
    for (const option of line.options ?? []) {
      if (!option.linkedProductId) continue;
      const qtyBase = round2(soldQty * Math.max(1, Number(option.quantity ?? 1)) * Math.max(0, Number(option.linkedQtyBase ?? 1)));
      if (qtyBase <= 0) continue;
      byProduct.set(option.linkedProductId, round2((byProduct.get(option.linkedProductId) ?? 0) + qtyBase));
    }
  }
  return byProduct;
}

export function registerAddonSelectionGuard() {
  registerSaleGuard(async ({ shopId, tx, items, location }) => {
    const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
    if (productIds.length === 0) return null;

    const links = await tx.productAddonGroup.findMany({
      where: { shopId, productId: { in: productIds } },
      include: { group: { include: { options: true } } },
      orderBy: { sortOrder: "asc" },
    });
    if (links.length === 0 && items.every((item) => !(item.addons?.length))) return null;

    const groupsByProduct = new Map();
    for (const link of links) {
      if (!link.group || link.group.deletedAt || link.group.isActive === false) continue;
      if (!groupsByProduct.has(link.productId)) groupsByProduct.set(link.productId, []);
      groupsByProduct.get(link.productId).push(link.group);
    }

    const snapshotsByIndex = new Map();
    const consumptionLines = [];
    for (const [itemIndex, item] of items.entries()) {
      if (!item.productId) continue;
      const groups = groupsByProduct.get(item.productId) ?? [];
      const requested = Array.isArray(item.addons) ? item.addons : [];
      if (groups.length === 0) {
        if (requested.length) return refusal(`Configured options are not available for "${item.name}" anymore`);
        continue;
      }

      const requestedById = new Map();
      for (const row of requested) {
        const optionId = String(row.optionId ?? "");
        if (!optionId) return refusal(`An option on "${item.name}" is missing its id`);
        const quantity = Math.max(1, Math.min(20, Math.trunc(Number(row.quantity ?? 1))));
        requestedById.set(optionId, (requestedById.get(optionId) ?? 0) + quantity);
      }

      const matched = new Set();
      const snapshots = [];
      const consumedOptions = [];
      for (const group of groups) {
        const activeOptions = (group.options ?? []).filter((option) => option.isActive !== false);
        const chosenIds = [];
        for (const option of activeOptions) {
          const quantity = requestedById.get(option.id) ?? 0;
          if (quantity <= 0) continue;
          matched.add(option.id);
          for (let count = 0; count < quantity; count += 1) chosenIds.push(option.id);
          snapshots.push({
            optionId: option.id,
            groupName: group.name,
            name: option.name,
            price: Number(item[guestSnapshot]?.addons?.find((addon) => addon.optionId === option.id)?.price ?? option.priceDelta ?? 0),
            quantity,
            ...moneyShadows({ price: Number(item[guestSnapshot]?.addons?.find((addon) => addon.optionId === option.id)?.price ?? option.priceDelta ?? 0) }),
          });
          consumedOptions.push({
            linkedProductId: option.linkedProductId ?? null,
            linkedQtyBase: Number(option.linkedQtyBase ?? 1),
            quantity,
          });
        }
        const selection = validateSelection(group, chosenIds);
        if (!selection.ok) return refusal(selection.reason);
      }
      if ([...requestedById.keys()].some((id) => !matched.has(id))) {
        return refusal(`An option on "${item.name}" is no longer available`);
      }

      const addonUnitPrice = round2(snapshots.reduce((sum, row) => sum + row.price * row.quantity, 0));
      if (snapshots.length > 0 && item.baseRatePerRateUnit == null) {
        return refusal(`Refresh "${item.name}" before billing its options`, "MENU_ADDON_BASE_PRICE_REQUIRED");
      }
      const baseRate = Number(item.baseRatePerRateUnit ?? item.ratePerRateUnit ?? 0);
      item.baseRatePerRateUnit = round2(baseRate);
      item.ratePerRateUnit = round2(baseRate + addonUnitPrice);
      item.originalUnitPrice = round2(Number(item.originalUnitPrice ?? baseRate) + addonUnitPrice);
      snapshotsByIndex.set(itemIndex, snapshots);
      consumptionLines.push({ quantity: item.quantity, options: consumedOptions });
    }

    const consumption = aggregateAddonConsumption(consumptionLines);
    return {
      decorateBillItem: ({ itemIndex }) => {
        const snapshots = snapshotsByIndex.get(itemIndex) ?? [];
        return snapshots.length > 0 ? { addons: { create: snapshots } } : null;
      },
      onConfirmed: consumption.size === 0 ? undefined : async ({ tx: confirmTx, bill, location: confirmedLocation, actor }) => {
        for (const [productId, qtyBase] of consumption) {
          const product = await confirmTx.product.findFirst({
            where: { id: productId, shopId, deletedAt: null },
          });
          if (!product) continue;
          const stockResult = await decrementLocationInventory(confirmTx, {
            shopId,
            location: confirmedLocation ?? location,
            product,
            quantityBase: qtyBase,
            allowShortfall: true,
          });
          await confirmTx.stockLedger.create({
            data: {
              shopId,
              locationId: (confirmedLocation ?? location).id,
              productId,
              productName: product.name,
              ...stockLedgerProvenance(actor),
              action: "addon_use",
              changeBaseQty: -qtyBase,
              oldStockBaseQty: stockResult.oldStock,
              newStockBaseQty: stockResult.newStock,
              billId: bill.id,
              sourceType: "bill",
              sourceId: bill.id,
              idempotencyKey: `addon:${bill.id}:${productId}`,
              clientMovementId: `addon:${bill.id}:${productId}`,
              note: `Options used by ${bill.billNo}`,
            },
          });
        }
      },
    };
  });
}

registerAddonSelectionGuard();
