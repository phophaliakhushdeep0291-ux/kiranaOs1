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

/**
 * Normalise a shopkeeper's sentence for matching.
 *
 * Devanagari has no case and its own punctuation, and roman Hinglish arrives
 * with whatever the keyboard produced, so everything is lowercased and stripped
 * to spaces. Substring matching then works for both scripts without needing
 * word boundaries that Devanagari does not have.
 */
function normalise(text) {
  // \p{M} is load-bearing. Devanagari vowel signs are combining marks, not
  // letters, so stripping to \p{L}\p{N} alone turns बिल into "ब ल" and every
  // Hindi keyword stops matching. The failure is silent — routing just falls
  // back to the full set — so it costs tokens rather than correctness, which is
  // exactly the kind of bug that survives for months.
  return ` ${String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim()} `;
}

/**
 * Which of this caller's tools are worth their weight on this turn.
 *
 * Every request re-sends every tool definition, and fourteen of them is roughly
 * 1,850 tokens before the shopkeeper has said anything. On a free provider tier
 * that is the difference between a counter that answers and one that is rate
 * limited mid-shift.
 *
 * The bias is deliberately toward offering too much rather than too little. A
 * tool wrongly included costs a few hundred tokens; a tool wrongly withheld
 * makes the assistant claim it cannot do something it can, and the shopkeeper
 * has no way to tell the difference from a real limitation. So:
 *
 *   - a message matching nothing gets EVERY tool, because no signal is not the
 *     same as a signal to narrow;
 *   - `always` tools are in every turn, since resolving a product or a customer
 *     is the first step of most things;
 *   - and the caller keeps the full set to retry with, so a bad route is
 *     recoverable rather than a dead end.
 */
export function routeTools(available, message) {
  const haystack = normalise(message);
  if (haystack.trim().length === 0) return available;

  const matched = available.filter((tool) => tool.always || tool.keywords.some((word) => haystack.includes(word)));
  const routed = matched.filter((tool) => !tool.always);

  // Nothing in the sentence pointed anywhere. Narrowing here would be guessing.
  if (routed.length === 0) return available;
  return matched;
}

export function providerToolsFor(ctx, message) {
  const available = toolsFor(ctx);
  return routeTools(available, message).map(toProviderTool);
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
