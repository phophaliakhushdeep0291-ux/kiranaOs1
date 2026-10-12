import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { toolsFor } from "../tool-registry.js";
import { WORKFLOWS, workflowAvailable } from "../workflow-directory.js";

export const WORKFLOW_TOOLS = [
  defineTool({
    name: "get_available_tasks", always: true, kind: "read", risk: TOOL_RISK.SAFE,
    description: "Check which change actions this shop and current role can actually execute. Use for capability questions; never claim to do every task. Other work needs a get_workflow handoff to the right screen. This is information, not execution.",
    handler: async (_args, ctx) => ({ actions: toolsFor(ctx).filter(tool => tool.kind === "write").map(tool => tool.name) }),
  }),
  defineTool({
    name: "get_workflow", always: true, kind: "read", risk: TOOL_RISK.SAFE,
    description: "Offer buttons to the exact app screens for work that has no executable assistant tool, or when asked to open a screen. Covers purchases, returns/refunds, checkout, stock receiving/removal/transfers/counts, staff, taxes, printer, Tally/accounting, settings, backups and each trade's workflows. Select up to three destinations by meaning. This DOES NOT perform the task or fill the form: tell the user it remains to be done in that screen. Prefer an executable tool when the requested action is supported. Never accept or invent a URL.",
    parameters: { type: "object", additionalProperties: false, properties: {
      workflows: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: WORKFLOWS.map(row => row.id) } },
    }, required: ["workflows"] },
    handler: async ({ workflows }, ctx) => ({ workflows: WORKFLOWS.filter(row => workflows.includes(row.id) && workflowAvailable(row, ctx)).map(row => row.id) }),
  }),
];
