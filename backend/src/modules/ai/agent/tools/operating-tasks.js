import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { listSuppliers } from "../../../suppliers/suppliers.service.js";
import { createExpenseSchema } from "../../../expenses/expenses.schema.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../../utils/dates.js";
import { env } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/index.js";

const text = (maxLength) => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const normalize = value => String(value).trim().replace(/\s+/g, " ").toLowerCase();

export const OPERATING_TASK_TOOLS = [
  defineTool({
    name: "find_supplier", kind: "read", risk: TOOL_RISK.SAFE,
    keywords: ["supplier", "vendor", "wholesaler", "distributor", "supply", "सप्लायर", "विक्रेता"],
    description: "Find suppliers by name or phone before creating a supplier. Empty search lists at most 25 with the total match count. This does not read supplier balances or make payments.",
    parameters: { type: "object", additionalProperties: false, properties: { search: { type: "string", maxLength: 120 } }, required: ["search"] },
    handler: async ({ search }, ctx) => {
      const wanted = normalize(search);
      const matches = (await listSuppliers(ctx.shopId)).filter(row => normalize(row.name).includes(wanted) || normalize(row.mobile ?? "").includes(wanted));
      return { matchCount: matches.length, suppliers: matches.slice(0, 25).map(({ id, name, mobile }) => ({ id, name, mobile })), truncated: matches.length > 25 };
    },
  }),
  defineTool({
    name: "create_supplier", kind: "write", target: "client", risk: TOOL_RISK.CONFIRM,
    keywords: ["supplier", "vendor", "wholesaler", "distributor", "सप्लायर", "विक्रेता"],
    description: "Create a supplier through the till's offline-first service after confirmation. Search suppliers first; do not create duplicates. Name is required, phone and address optional only if supplied. GST registration and opening balances require the Suppliers form, not invented defaults.",
    parameters: { type: "object", additionalProperties: false, properties: {
      name: text(120), mobile: { type: "string", pattern: "^[0-9]{10}$", description: "Current supplier form accepts 10 digits. For other formats use the Suppliers screen; never truncate or invent a number." }, address: text(500),
    }, required: ["name"] },
    summarize: ({ name, mobile, address }) => `Create supplier ${name}${mobile ? `; phone ${mobile}` : ""}${address ? `; address ${address}` : ""}`,
    handler: async ({ name, mobile, address }, ctx) => {
      const existing = await listSuppliers(ctx.shopId);
      if (existing.some(row => normalize(row.name) === normalize(name) || (mobile && row.mobile === mobile))) {
        throw new AppError("A matching supplier already exists. Review Suppliers.", 409, "SUPPLIER_DUPLICATE");
      }
      return { clientAction: "create_supplier", supplier: { name: name.trim(), ...(mobile ? { mobile } : {}), ...(address ? { address: address.trim() } : {}) } };
    },
  }),
  defineTool({
    name: "create_expense", kind: "write", target: "client", risk: TOOL_RISK.CONFIRM,
    keywords: ["expense", "spent", "rent", "salary", "electricity", "kharcha", "kharche", "खर्च", "किराया", "वेतन"],
    description: "Record a one-off expense on the current counter branch after confirmation. Obtain title, amount in shop currency, category, payment method, paid/pending status and date explicitly; ask for missing details. Date may resolve from the user's today/yesterday using the supplied current date. This records an expense, never transfers money. Recurring schedules and changes to existing expenses require Expenses screen.",
    parameters: { type: "object", additionalProperties: false, properties: {
      title: text(160), amount: { type: "number", exclusiveMinimum: 0, maximum: 1000000000 }, category: text(60),
      paymentMode: { type: "string", enum: ["cash", "upi", "bank", "card", "other"] },
      status: { type: "string", enum: ["paid", "pending"] },
      date: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, vendor: text(160), notes: text(500),
    }, required: ["title", "amount", "category", "paymentMode", "status", "date"] },
    summarize: ({ title, amount, category, paymentMode, status, date, vendor, notes }) =>
      `Record expense ${title}: ${amount} (shop currency); ${category}; ${status}; ${paymentMode}; ${date}; current counter branch${vendor ? `; vendor ${vendor}` : ""}${notes ? `; note ${notes}` : ""}`,
    handler: async ({ date, ...args }) => {
      if (Math.abs(args.amount * 100 - Math.round(args.amount * 100)) > 0.0001) throw new AppError("Expense amount needs at most two decimal places", 400, "INVALID_AMOUNT");
      const start = dateRangeForDateOnly(date, env.DAILY_CLOSING_TIMEZONE).start;
      if (formatDateInTimeZone(start, env.DAILY_CLOSING_TIMEZONE) !== date) throw new AppError("Invalid expense date", 400, "INVALID_DATE");
      const expense = { ...args, title: args.title.trim(), category: args.category.trim(), spentAt: start.toISOString(), recurringInterval: "none" };
      // Same schema as manual creation. The till supplies the stable action key.
      createExpenseSchema.parse({ ...expense, idempotencyKey: "assistant-validation" });
      return { clientAction: "create_expense", expense };
    },
  }),
];
