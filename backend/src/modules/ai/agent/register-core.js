import { PURCHASING_TOOLS } from "./tools/purchasing.js";
/**
 * Registers the tools every shop gets, whatever it sells.
 *
 * Core only. A trade's own tools are registered from that trade's directory —
 * see src/verticals/<trade>/ai/tools.js — because shared code that imported one
 * vertical would fail tests/business-vertical-architecture.examples.js, and
 * would make one trade's releases every shop's problem.
 *
 * Importing this module is what performs the registration, so it is imported
 * once from the AI route module rather than being called from a request path.
 */
import { registerTools } from "./tool-registry.js";
import { CORE_READ_TOOLS } from "./tools/core-read.js";
import { CORE_WRITE_TOOLS } from "./tools/core-write.js";
import { CONVERSATION_TOOLS } from "./tools/conversation.js";
import { OPERATING_TASK_TOOLS } from "./tools/operating-tasks.js";
import { WORKFLOW_TOOLS } from "./tools/workflows.js";

let registered = false;

export function registerCoreTools() {
  if (registered) return 0;
  registered = true;
  return registerTools("core", [...CORE_READ_TOOLS, ...PURCHASING_TOOLS, ...CORE_WRITE_TOOLS, ...CONVERSATION_TOOLS, ...OPERATING_TASK_TOOLS, ...WORKFLOW_TOOLS]);
}

registerCoreTools();
