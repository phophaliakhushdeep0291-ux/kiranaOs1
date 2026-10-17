import assert from "node:assert/strict";
import { DISCOVERY_TOOL } from "../../src/modules/ai/agent/tool-discovery.js";

// Scripted providers still exercise their original business calls and security
// assertions, but first answer a real schema-discovery request when offered.
export function discoverScriptedTools(body, names) {
  if (body.tool_choice?.function?.name !== DISCOVERY_TOOL) return null;
  const selected = [...new Set(names)];
  const allowed = body.tools.find(tool => tool.function.name === DISCOVERY_TOOL).function.parameters.properties.names.items.enum;
  assert.ok(selected.length > 0 && selected.length <= 4);
  assert.ok(selected.every(name => allowed.includes(name)), "fixture must not discover an unavailable tool");
  return { choices: [{ message: { role: "assistant", tool_calls: [{
    id: "discover-fixture", type: "function", function: { name: DISCOVERY_TOOL, arguments: JSON.stringify({ names: selected }) },
  }] } }] };
}
