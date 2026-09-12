import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getTesterSummary } from "../testers/testers.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "cosmetics_workflow_summary",
  keywords: ["tester", "shade", "cosmetic", "टेस्टर", "शेड"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "tester_stock",
  description: "Read this shop's counter testers, replacements, tester cost and age. Report only values returned by this register.",
  handler: async (_args, ctx) => getTesterSummary(ctx.shopId),
})];
registerTools("cosmetics", TRADE_TOOLS);
