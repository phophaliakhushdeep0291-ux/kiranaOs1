import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getFitmentSummary } from "../fitment/fitment.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "auto_parts_workflow_summary",
  keywords: ["fitment", "compatibility", "part", "vehicle", "पार्ट", "वाहन"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "vehicle_fitment",
  description: "Read this shop's vehicle fitment coverage and alternative part references. Report only values returned by this register.",
  handler: async (_args, ctx) => getFitmentSummary(ctx.shopId),
})];
registerTools("auto_parts", TRADE_TOOLS);
