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
import { updateProduct, getProduct, listProducts } from "../../../products/products.service.js";
import { correctStock } from "../../../inventory/inventory.service.js";

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

export const CORE_WRITE_TOOLS = [
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
