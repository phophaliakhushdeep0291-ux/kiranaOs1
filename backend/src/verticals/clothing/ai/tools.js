import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getRentalSummary } from "../rentals/rentals.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "clothing_workflow_summary",
  keywords: ["rental", "rent", "pickup", "deposit", "किराया", "वापसी"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "clothing_rentals",
  description: "Read this shop's rental bookings, pickups, returns, deposits and late rentals. Report only values returned by this register.",
  handler: async (_args, ctx) => getRentalSummary(ctx.shopId),
})];
registerTools("clothing", TRADE_TOOLS);
