import { defineTool, TOOL_RISK } from "../../../modules/ai/agent/tool-contract.js";
import { registerTools } from "../../../modules/ai/agent/tool-registry.js";
import { getBookListSummary } from "../book-lists/book-lists.service.js";

// Reuse the trade register's scoped summary; writes remain in its dedicated UI.
export const TRADE_TOOLS = [defineTool({
  name: "stationery_workflow_summary",
  keywords: ["school", "book list", "class", "किताब", "स्कूल"],
  kind: "read",
  risk: TOOL_RISK.SAFE,
  roles: ["owner", "admin"],
  feature: "academic_book_lists",
  description: "Read this shop's school book lists, classes and academic-year coverage. Report only values returned by this register.",
  handler: async (_args, ctx) => getBookListSummary(ctx.shopId),
})];
registerTools("stationery", TRADE_TOOLS);
