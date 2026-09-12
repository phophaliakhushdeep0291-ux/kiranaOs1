import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getSizeRunSummary } from "../sizes/sizes.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "footwear_workflow_summary",
  keywords: ["size", "pair", "shoe", "साइज़", "जोड़ी"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "footwear_size_runs",
  description: "Read this shop's footwear size runs, missing sizes and pair stock. Report only values returned by this register.",
  handler: async (_args, ctx) => getSizeRunSummary(ctx.shopId),
})];
registerTools("footwear", TRADE_TOOLS);
