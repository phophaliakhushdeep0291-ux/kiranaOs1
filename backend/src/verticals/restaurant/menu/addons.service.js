import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { moneyShadows } from "../../../utils/money.js";

/**
 * Add-ons: "extra cheese", "no onion", "choose your bread".
 *
 * A group is defined ONCE per shop and attached to as many dishes as serve it.
 * Per-dish add-on lists — which is how most restaurant POS products model this —
 * mean editing the price of extra cheese in forty places and getting it wrong in
 * three. Here the paneer tikka and the paneer roll point at one group, so a price
 * rise is one edit and the menu cannot disagree with itself.
 *
 * The other half of a group is the RULE, not the list. minSelect and maxSelect are
 * what stop the kitchen receiving an order for a burger with no bun, or with four
 * of them. A compulsory choice is minSelect 1; a ceiling is maxSelect.
 *
 * An option priced at zero is a real value, not a missing one: "no onion" and
 * "less spicy" are instructions the cook needs and the guest is not charged for.
 */

/** More than a guest will read on a phone, and enough for any real menu. */
export const MAX_OPTIONS_PER_GROUP = 40;
export const MAX_GROUPS_PER_DISH = 10;

/**
 * Is this a legal set of choices for this group?
 *
 * Pure and exported because it has to be enforced in two places that must agree:
 * the till, so a waiter is stopped before the guest is told a price, and the
 * server, because the till is not the only thing that can post a bill.
 *
 * Returns the reason as a sentence rather than a boolean — "Choose at least 1
 * from Bread" is what the waiter needs to read, and rebuilding that sentence at
 * each call site is how the two ends drift apart.
 */
export function validateSelection(group, selectedOptionIds = []) {
  const known = new Set((group.options ?? []).filter((option) => option.isActive !== false).map((option) => option.id));
  // Repeated ids are deliberate quantities (double cheese counts as two picks),
  // so min/max applies to the number of choices rather than unique option ids.
  const chosen = selectedOptionIds.filter((id) => known.has(id));
  const unknown = selectedOptionIds.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    return { ok: false, reason: `That option is no longer on the menu under "${group.name}"` };
  }
  const min = Math.max(0, Number(group.minSelect ?? 0));
  const max = Math.max(0, Number(group.maxSelect ?? 0));
  if (chosen.length < min) {
    return { ok: false, reason: `Choose at least ${min} from "${group.name}"` };
  }
  // Zero means no ceiling — a group of free instructions can take all of them.
  if (max > 0 && chosen.length > max) {
    return { ok: false, reason: `Choose at most ${max} from "${group.name}"` };
  }
  return { ok: true, reason: null };
}

/**
 * What the add-ons add to ONE unit of the dish.
 *
 * Per unit, not per line: two burgers each with extra cheese are charged for two
 * lots of cheese, and the caller multiplies by quantity exactly once. Returning a
 * per-line figure here is the shape that makes that mistake easy to make twice.
 */
export function addonUnitPrice(selections = []) {
  return selections.reduce((sum, selection) => {
    const price = Number(selection.price ?? 0);
    const quantity = Number(selection.quantity ?? 1);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return sum;
    return sum + price * quantity;
  }, 0);
}

function serializeOption(option) {
  return {
    id: option.id,
    name: option.name,
    price: Number(option.priceDelta ?? 0),
    linkedProductId: option.linkedProductId ?? null,
    linkedQtyBase: Number(option.linkedQtyBase ?? 1),
    sortOrder: Number(option.sortOrder ?? 0),
    isActive: option.isActive !== false,
  };
}

export function serializeGroup(group) {
  return {
    id: group.id,
    name: group.name,
    minSelect: Number(group.minSelect ?? 0),
    maxSelect: Number(group.maxSelect ?? 0),
    sortOrder: Number(group.sortOrder ?? 0),
    isActive: group.isActive !== false,
    /** A group with minSelect >= 1 must be answered before the line can be added. */
    required: Number(group.minSelect ?? 0) > 0,
    options: (group.options ?? [])
      .filter((option) => option.isActive !== false)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
      .map(serializeOption),
  };
}

export async function listAddonGroups(shopId) {
  const groups = await db.menuAddonGroup.findMany({
    where: { shopId, deletedAt: null },
    include: { options: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return groups.map(serializeGroup);
}

/**
 * Create or replace a group and its options in one write.
 *
 * Wholesale rather than per-option for the same reason portions are: the editor
 * holds the whole list, and a half-applied edit would leave a compulsory group
 * with no options in it — which blocks every dish that offers it.
 */
export async function saveAddonGroup(shopId, groupId, input) {
  const options = input.options ?? [];
  if (options.length > MAX_OPTIONS_PER_GROUP) {
    throw new AppError(`A group can hold ${MAX_OPTIONS_PER_GROUP} options at most`, 400);
  }

  const seen = new Set();
  for (const option of options) {
    const key = option.name.trim().toLowerCase();
    if (seen.has(key)) throw new AppError(`This group already has an option called "${option.name}"`, 400);
    seen.add(key);
  }

  const linkedProductIds = [...new Set(options.map((option) => option.linkedProductId).filter(Boolean))];
  if (linkedProductIds.length > 0) {
    const linkedCount = await db.product.count({
      where: { shopId, deletedAt: null, id: { in: linkedProductIds } },
    });
    if (linkedCount !== linkedProductIds.length) {
      throw new AppError("One of the linked stock items is not in this shop", 400);
    }
  }

  const min = Math.max(0, Number(input.minSelect ?? 0));
  const max = Math.max(0, Number(input.maxSelect ?? 0));
  if (max > 0 && min > max) {
    throw new AppError(`"Choose at least ${min}" and "at most ${max}" cannot both be true`, 400);
  }
  // A compulsory group with fewer options than it demands can never be satisfied,
  // and every dish offering it would be unorderable with no way to see why.
  if (min > options.length) {
    throw new AppError(`This group asks for ${min} choices but only offers ${options.length}`, 400);
  }

  const existing = groupId
    ? await db.menuAddonGroup.findFirst({ where: { id: groupId, shopId, deletedAt: null }, include: { options: true } })
    : null;
  if (groupId && !existing) throw new AppError("That add-on group is not on this shop's menu", 404);

  const saved = await db.$transaction(async (tx) => {
    const data = {
      name: input.name.trim(),
      minSelect: min,
      maxSelect: max,
      sortOrder: Math.max(0, Number(input.sortOrder ?? 0)),
      isActive: input.isActive !== false,
    };
    const group = existing
      ? await tx.menuAddonGroup.update({ where: { id: existing.id }, data })
      : await tx.menuAddonGroup.create({ data: { ...data, shopId } });

    const byId = new Map((existing?.options ?? []).map((option) => [option.id, option]));
    const keep = new Set();
    for (const [index, option] of options.entries()) {
      const optionData = {
        name: option.name.trim(),
        priceDelta: Number(option.price ?? 0),
        ...moneyShadows({ priceDelta: Number(option.price ?? 0) }),
        linkedProductId: option.linkedProductId || null,
        linkedQtyBase: Number(option.linkedQtyBase ?? 1),
        sortOrder: Number(option.sortOrder ?? index),
        isActive: true,
      };
      const current = option.id ? byId.get(option.id) : null;
      const row = current
        ? await tx.menuAddonOption.update({ where: { id: current.id }, data: optionData })
        : await tx.menuAddonOption.create({ data: { ...optionData, shopId, groupId: group.id } });
      keep.add(row.id);
    }

    for (const option of existing?.options ?? []) {
      if (keep.has(option.id)) continue;
      // Deactivated, never deleted, for the same reason a billed portion is:
      // BillItemAddon points at it, and a sold receipt must stay readable.
      await tx.menuAddonOption.update({ where: { id: option.id }, data: { isActive: false } });
    }

    return tx.menuAddonGroup.findFirst({ where: { id: group.id }, include: { options: true } });
  });

  return serializeGroup(saved);
}

/** Soft delete: the group leaves every menu, and sold bills still read correctly. */
export async function deleteAddonGroup(shopId, groupId) {
  const group = await db.menuAddonGroup.findFirst({ where: { id: groupId, shopId, deletedAt: null } });
  if (!group) throw new AppError("That add-on group is not on this shop's menu", 404);
  await db.$transaction(async (tx) => {
    await tx.productAddonGroup.deleteMany({ where: { shopId, groupId } });
    await tx.menuAddonGroup.update({ where: { id: groupId }, data: { deletedAt: new Date(), isActive: false } });
  });
  return { id: groupId, deleted: true };
}

/** Which groups a dish offers, replaced wholesale. */
export async function setDishAddonGroups(shopId, productId, groupIds = []) {
  if (groupIds.length > MAX_GROUPS_PER_DISH) {
    throw new AppError(`A dish can offer ${MAX_GROUPS_PER_DISH} add-on groups at most`, 400);
  }
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("That dish is not on this shop's menu", 404);

  const unique = [...new Set(groupIds)];
  if (unique.length > 0) {
    const found = await db.menuAddonGroup.count({ where: { shopId, deletedAt: null, id: { in: unique } } });
    // Counted rather than trusted: a group id from another shop would otherwise
    // attach that shop's options — and its prices — to this shop's dish.
    if (found !== unique.length) throw new AppError("One of those add-on groups is not on this shop's menu", 400);
  }

  await db.$transaction(async (tx) => {
    await tx.productAddonGroup.deleteMany({ where: { shopId, productId } });
    for (const [index, groupId] of unique.entries()) {
      await tx.productAddonGroup.create({ data: { shopId, productId, groupId, sortOrder: index } });
    }
  });
  return listDishAddonGroups(shopId, productId);
}

export async function listDishAddonGroups(shopId, productId) {
  const links = await db.productAddonGroup.findMany({
    where: { shopId, productId },
    include: { group: { include: { options: true } } },
    orderBy: { sortOrder: "asc" },
  });
  return links
    .map((link) => link.group)
    .filter((group) => group && !group.deletedAt && group.isActive !== false)
    .map(serializeGroup);
}

/**
 * Every dish's groups in one query, for the menu board.
 *
 * A board of 200 dishes asking per dish is 200 round trips to draw a screen, and
 * the guest page redraws it on every stock change.
 */
export async function addonGroupsByProduct(shopId) {
  const links = await db.productAddonGroup.findMany({
    where: { shopId },
    include: { group: { include: { options: true } } },
    orderBy: { sortOrder: "asc" },
  });
  const byProduct = new Map();
  for (const link of links) {
    if (!link.group || link.group.deletedAt || link.group.isActive === false) continue;
    if (!byProduct.has(link.productId)) byProduct.set(link.productId, []);
    byProduct.get(link.productId).push(serializeGroup(link.group));
  }
  return byProduct;
}
