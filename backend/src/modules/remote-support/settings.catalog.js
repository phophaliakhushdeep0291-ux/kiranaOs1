import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { validateGstin } from "../../utils/gst.js";

// The settings a remote operator may repair — and nothing else.
//
// Every other remote-support command is idempotent and local to a device: retry a
// sync, clear a cache, reload the app. This is the one that WRITES SHOP DATA, so
// it is deliberately the narrowest thing in the module. There is no generic
// "set this path to that value": each entry below names one field, validates its
// own input, and knows how to read the current value back.
//
// The bar for adding an entry is not "an operator might want this". It is:
//
//     the shop can reach a state where this is wrong AND no screen can fix it.
//
// A setting with a working settings page does not belong here — the owner (or the
// operator, talking them through it) can already change it, and every key added
// here is one more thing a support account can alter about someone's business.

export const SETTING_INPUTS = Object.freeze({
  GSTIN: "gstin",
  NONE: "none", // a reset: the repair takes no value
});

function requireLocation(shopId, locationId) {
  return db.storeLocation.findFirst({
    where: locationId ? { id: locationId, shopId } : { shopId, isPrimary: true },
    select: { id: true, name: true, code: true, gstNumber: true, gstStateCode: true, isPrimary: true },
  });
}

function parseSettings(settingsJson) {
  try {
    return JSON.parse(settingsJson ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export const SETTING_REPAIRS = Object.freeze({
  /**
   * The case this whole command exists for.
   *
   * Bills read the GSTIN from StoreLocation, but the only UI input writes
   * Shop.gstNumber, and nothing propagates between them. A primary location
   * created before the shop had a GSTIN therefore blocks every GST invoice with
   * an error that no screen in the app can clear — the owner can see the failure
   * and can see a GSTIN in their settings, and still cannot make billing work.
   */
  "location.gstNumber": {
    key: "location.gstNumber",
    label: "GSTIN on a store location",
    description:
      "Bills take the GSTIN from the store location, not from the shop profile. A location saved before the GSTIN existed blocks every GST invoice, and no screen writes this field.",
    input: SETTING_INPUTS.GSTIN,
    needsLocation: true,

    async read({ shopId, locationId = null }) {
      const location = await requireLocation(shopId, locationId);
      if (!location) return { value: null, context: null };
      return {
        value: location.gstNumber ?? null,
        context: { locationId: location.id, locationName: location.name, isPrimary: location.isPrimary },
      };
    },

    async apply({ shopId, locationId = null, value }) {
      const location = await requireLocation(shopId, locationId);
      if (!location) {
        throw new AppError("That store location does not exist.", 404, "SETTING_TARGET_MISSING");
      }

      const check = validateGstin(value);
      if (!check.valid) throw new AppError(check.reason, 400, "SETTING_VALUE_INVALID");

      const before = { gstNumber: location.gstNumber, gstStateCode: location.gstStateCode };
      // The state code is derived, never typed: a GSTIN whose first two digits
      // disagree with the stored state code produces wrong CGST/SGST vs IGST
      // splits, which is a silent tax error rather than a visible failure.
      const after = { gstNumber: check.normalized, gstStateCode: check.stateCode };

      await db.storeLocation.update({ where: { id: location.id }, data: after });
      return { before, after, target: { locationId: location.id, locationName: location.name } };
    },
  },

  /**
   * The shop-profile GSTIN. Kept separate from the location field on purpose —
   * repairing one is not the same decision as repairing the other, and quietly
   * writing both would hide which one was actually wrong.
   */
  "shop.gstNumber": {
    key: "shop.gstNumber",
    label: "GSTIN on the shop profile",
    description: "The shop-level GST number shown on the profile and used when a location has none of its own.",
    input: SETTING_INPUTS.GSTIN,
    needsLocation: false,

    async read({ shopId }) {
      const shop = await db.shop.findUnique({ where: { id: shopId }, select: { gstNumber: true } });
      return { value: shop?.gstNumber ?? null, context: null };
    },

    async apply({ shopId, value }) {
      const shop = await db.shop.findUnique({ where: { id: shopId }, select: { gstNumber: true } });
      const check = validateGstin(value);
      if (!check.valid) throw new AppError(check.reason, 400, "SETTING_VALUE_INVALID");

      const before = { gstNumber: shop?.gstNumber ?? null };
      const after = { gstNumber: check.normalized };
      await db.shop.update({ where: { id: shopId }, data: after });
      return { before, after, target: { shopId } };
    },
  },

  /**
   * The lockout escape.
   *
   * Module visibility lets an owner switch app sections off, and they vanish from
   * the sidebar, the mobile tabs, the More drawer and the dashboard shortcuts. Hide
   * the section that contains the module settings screen and there is no longer a
   * route back — the control that would undo it is the control you just hid.
   *
   * This is a RESET rather than a setter, and that is deliberate: it needs no
   * knowledge of the visibility map's internal shape, so it cannot rot as that
   * shape evolves, and it cannot be used to hide things — only to reveal them.
   */
  "settings.moduleVisibility": {
    key: "settings.moduleVisibility",
    label: "Hidden app sections (restore all)",
    description:
      "Turns every app section back on. Recovers a shop that hid the section containing the settings screen and can no longer reach it.",
    input: SETTING_INPUTS.NONE,
    needsLocation: false,

    async read({ shopId }) {
      const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
      const visibility = parseSettings(shop?.settingsJson).moduleVisibility ?? null;
      const hidden = visibility
        ? Object.entries(visibility)
            .filter(([, visible]) => visible === false)
            .map(([moduleKey]) => moduleKey)
        : [];
      return { value: hidden.length ? hidden.join(", ") : null, context: { hiddenCount: hidden.length } };
    },

    async apply({ shopId }) {
      const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
      const parsed = parseSettings(shop?.settingsJson);
      const before = { moduleVisibility: parsed.moduleVisibility ?? null };

      // Deleting the key restores the app's default (everything visible) rather
      // than writing a map of trues that would have to be kept in step with the
      // module list every time one is added.
      delete parsed.moduleVisibility;

      await db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(parsed) } });
      return { before, after: { moduleVisibility: null }, target: { shopId } };
    },
  },
});

export const SETTING_KEYS = Object.freeze(Object.keys(SETTING_REPAIRS));

export function getSettingRepair(key) {
  if (typeof key !== "string") return null;
  return Object.prototype.hasOwnProperty.call(SETTING_REPAIRS, key) ? SETTING_REPAIRS[key] : null;
}

/** Operator-facing description of the catalog, with no functions attached. */
export function describeSettingRepairs() {
  return SETTING_KEYS.map((key) => {
    const { label, description, input, needsLocation } = SETTING_REPAIRS[key];
    return { key, label, description, input, needsLocation };
  });
}
