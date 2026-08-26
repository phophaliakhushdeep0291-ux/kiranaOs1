/**
 * Storefront modes — the seam that lets one trade serve a different public page
 * from the same shop record.
 *
 * The customer-facing page was built for a kirana: a delivery catalogue with an
 * address, a time slot and a basket. A restaurant guest scanning the QR taped to
 * table 5 wants none of that. They are already in the building, the "address" is
 * the table they are sitting at, and what they need to read is a menu — courses,
 * veg marks, how long the kitchen takes.
 *
 * Shared code must not import the restaurant pack to find that out: shared code
 * that names one trade makes that trade's bugs and releases every shop's
 * problem, which is the rule tests/business-vertical-architecture.examples.js
 * enforces. So a vertical registers its storefront here at load time and the
 * public catalogue asks the registry instead — the same arrangement as sale
 * guards and catalogue availability filters.
 *
 * The arrow points one way. A shop whose trade registered nothing runs exactly
 * the original delivery-catalogue path and pays one array-length check for it.
 */

const modes = [];

/**
 * @param {{
 *   id: string,
 *   shapeCatalog: (context: {
 *     shopId: string,
 *     shop: object,
 *     settings: object,
 *     locationId: string | null,
 *     products: Array<object>,
 *     request: { tableCode?: string | null },
 *   }) => Promise<null | {
 *     mode: string,
 *     products?: Array<object>,
 *     table?: object | null,
 *     theme?: object,
 *     sections?: Array<object>,
 *     serviceNote?: string | null,
 *   }>,
 *   resolveOrderContext?: (context: {
 *     shopId: string,
 *     shop: object,
 *     settings: object,
 *     body: object,
 *   }) => Promise<null | {
 *     fulfillmentType?: string,
 *     tableId?: string | null,
 *     tableName?: string | null,
 *     guestCount?: number | null,
 *     requiresAddress?: boolean,
 *   }>,
 *   resolveTerminal?: (context: {
 *     shopId: string,
 *     terminalCode: string,
 *   }) => Promise<object | null>,
 * }} mode
 *   `shapeCatalog` returns null when this trade does not claim the shop, which
 *   is how one registry serves eleven trades without any of them knowing about
 *   the others.
 */
export function registerStorefrontMode(mode) {
  if (!mode || typeof mode.shapeCatalog !== "function") {
    throw new TypeError("A storefront mode must provide shapeCatalog()");
  }
  modes.push(mode);
}

/**
 * Ask each registered trade whether this shop's storefront is theirs.
 *
 * The FIRST claim wins and stops the rest. A shop has exactly one trade, so a
 * second claim would be a registry bug rather than a case to merge — and
 * merging two storefronts would produce a page belonging to neither.
 */
export async function shapeStorefrontCatalog(context) {
  if (modes.length === 0) return null;
  for (const mode of modes) {
    const shaped = await mode.shapeCatalog(context);
    if (shaped) return { ...shaped, mode: shaped.mode ?? mode.id };
  }
  return null;
}

/** What a trade needs recorded on an order placed from its storefront. */
export async function resolveStorefrontOrderContext(context) {
  if (modes.length === 0) return null;
  for (const mode of modes) {
    if (typeof mode.resolveOrderContext !== "function") continue;
    const resolved = await mode.resolveOrderContext(context);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Let the trade canonicalise the lines its storefront accepts.
 *
 * Shared ordering still owns identity, availability and persistence. A mode
 * only adds semantics a shelf cannot know about, such as portions and options.
 * Null means use the ordinary productId + quantity path.
 */
export async function prepareStorefrontOrderLines(context) {
  if (modes.length === 0) return null;
  for (const mode of modes) {
    if (typeof mode.prepareOrderLines !== "function") continue;
    const prepared = await mode.prepareOrderLines(context);
    if (prepared) return prepared;
  }
  return null;
}

/**
 * Resolve a public self-order terminal without teaching the shared public route
 * which trade owns it. A resolver returns null when the code is not one of its
 * terminals, allowing future verticals to register their own unattended mode.
 */
export async function resolveStorefrontTerminal(context) {
  if (modes.length === 0) return null;
  for (const mode of modes) {
    if (typeof mode.resolveTerminal !== "function") continue;
    const resolved = await mode.resolveTerminal(context);
    if (resolved) return resolved;
  }
  return null;
}

/** Optional guest-order policy owned by the trade that claims this shop. */
export async function resolveStorefrontCancellationPolicy(context) {
  if (modes.length === 0) return null;
  for (const mode of modes) {
    if (typeof mode.resolveCancellationPolicy !== "function") continue;
    const resolved = await mode.resolveCancellationPolicy(context);
    if (resolved) return resolved;
  }
  return null;
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetStorefrontModes() {
  modes.length = 0;
}
