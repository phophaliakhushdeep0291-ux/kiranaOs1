import { z } from "zod";

/**
 * Add-on groups and their options.
 *
 * The one rule worth stating here rather than in a comment on the column: a price
 * of zero is ACCEPTED. "No onion" and "less spicy" are instructions the kitchen
 * needs and the guest is not charged for, so `.nonnegative()` rather than the
 * `.positive()` that portions use — a portion priced at nothing would bill a
 * plate of food for free, an add-on priced at nothing is the normal case.
 */
const optionName = z.string().trim().min(1, "An option needs a name the guest can read").max(60);

const addonOption = z.object({
  /** Present for an option that already exists — that is what renames it in place. */
  id: z.string().trim().max(60).optional(),
  name: optionName,
  price: z.coerce.number().nonnegative("An option cannot cost less than nothing").max(1_000_000).default(0),
  /** The stock item this consumes, when it consumes one. Null = an instruction. */
  linkedProductId: z.string().trim().max(60).nullish(),
  /** Base units consumed for one option on one sold dish. */
  linkedQtyBase: z.coerce.number().positive().max(1_000_000).default(1),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export const saveAddonGroupSchema = z.object({
  name: z.string().trim().min(1, "A group needs a name, like \"Choose your bread\"").max(60),
  /** 0 = optional. 1 or more makes the group compulsory. */
  minSelect: z.coerce.number().int().min(0).max(40).default(0),
  /** 0 = no ceiling. */
  maxSelect: z.coerce.number().int().min(0).max(40).default(0),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.coerce.boolean().default(true),
  options: z.array(addonOption).max(40).default([]),
});

export const setDishAddonGroupsSchema = z.object({
  groupIds: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});
