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

/**
 * A product as the model should see it: identity, what it costs, what is left.
 *
 * `lowStockThreshold` and `reorderLevel` are different numbers and were being
 * conflated here. The threshold is when to worry; the reorder level is how much
 * to buy. Answering "what should I reorder" off the wrong one gives a confident
 * answer about the wrong products, so both are named for what they are.
 */
function productRow(product) {
  const stock = product.stockBaseQty ?? null;
  const lowStockAt = product.lowStockThreshold ?? null;
  return {
    id: product.id,
    name: product.name,
    unit: product.rateUnit ?? product.baseUnit ?? null,
    stock,
    tracksStock: product.stockTrackingEnabled !== false,
    price: product.defaultPricePerRateUnit ?? null,
    mrp: product.mrp ?? null,
    lowStockAt,
    reorderQty: product.reorderLevel ?? null,
    isLow: Number(lowStockAt) > 0 && Number(stock) <= Number(lowStockAt),
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
    // A read that throws on "not found" makes the model retry and then run out
    // of turns with nothing to say. Answering "found: false" lets it recover in
    // the same turn — usually by searching for the right customer instead.
    handler: async ({ customerId }, ctx) => {
      try {
        const khata = await getKhata(ctx.shopId, customerId);
        const entries = Array.isArray(khata?.entries) ? khata.entries : khata?.ledger ?? [];
        return { found: true, ...khata, entries: entries.slice(0, MAX_ROWS) };
      } catch (error) {
        if (error?.status === 404 || /not found/i.test(String(error?.message))) {
          return { found: false, hint: "No customer has that id. Call find_customer and use the id it returns." };
        }
        throw error;
      }
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
    /**
     * Trimmed on purpose. The service returns low stock, dead stock, fast and
     * slow movers, negative stock and a full valuation — handed over whole, the
     * model latches onto whichever list is longest and answers from that. In a
     * shop with no recent bills every product is "dead stock", which is true and
     * useless: the question "what should I reorder" is answered by the low-stock
     * list, so that goes first and the rest is summarised.
     */
    handler: async ({ windowDays }, ctx) => {
      const health = await getInventoryHealth(ctx.shopId, {
        windowDays: windowDays ?? 30,
        includeCost: ctx.role === "owner" || ctx.role === "admin",
      });
      /**
       * Each row says which list it came from and what its number means.
       *
       * Both halves of this are load-bearing, and both were learned the hard
       * way against a real shop. Rows carrying only `stock` and `lowStockAt`
       * read alike whichever list they came from, so a product that had simply
       * not sold was reported as "running out". And a stock of -23 was read back
       * as "23000 gram" — the minus sign dropped, turning 23 kg oversold into 23
       * kg in hand, which is the opposite of the truth about money.
       *
       * So negative rows carry the sign twice: once in `stock`, once in an
       * `oversoldBy` that cannot be read as anything else.
       */
      const brief = (rows, status) => (rows ?? []).slice(0, MAX_ROWS).map((row) => {
        const stock = Number(row.stockBaseQty);
        return {
          name: row.productName,
          stock: row.stockBaseQty,
          // Stock is counted in the base unit, which is not always the unit the
          // product is priced in. Naming it explicitly stops "3 kg of rice"
          // being reported as "3 pieces" when the two differ.
          unit: row.baseUnit ?? null,
          status,
          ...(status === "low_stock" ? { lowStockAt: row.lowStockThreshold } : {}),
          ...(status === "not_selling" ? { soldInWindow: row.quantitySoldBase } : {}),
          ...(Number.isFinite(stock) && stock < 0
            ? {
              oversoldBy: Math.abs(stock),
              meaning: `Stock is NEGATIVE. The shop sold ${Math.abs(stock)} ${row.baseUnit ?? "units"} more than it had recorded. This is not low stock and it is not stock in hand.`,
            }
            : {}),
        };
      });

      const negative = health.negativeStock ?? [];
      // An oversold product satisfies `stock <= threshold` too, so the service
      // returns it in both lists — correct for a report, ruinous for a sentence.
      // It is reported once, as oversold, because "Moong Dal is running low" is
      // a false statement about a product the shop is 23 kg short on.
      // getInventoryHealth itself is left alone: the dashboard and the inventory
      // screen read it, and this is a presentation choice, not a data one.
      const lowStock = (health.lowStock ?? []).filter((row) => !(Number(row.stockBaseQty) < 0));
      return {
        windowDays: health.windowDays,
        // What actually needs buying: stock has fallen to or below its alert level.
        lowStock: brief(lowStock, "low_stock"),
        lowStockCount: lowStock.length,
        // Sold more than was recorded. Deliberate in some shops, which reconcile
        // later — so it is reported, never corrected and never called low stock.
        negativeStock: brief(negative, "negative_stock"),
        negativeStockCount: negative.length,
        // Sold nothing in the window. In a shop with no bills yet this is every
        // product, so it is reported with that caveat rather than as a finding.
        notSellingCount: (health.deadStock ?? []).length,
        notSelling: brief(health.deadStock, "not_selling").slice(0, 10),
        totalProducts: health.totalProducts,
        note: [
          lowStock.length === 0
            ? "Nothing is at or below its low-stock threshold, so nothing needs reordering on that basis. A product with no threshold set can never appear in lowStock."
            : null,
          negative.length > 0
            ? "negativeStock is a separate thing from lowStock: those products are oversold, not running low. Report the negative figure as negative."
            : null,
        ].filter(Boolean).join(" ") || null,
      };
    },
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
