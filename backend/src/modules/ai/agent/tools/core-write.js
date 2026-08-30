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
import { updateProduct, getProduct } from "../../../products/products.service.js";
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

export const CORE_WRITE_TOOLS = [
  defineTool({
    name: "create_customer",
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
