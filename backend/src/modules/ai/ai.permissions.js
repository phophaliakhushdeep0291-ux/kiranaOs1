/**
 * AI Permission Engine
 *
 * OpenAI never touches the DB or DOM directly.
 * It returns a JSON command. This module decides what happens next.
 *
 * Permission levels:
 *   safe       → execute immediately, no user confirmation needed
 *   confirm    → show confirmation dialog to user before executing
 *   owner_pin  → require owner PIN before executing
 *   blocked    → reject immediately, log the attempt
 */

// Map of intent → permission level
const INTENT_PERMISSIONS = {
  // SAFE — immediate execution
  SEARCH_PRODUCT:    "safe",
  ADD_ITEMS:         "safe",
  REMOVE_ITEM:       "safe",
  UPDATE_QUANTITY:   "safe",
  SET_CUSTOMER:      "safe",
  OPEN_REPORTS:      "safe",
  OPEN_INVENTORY:    "safe",
  SHOW_KHATA:        "safe",

  // CONFIRM — ask user before running
  CREATE_CUSTOMER:   "confirm",
  SET_PAYMENT:       "confirm",
  APPLY_DISCOUNT:    "confirm",
  CONFIRM_BILL:      "confirm",

  // OWNER PIN — sensitive operations
  CANCEL_BILL:       "owner_pin",
  UPDATE_PRODUCT_PRICE: "owner_pin",
  ADJUST_STOCK:      "owner_pin",
  DELETE_PRODUCT:    "owner_pin",
  EXPORT_DATA:       "owner_pin",
};

/**
 * Returns the permission level for a given intent.
 * Unknown intents are blocked.
 */
export function getPermissionLevel(intent) {
  return INTENT_PERMISSIONS[intent] ?? "blocked";
}

/**
 * Full permission check for a parsed AI command.
 * Returns { allowed: boolean, level: string, reason?: string }
 */
export function checkPermission(parsedCommand) {
  const { intent } = parsedCommand;

  if (!intent) {
    return { allowed: false, level: "blocked", reason: "No intent in parsed command" };
  }

  const level = getPermissionLevel(intent);

  if (level === "blocked") {
    return {
      allowed: false,
      level: "blocked",
      reason: `Intent "${intent}" is not a recognized or allowed action`,
    };
  }

  // safe and confirm are "allowed" (confirm just needs frontend UI step)
  // owner_pin is also allowed but execution gate is the PIN check
  return { allowed: true, level };
}
