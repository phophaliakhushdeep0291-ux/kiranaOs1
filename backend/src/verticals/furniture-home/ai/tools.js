import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getOrderSummary } from "../orders/orders.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "furniture_workflow_summary",
  keywords: ["quotation", "order", "advance", "delivery", "फर्नीचर", "अग्रिम"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "furniture_order_book",
  description: "Read this shop's showroom quotations, orders, advances, balances and overdue delivery. Report only values returned by this register.",
  handler: async (_args, ctx) => getOrderSummary(ctx.shopId),
})];
registerTools("furniture", TRADE_TOOLS);
