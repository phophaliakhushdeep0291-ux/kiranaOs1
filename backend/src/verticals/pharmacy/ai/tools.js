import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getPrescriptionSummary } from "../prescriptions/prescriptions.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "pharmacy_workflow_summary",
  keywords: ["prescription", "dispense", "refill", "पर्चा", "दवा"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "prescription_tracking",
  description: "Read this shop's prescription register totals and dispensing status; never medical advice. Report only values returned by this register.",
  handler: async (_args, ctx) => getPrescriptionSummary(ctx.shopId),
})];
registerTools("pharmacy", TRADE_TOOLS);
