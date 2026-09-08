import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { overview } from "../manufacturing.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "manufacturing_workflow_summary",
  keywords: ["production", "bom", "manufacturing", "quality", "उत्पादन", "बैच"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: null,
  description: "Read this shop's manufacturing BOMs, production runs, quality holds and recent batches. Report only values returned by this register.",
  handler: async (_args, ctx) => overview(ctx.shopId),
})];
registerTools("manufacturing", TRADE_TOOLS);
