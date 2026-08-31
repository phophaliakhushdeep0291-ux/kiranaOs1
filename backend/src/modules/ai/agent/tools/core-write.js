/**
 * What the agent may propose. Nothing here runs on the model's say-so.
 *
 * A write tool is never executed inside the agent loop. The loop collects it
 * into a plan, the plan is shown to the shopkeeper as sentences, and only an
 * explicit confirmation from the client executes it. That ordering is the whole
 * safety story: a model that is wrong, or that has been steered by a hostile
 * product name sitting in the shop's own catalogue, still cannot move money or
 * stock without a person agreeing to a sentence they can read.
 *
 * `summarize` is therefore not decoration. It is the text a shopkeeper says yes
 * to, so it names the real thing and the real number — never "update product",
 * always "change Sugar's price from ₹42 to ₹45 per kg".
 *
 * Handlers call the same services the routes call, so the stock ledger, audit
 * rows and sync events are written exactly as a manual edit would write them.
 */
import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { createCustomer, recordUdharPayment } from "../../../customers/customers.service.js";
import { updateProduct, getProduct, listProducts, legacySellingUnit } from "../../../products/products.service.js";
import { correctStock } from "../../../inventory/inventory.service.js";
import { AppError } from "../../../../shared/errors/index.js";
import {
  baseUnitFor,
  isKnownPackUnit,
  knownPackUnits,
  normalisePackUnit,
  sellingUnitConversion,
} from "../../../products/pack-units.js";

/** Rupee formatting for a confirmation line the shopkeeper reads aloud. */
function rs(paiseOrRupees) {
  const value = Number(paiseOrRupees);
  if (!Number.isFinite(value)) return "?";
  return `₹${value.toLocaleString("en-IN")}`;
}

/** The identity every service wants so its audit row names a person, not "system". */
function actorOf(ctx) {
  return { actorUserId: ctx.userId ?? null, deviceId: ctx.deviceId ?? null };
}

/**
 * Resolve one spoken item to a real catalogue row.
 *
 * Exact name first, then a prefix, then a contains match — a shopkeeper saying
 * "sugar" in a shop that stocks "Sugar" and "Sugar Free" means the first, and
 * ranking by length rather than taking whatever the database returned first is
 * what makes that reliable. Ambiguity is reported rather than resolved: two
 * plausible matches come back as a question, because putting the wrong item on
 * a bill costs the shop a refund and an argument at the counter.
 */
async function resolveBillItem(shopId, { query, quantity, unit }) {
  const matches = await listProducts(shopId, { search: query });
  if (matches.length === 0) return { query, resolved: false, reason: "no_match" };

  const wanted = String(query).trim().toLowerCase();
  const exact = matches.filter((product) => String(product.name).toLowerCase() === wanted);
  const prefix = matches.filter((product) => String(product.name).toLowerCase().startsWith(wanted));
  const shortlist = exact.length ? exact : prefix.length ? prefix : matches;
  const ranked = [...shortlist].sort((a, b) => String(a.name).length - String(b.name).length);

  if (exact.length === 0 && ranked.length > 1) {
    const [first, second] = ranked;
    // Two candidates of the same length are genuinely indistinguishable from the
    // word alone. A different length means one is the plain item and the other a
    // variant, and the plain one is what was asked for.
    if (String(first.name).length === String(second.name).length) {
      return { query, resolved: false, reason: "ambiguous", candidates: ranked.slice(0, 5).map((p) => p.name) };
    }
  }

  const product = ranked[0];
  return {
    query,
    resolved: true,
    productId: product.id,
    name: product.name,
    quantity,
    unit: unit || product.rateUnit || product.baseUnit || "piece",
    rate: product.defaultPricePerRateUnit ?? 0,
    stock: product.stockBaseQty ?? null,
    tracksStock: product.stockTrackingEnabled !== false,
  };
}

/** A stored selling unit, carried back verbatim so nothing about it is lost. */
function carryUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    unitType: unit.unitType,
    unitCode: unit.unitCode,
    packSizeValue: unit.packSizeValue,
    packSizeUnit: unit.packSizeUnit,
    conversionToBase: unit.conversionToBase,
    barcode: unit.barcode,
    sku: unit.sku,
    defaultPrice: unit.defaultPrice,
    minimumPrice: unit.minimumPrice,
    maximumPrice: unit.maximumPrice,
    costPrice: unit.costPrice,
    onHandQty: unit.onHandQty,
    lowStockThreshold: unit.lowStockThreshold,
    reorderLevel: unit.reorderLevel,
    variantValue1: unit.variantValue1,
    variantValue2: unit.variantValue2,
    isDefault: unit.isDefault,
    isActive: unit.isActive,
  };
}

export const CORE_WRITE_TOOLS = [
  defineTool({
    name: "set_pack_size",
    keywords: [
      "packet", "pack", "size", "pouch", "bottle", "box", "sachet", "tin",
      "500", "250", "100", "1kg", "half kg", "loose",
      "पैकेट", "पैक", "साइज", "साइज़", "पाउच", "डिब्बा", "बोतल", "खुला",
    ],
    kind: "write",
    risk: TOOL_RISK.OWNER_PIN,
    description:
      "Add a new pack size to a product, or change the price of a pack size it already sells — a 500 gram packet, a 1 litre bottle. Read the product first so the proposal states what it already sells. Use the exact measure the shopkeeper said.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        productId: { type: "string", description: "Product id from search_products." },
        packSize: { type: "number", exclusiveMinimum: 0, description: "How much is in one pack, e.g. 500." },
        packUnit: {
          type: "string",
          description: "The measure of the pack size, exactly as the shopkeeper said it: gram, kg, ml, litre, piece, dozen. Do not convert it yourself.",
        },
        price: { type: "number", minimum: 0, description: "Selling price for ONE pack, in rupees." },
        packType: {
          type: "string",
          enum: ["packet", "pouch", "box", "bottle", "jar", "can", "sachet", "piece"],
          description: "What the pack is. Defaults to packet.",
        },
      },
      required: ["productId", "packSize", "packUnit", "price"],
    },
    summarize: ({ productId, packSize, packUnit, price, packType }, ctx) =>
      `Sell ${ctx.labelFor?.(productId) ?? "this product"} in a ${packSize} ${packUnit} ${packType ?? "packet"} at ${rs(price)}`,
    handler: async ({ productId, packSize, packUnit, price, packType }, ctx) => {
      const product = await getProduct(ctx.shopId, productId);
      if (!product) throw new AppError("That product was not found", 404, "PRODUCT_NOT_FOUND");

      // The conversion falls back to a factor of 1 on a measure it does not
      // know, which for free text is how "500 gm" becomes a 500-PIECE pack that
      // takes 500 off the shelf per sale. So an unknown measure is refused
      // rather than guessed, and the refusal says what is accepted.
      const unit = normalisePackUnit(packUnit);
      if (!isKnownPackUnit(unit)) {
        throw new AppError(
          `"${packUnit}" is not a pack measure this shop can price. Use one of: ${knownPackUnits().join(", ")}.`,
          400,
          "PACK_UNIT_UNKNOWN",
        );
      }

      // A pack must be counted in the same measure the product's stock is. A
      // gram pack on a product counted in pieces would depress stock by 500 per
      // sale and read as a plausible number the whole way down.
      const productBase = baseUnitFor(product.baseUnit ?? "piece");
      const packBase = baseUnitFor(unit);
      if (productBase !== packBase) {
        throw new AppError(
          `This product's stock is counted in ${product.baseUnit ?? "piece"}, so it cannot be sold in a ${packUnit} pack.`,
          400,
          "PACK_UNIT_MISMATCH",
        );
      }

      const conversionToBase = sellingUnitConversion(packSize, unit);
      if (!(conversionToBase > 0)) throw new AppError("That pack size works out to nothing", 400, "PACK_SIZE_INVALID");

      // writeSellingUnits deactivates every unit NOT in the list it is given, so
      // the existing ones are carried back untouched. Sending only the new pack
      // would quietly retire every size the shop already sells.
      //
      // A product with NO explicit units is the dangerous case, and it is the
      // common one: most of a kirana catalogue is sold loose by its rate unit
      // with no ProductSellingUnit row at all. Send just the packet and
      // normalizeSellingUnits makes it the default, then
      // applyDefaultSellingUnitToProduct copies its type and price onto the
      // product — Sugar at Rs45 a kg silently becomes Sugar at Rs24 a packet,
      // and the shop can no longer weigh it out loose. So the loose unit is
      // materialised first, from the same helper the product form uses.
      const stored = Array.isArray(product.sellingUnits) ? product.sellingUnits : [];
      const existing = stored.length > 0
        ? stored
        : [{ ...legacySellingUnit(product), isDefault: true, isActive: true }];
      const type = packType ?? "packet";
      const matches = (row) => String(row.unitType).toLowerCase() === type
        && Number(row.packSizeValue) === Number(packSize)
        && normalisePackUnit(row.packSizeUnit) === unit;

      const updating = existing.find(matches) ?? null;
      const units = existing.map((row) => (matches(row)
        ? { ...carryUnit(row), defaultPrice: price, conversionToBase, isActive: true }
        : carryUnit(row)));

      if (!updating) {
        units.push({
          name: `${type} ${packSize} ${unit}`,
          unitType: type,
          packSizeValue: packSize,
          packSizeUnit: unit,
          conversionToBase,
          defaultPrice: price,
          // A new pack never seizes default: the till's existing default is what
          // the counter reaches for, and moving it is a separate decision.
          isDefault: false,
          isActive: true,
        });
      }

      const saved = await updateProduct(ctx.shopId, productId, { sellingUnits: units }, { actor: actorOf(ctx) });
      return {
        productId,
        name: saved?.name ?? product.name,
        action: updating ? "updated" : "added",
        pack: { size: packSize, unit, type, price, conversionToBase },
        packsNowSold: (saved?.sellingUnits ?? []).filter((row) => row.isActive !== false).length,
      };
    },
  }),

  defineTool({
    name: "add_items_to_bill",
    keywords: ["bill", "cart", "add", "put", "daal", "dal do", "dalo", "jod", "chahiye", "le lo", "बिल", "जोड़", "डाल", "चाहिए", "लगा"],
    kind: "write",
    // The cart is React state on the till, persisted offline, because a shop
    // bills through a power cut. So this resolves and prices here, where the
    // catalogue and the tenant boundary are, and the till merges the lines into
    // its own cart through the same path the voice parser already uses.
    target: "client",
    risk: TOOL_RISK.CONFIRM,
    description:
      "Put items on the current bill. Give each item as the shopkeeper said it, with a quantity. Products are matched against this shop's catalogue here — do not invent a price, and do not call search_products first, this does its own lookup.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", description: "Product as spoken, e.g. \"chini\" or \"Sugar\"." },
              quantity: { type: "number", exclusiveMinimum: 0, description: "How many or how much." },
              unit: { type: "string", description: "Unit if the shopkeeper said one, e.g. kg, packet. Omit otherwise." },
            },
            required: ["query", "quantity"],
          },
        },
      },
      required: ["items"],
    },
    summarize: ({ items }) => {
      const parts = (items ?? []).map((item) => `${item.quantity}${item.unit ? ` ${item.unit}` : ""} ${item.query}`);
      return `Add ${parts.join(", ")} to the bill`;
    },
    handler: async ({ items }, ctx) => {
      const lines = [];
      const problems = [];
      for (const item of items ?? []) {
        const resolved = await resolveBillItem(ctx.shopId, item);
        if (resolved.resolved) lines.push(resolved);
        else problems.push(resolved);
      }
      return {
        // Named so the till knows what to do with it without matching on the
        // tool name, which would couple the two sides by string.
        clientAction: "add_bill_lines",
        lines,
        problems,
        addedCount: lines.length,
      };
    },
  }),

  defineTool({
    name: "create_customer",
    keywords: ["add customer", "new customer", "customer add", "register", "naya grahak", "grahak", "customer", "ग्राहक", "जोड़", "नया"],
    kind: "write",
    risk: TOOL_RISK.CONFIRM,
    description:
      "Add a new customer to this shop with a name and optional mobile number. Use only when find_customer has shown the person is not already on file.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Customer's name as the shopkeeper said it." },
        mobile: { type: "string", description: "10-digit Indian mobile number, digits only. Omit if not spoken." },
      },
      required: ["name"],
    },
    summarize: ({ name, mobile }) => `Add ${name}${mobile ? ` (${mobile})` : ""} as a new customer`,
    handler: async ({ name, mobile }, ctx) => {
      const customer = await createCustomer(
        ctx.shopId,
        { name, mobile: mobile || null },
        { actor: actorOf(ctx) },
      );
      return { customerId: customer.id, name: customer.name, mobile: customer.mobile };
    },
  }),

  defineTool({
    name: "record_udhar_payment",
    keywords: ["paid", "payment", "repaid", "received", "settle", "chukaya", "diya", "jama", "भुगतान", "चुका", "दिया", "जमा", "वापस"],
    kind: "write",
    risk: TOOL_RISK.CONFIRM,
    description:
      "Record that a customer has repaid part or all of their udhar (credit) balance. Read get_customer_khata first so the amount can be checked against what is actually owed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        customerId: { type: "string", description: "Customer id from find_customer." },
        amount: { type: "number", exclusiveMinimum: 0, description: "Amount repaid, in rupees." },
        mode: { type: "string", enum: ["cash", "upi", "card", "bank"], description: "How they paid." },
        note: { type: "string", description: "Optional note for the ledger entry." },
      },
      required: ["customerId", "amount", "mode"],
    },
    // The customer is named by the agent loop, which resolved the id in an
    // earlier read; the id itself would mean nothing to the person confirming.
    summarize: ({ amount, mode, customerId }, ctx) =>
      `Record ${rs(amount)} received by ${mode} against ${ctx.labelFor?.(customerId) ?? "this customer"}'s udhar`,
    handler: async ({ customerId, amount, mode, note }, ctx) => {
      const result = await recordUdharPayment(
        ctx.shopId,
        customerId,
        { amount, mode, note: note ?? null },
        actorOf(ctx),
      );
      return result;
    },
  }),

  defineTool({
    name: "update_product_price",
    keywords: ["price", "rate", "cost", "charge", "mrp", "daam", "rate kar", "भाव", "रेट", "दाम", "कीमत", "बदल"],
    kind: "write",
    risk: TOOL_RISK.OWNER_PIN,
    description:
      "Change a product's selling price. Read the product first so the proposal can state the old price alongside the new one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        productId: { type: "string", description: "Product id from search_products." },
        newPrice: { type: "number", minimum: 0, description: "New selling price per rate unit, in rupees." },
      },
      required: ["productId", "newPrice"],
    },
    summarize: ({ productId, newPrice }, ctx) =>
      `Change ${ctx.labelFor?.(productId) ?? "this product"}'s selling price to ${rs(newPrice)} per unit`,
    handler: async ({ productId, newPrice }, ctx) => {
      const before = await getProduct(ctx.shopId, productId);
      const updated = await updateProduct(
        ctx.shopId,
        productId,
        { defaultPricePerRateUnit: newPrice },
        { actor: actorOf(ctx) },
      );
      return {
        productId,
        name: updated?.name ?? before?.name ?? null,
        previousPrice: before?.defaultPricePerRateUnit ?? null,
        newPrice,
      };
    },
  }),

  defineTool({
    name: "correct_stock",
    keywords: ["count", "counted", "correct", "correction", "adjust", "stock set", "ginti", "स्टॉक", "गिनती", "सुधार", "ठीक", "सही"],
    kind: "write",
    risk: TOOL_RISK.OWNER_PIN,
    description:
      "Set a product's stock to a counted figure, writing a correction row to the stock ledger. Use this for 'I counted 12 bags', not for recording a sale or a purchase.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        productId: { type: "string", description: "Product id from search_products." },
        newStock: {
          type: "number",
          description:
            "The counted quantity in the product's base unit. Negative is permitted: some shops deliberately sell past zero and reconcile later.",
        },
        note: { type: "string", description: "Why the correction is being made." },
      },
      required: ["productId", "newStock"],
    },
    summarize: ({ productId, newStock }, ctx) =>
      `Correct ${ctx.labelFor?.(productId) ?? "this product"}'s counted stock to ${newStock}`,
    handler: async ({ productId, newStock, note }, ctx) => correctStock(
      ctx.shopId,
      { productId, newStockBaseQty: newStock, note: note ?? "Corrected via assistant" },
      actorOf(ctx),
    ),
  }),
];
