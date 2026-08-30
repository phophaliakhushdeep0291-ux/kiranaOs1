/**
 * The set of things the agent can do, and who is allowed to see each one.
 *
 * Direction matters here. `src/modules` is shared spine, and
 * tests/business-vertical-architecture.examples.js fails the build if shared
 * code imports an individual trade — the moment it does, one trade's bugs and
 * releases become every shop's problem. So this file never reaches for a
 * vertical. Verticals reach for it:
 *
 *     src/verticals/restaurant/ai/tools.js   imports defineTool + registerTools
 *     src/app.js                             imports that module so it registers
 *
 * which is exactly how a trade's HTTP routes are already mounted. A kirana shop
 * therefore never loads a restaurant tool, and a restaurant tool cannot be named
 * by a model running for a pharmacy.
 */
import { toProviderTool, toolAvailableTo } from "./tool-contract.js";

/** name -> tool. Insertion order is stable, which keeps the model's tool list stable. */
const registry = new Map();

/** Which trade contributed a tool, for diagnostics and the isolation test. */
const ownerByTool = new Map();

/**
 * Register tools under an owner ("core", or a businessType key).
 *
 * Duplicate names throw. Two trades quietly sharing a tool name would mean one
 * shop's utterance routes into another trade's handler, which is the precise
 * failure the vertical split exists to prevent.
 */
export function registerTools(owner, tools) {
  if (!owner || typeof owner !== "string") throw new Error("registerTools: owner is required");
  for (const tool of tools) {
    const existing = ownerByTool.get(tool.name);
    if (existing) {
      throw new Error(`Tool "${tool.name}" is already registered by ${existing}; names must be globally unique`);
    }
    registry.set(tool.name, tool);
    ownerByTool.set(tool.name, owner);
  }
  return tools.length;
}

export function getTool(name) {
  return registry.get(name) ?? null;
}

export function ownerOf(name) {
  return ownerByTool.get(name) ?? null;
}

/**
 * The tools this caller may actually use, in this shop, on this plan.
 *
 * A tool the caller cannot use is not advertised. Offering a cashier a
 * price-change tool and then refusing the call teaches the model to keep trying
 * and to narrate a capability the shopkeeper does not have.
 */
export function toolsFor(ctx) {
  const available = [];
  for (const tool of registry.values()) {
    if (ownerByTool.get(tool.name) !== "core" && ownerByTool.get(tool.name) !== ctx.businessType) continue;
    if (!toolAvailableTo(tool, ctx)) continue;
    available.push(tool);
  }
  return available;
}

export function providerToolsFor(ctx) {
  return toolsFor(ctx).map(toProviderTool);
}

/** Test and diagnostic surface. Not used on a request path. */
export function registrySnapshot() {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    owner: ownerByTool.get(tool.name),
    kind: tool.kind,
    risk: tool.risk,
    feature: tool.feature,
    roles: tool.roles,
  }));
}

/** Only for tests that need a clean slate; never call this from app code. */
export function __resetRegistryForTests() {
  registry.clear();
  ownerByTool.clear();
}
