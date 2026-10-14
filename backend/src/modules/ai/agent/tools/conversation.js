import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { BUSINESS_HELP, CLARIFICATIONS } from "../business-help.js";

export const CONVERSATION_TOOLS = [
  defineTool({
    name: "get_app_help", always: true, kind: "read", risk: TOOL_RISK.SAFE,
    description: "Read reviewed KiranaOS help and business guidance: HOW TO use the app, understand profit versus cash, plan stock or investigate sales. Choose up to three topics by meaning, in any language or spelling. General guidance is not a diagnosis of this shop. Combine with data tools for actual balances, prices or reports. Never propose a write merely because someone asks how to do it.",
    parameters: { type: "object", additionalProperties: false, properties: {
      topics: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: Object.keys(BUSINESS_HELP) } },
    }, required: ["topics"] },
    handler: async ({ topics }) => ({ topics, guidance: topics.map((topic) => BUSINESS_HELP[topic]?.en).filter(Boolean) }),
  }),
  defineTool({
    name: "request_clarification", always: true, kind: "read", risk: TOOL_RISK.SAFE,
    description: "Ask one focused question when information is missing or multiple records match. Select the missing field; the server shows a verified question to the user. Use this instead of guessing IDs, dates, quantities or writing a question as prose, which is not displayed. For choice, first read matching records so the user can see the options.",
    parameters: { type: "object", additionalProperties: false, properties: {
      field: { type: "string", enum: Object.keys(CLARIFICATIONS) },
    }, required: ["field"] },
    handler: async ({ field }) => ({ field, question: CLARIFICATIONS[field]?.en }),
  }),
];
