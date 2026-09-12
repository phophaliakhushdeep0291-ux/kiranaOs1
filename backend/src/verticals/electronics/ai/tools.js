import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getUnitSummary } from "../units/units.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "electronics_workflow_summary",
  keywords: ["serial", "imei", "warranty", "service", "वारंटी", "सीरियल"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "serial_imei_tracking",
  description: "Read this shop's serialized devices, IMEI stock, warranty and service units. Report only values returned by this register.",
  handler: async (_args, ctx) => getUnitSummary(ctx.shopId),
})];
registerTools("electronics", TRADE_TOOLS);
