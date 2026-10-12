import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { listProducts } from "../../../products/products.service.js";
import { AppError } from "../../../../shared/errors/index.js";

// The till owns this write, just as it does a product entered in the form. Prices
// are per spoken selling unit; stock is converted exactly once into base units.
const UNITS = { piece: ["piece", 1], kg: ["gram", 1000], gram: ["gram", 1], litre: ["ml", 1000], ml: ["ml", 1] };
export function newProductInput(args) {
  const [baseUnit, factor] = UNITS[args.unit];
  return {
    name: args.name.trim(), displayUnit: args.unit, rateUnit: args.unit, baseUnit,
    defaultPricePerRateUnit: args.sellingPrice, costPerRateUnit: args.costPrice,
    stockBaseQty: Math.round(args.openingStock * factor * 1e6) / 1e6,
    gstRate: args.taxRate, stockTrackingEnabled: true,
    isLooseItem: baseUnit !== "piece",
    ...(args.barcode ? { barcode: args.barcode.trim() } : {}),
    ...(args.category ? { category: args.category.trim() } : {}),
  };
}

export const CREATE_PRODUCT_TOOL = defineTool({
  name: "create_product", kind: "write", target: "client", risk: TOOL_RISK.OWNER_PIN,
  roles: ["owner", "admin"], feature: "basic_products",
  excludedBusinessTypes: ["pharmacy"],
  keywords: ["product", "item", "list", "listing", "catalog", "add", "create", "new", "register", "naya", "saman", "jodo", "सामान", "जोड़", "नया", "प्रोडक्ट"],
  description: "Create a new simple product in the catalogue, saved by the till after confirmation and owner PIN. Search first for duplicates. Obtain every required field from the user, including an explicit zero for no stock, no cost or zero tax; never guess a price, unit, quantity or tax. Ask request_clarification for missing values. Only piece, kg, gram, litre or ml units: complex packs, variants and medicines use the Products form. Listing/viewing existing products is search_products, not creation.",
  parameters: { type: "object", additionalProperties: false, properties: {
    name: { type: "string", minLength: 1, maxLength: 160, pattern: "\\S" },
    unit: { type: "string", enum: Object.keys(UNITS), description: "Unit for both prices and openingStock. Do not change the spoken unit." },
    sellingPrice: { type: "number", exclusiveMinimum: 0, maximum: 1000000000 },
    costPrice: { type: "number", minimum: 0, maximum: 1000000000 },
    openingStock: { type: "number", minimum: 0, maximum: 1000000 },
    taxRate: { type: "number", minimum: 0, maximum: 100, description: "Tax percentage supplied by the owner; never infer a jurisdiction's rate." },
    barcode: { type: "string", minLength: 1, maxLength: 120 },
    category: { type: "string", minLength: 1, maxLength: 100 },
  }, required: ["name", "unit", "sellingPrice", "costPrice", "openingStock", "taxRate"] },
  summarize: ({ name, unit, sellingPrice, costPrice, openingStock, taxRate, barcode, category }) =>
    `Create ${name}: selling price ${sellingPrice}, cost ${costPrice} per ${unit} (shop currency); opening stock ${openingStock} ${unit}; tax ${taxRate}%${barcode ? `; barcode ${barcode}` : ""}${category ? `; category ${category}` : ""}`,
  handler: async (args, ctx) => {
    if (ctx.businessType === "pharmacy") throw new AppError("Use Products to enter medicine and prescription details", 422, "AI_PRODUCT_FORM_REQUIRED");
    const products = await listProducts(ctx.shopId, { search: args.name.trim() });
    const normalize = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();
    if (products.some((product) => normalize(product.name) === normalize(args.name))) {
      throw new AppError("A product with this name already exists. Review it in Products.", 409, "PRODUCT_NAME_DUPLICATE");
    }
    return { clientAction: "create_product", product: newProductInput(args) };
  },
});
