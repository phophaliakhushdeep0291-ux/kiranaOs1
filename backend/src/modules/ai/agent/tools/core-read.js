/**
 * What the agent may look up before it says or proposes anything.
 *
 * These are the tools that make the difference between a classifier and an
 * assistant. The single-shot parser is handed a slice of the catalogue and must
 * answer from it; it can never say what last week's profit was, who owes the
 * most, or whether sugar is about to run out, because it cannot ask. With reads,
 * the model gathers evidence first and answers from real rows.
 *
 * Every handler goes through the same service functions the HTTP routes use, so
 * location scoping, soft deletes and money formatting behave identically. Each
 * takes ctx.shopId as its first argument and never a model-supplied one.
 *
 * Results are trimmed hard. A thousand products is not more useful to the model
 * than the right twenty, and every row spent is context the reasoning does not
 * get.
 */
import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { listProducts, getProduct } from "../../../products/products.service.js";
import { listCustomers, getKhata } from "../../../customers/customers.service.js";
import { getUdharSummary } from "../../../udhar/udhar.service.js";
import {
  getSalesSummary,
  getTopProducts,
  getInventoryHealth,
  getDailyClosing,
} from "../../../reports/reports.service.js";

const MAX_ROWS = 25;

/** A product as the model should see it: identity, what it costs, what is left. */
function productRow(product) {
  return {
    id: product.id,
    name: product.name,
    unit: product.rateUnit ?? product.unit ?? null,
    stock: product.stockBaseQty ?? null,
    tracksStock: product.stockTrackingEnabled !== false,
    price: product.defaultPricePerRateUnit ?? null,
    mrp: product.mrp ?? null,
    lowStockAt: product.reorderLevel ?? null,
  };
}

const RANGE = {
  type: "string",
  enum: ["today", "yesterday", "week", "month", "quarter", "year"],
  description: "Named period to report on. Use this unless the shopkeeper gave explicit dates.",
};

export const CORE_READ_TOOLS = [
  defineTool({
    name: "search_products",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Search this shop's catalogue by name or alias and return matching products with their stock, unit and price. Use this to resolve any product the shopkeeper names before referring to it, and to check whether something exists at all.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: { type: "string", description: "Name, partial name or spoken alias, e.g. 'chini' or 'sugar'." },
        lowStockOnly: { type: "boolean", description: "Only products at or below their reorder level." },
      },
      required: ["search"],
    },
    handler: async ({ search, lowStockOnly }, ctx) => {
      const products = await listProducts(ctx.shopId, {
        search,
        lowStock: lowStockOnly === true ? true : undefined,
      });
      return {
        matchCount: products.length,
        products: products.slice(0, MAX_ROWS).map(productRow),
        truncated: products.length > MAX_ROWS,
      };
    },
  }),

  defineTool({
    name: "get_product_detail",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Read one product in full by its id, including cost, GST rate, batch and pack details. Call search_products first to get the id; never guess one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { productId: { type: "string", description: "Product id from search_products." } },
      required: ["productId"],
    },
    handler: async ({ productId }, ctx) => {
      const product = await getProduct(ctx.shopId, productId);
      if (!product) return { found: false };
      return { found: true, product };
    },
  }),

  defineTool({
    name: "find_customer",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Find customers of this shop by name or mobile number. Use it to resolve who the shopkeeper means before showing a balance or proposing anything against an account.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { search: { type: "string", description: "Name or mobile number, full or partial." } },
      required: ["search"],
    },
    handler: async ({ search }, ctx) => {
      const customers = await listCustomers(ctx.shopId, { search });
      return {
        matchCount: customers.length,
        customers: customers.slice(0, MAX_ROWS).map((customer) => ({
          id: customer.id,
          name: customer.name,
          mobile: customer.mobile,
          udharBalance: customer.udharBalance ?? customer.balance ?? null,
        })),
        truncated: customers.length > MAX_ROWS,
      };
    },
  }),

  defineTool({
    name: "get_customer_khata",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Read one customer's udhar (credit) account: what they owe now and their recent ledger entries. Call find_customer first to get the id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { customerId: { type: "string", description: "Customer id from find_customer." } },
      required: ["customerId"],
    },
    handler: async ({ customerId }, ctx) => {
      const khata = await getKhata(ctx.shopId, customerId);
      const entries = Array.isArray(khata?.entries) ? khata.entries : khata?.ledger ?? [];
      return { ...khata, entries: entries.slice(0, MAX_ROWS) };
    },
  }),

  defineTool({
    name: "get_udhar_summary",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Total outstanding credit across every customer of this shop, with the largest debtors. Use it for 'how much is out on udhar' and 'who owes me the most'.",
    handler: async (_args, ctx) => getUdharSummary(ctx.shopId),
  }),

  defineTool({
    name: "get_sales_summary",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Sales totals for a period: revenue, bill count, and profit when the shopkeeper is entitled to see it. This is the tool for 'how much did I sell', 'what was this month', 'compare to last week'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        range: RANGE,
        from: { type: "string", description: "Start date YYYY-MM-DD. Only when the shopkeeper gave explicit dates." },
        to: { type: "string", description: "End date YYYY-MM-DD." },
        includeProfit: { type: "boolean", description: "Include profit figures. Owner and admin only." },
      },
    },
    handler: async ({ range, from, to, includeProfit }, ctx) => getSalesSummary(ctx.shopId, {
      range: range ?? (from || to ? undefined : "today"),
      from,
      to,
      // Profit is owner-shaped information. A staff member asking is answered
      // with revenue, not refused, because the question is reasonable and the
      // number simply is not theirs.
      includeProfit: includeProfit === true && (ctx.role === "owner" || ctx.role === "admin"),
    }),
  }),

  defineTool({
    name: "get_top_products",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "The best-selling products over a period, by quantity and value. Use it for 'what sells most', 'what should I reorder', 'which item makes me the most'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD." },
        to: { type: "string", description: "End date YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
    handler: async ({ from, to, limit }, ctx) => getTopProducts(ctx.shopId, {
      from,
      to,
      limit: Math.min(limit ?? 10, MAX_ROWS),
      includeProfit: ctx.role === "owner" || ctx.role === "admin",
    }),
  }),

  defineTool({
    name: "get_inventory_health",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "Stock health for the shop: what is low, what is out, and what has not moved. Use it for 'what is running out', 'what should I order', 'what is stuck'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        windowDays: { type: "integer", minimum: 1, maximum: 365, description: "Days of movement to consider. Default 30." },
      },
    },
    handler: async ({ windowDays }, ctx) => getInventoryHealth(ctx.shopId, {
      windowDays: windowDays ?? 30,
      includeCost: ctx.role === "owner" || ctx.role === "admin",
    }),
  }),

  defineTool({
    name: "get_daily_closing",
    kind: "read",
    risk: TOOL_RISK.SAFE,
    description:
      "The day's close for one date: cash and digital collected, udhar given, and the bill count. Use it for 'how did today go' and end-of-day questions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { date: { type: "string", description: "YYYY-MM-DD. Defaults to today." } },
    },
    handler: async ({ date }, ctx) => getDailyClosing(ctx.shopId, { date }),
  }),
];
