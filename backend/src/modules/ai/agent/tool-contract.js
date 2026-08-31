/**
 * What a tool is, and what the model is allowed to do with it.
 *
 * The single-shot parser this sits beside classifies an utterance into one of
 * eighteen intents and stops. It cannot look anything up, so it cannot answer a
 * question, and it cannot do two things in one sentence. An agent that reads
 * before it acts needs tools, and tools that touch a shop's money and stock need
 * a contract stricter than "the model asked for it".
 *
 * Three properties are structural rather than advisory:
 *
 *   Tenant isolation   A tool never accepts shopId. The JSON schema handed to the
 *                      model has no such field, so there is no token it can emit
 *                      that reaches another shop's data. The shop comes from the
 *                      authenticated request, through ctx.
 *
 *   Reads run, writes propose
 *                      A read executes inside the agent loop, because that is how
 *                      the model gathers evidence. A write NEVER executes inside
 *                      the loop. It is collected into a plan the shopkeeper
 *                      confirms, then executed by a separate call. The model can
 *                      therefore be wrong, or manipulated, without anything
 *                      being mutated on its say-so.
 *
 *   The service layer is the only door
 *                      Handlers call the same services the HTTP routes call, so
 *                      RBAC, feature gates, location access, audit and
 *                      transactions apply identically. A tool that reaches for
 *                      Prisma directly is re-implementing a guard it will get
 *                      wrong.
 */
import { AppError } from "../../../shared/errors/index.js";

/** Reused verbatim from ai.permissions.js so one vocabulary describes both paths. */
export const TOOL_RISK = Object.freeze({
  SAFE: "safe",
  CONFIRM: "confirm",
  OWNER_PIN: "owner_pin",
});

export const TOOL_RISK_VALUES = Object.freeze(Object.values(TOOL_RISK));
export const TOOL_KINDS = Object.freeze(["read", "write"]);

/**
 * Where a confirmed write actually lands.
 *
 * Most writes land in the database through a service. A bill does not: the cart
 * is React state on the till, persisted offline, and it has to stay there — a
 * shop bills through a power cut, and a server-side cart would break the one
 * flow that must never need a network.
 *
 * So a `client` write resolves and prices server-side, where the catalogue and
 * the tenant boundary live, and returns lines the till merges into its own cart
 * using the same code path the voice parser already uses. The confirmation step
 * is identical either way; only the destination differs.
 */
export const TOOL_TARGETS = Object.freeze(["server", "client"]);

const NAME_PATTERN = /^[a-z][a-z0-9_]{2,48}$/;

/**
 * Reads are evidence-gathering and run unattended, so a read that is not `safe`
 * is a contradiction: there is no confirmation step in the loop to honour a
 * higher risk level, and marking one `confirm` would silently downgrade to
 * running anyway. Rejected at definition time rather than discovered in prod.
 */
function assertRiskMatchesKind(name, kind, risk) {
  if (kind === "read" && risk !== TOOL_RISK.SAFE) {
    throw new Error(`Tool ${name}: a read tool must be risk "safe" (got "${risk}")`);
  }
  if (kind === "write" && risk === TOOL_RISK.SAFE) {
    throw new Error(`Tool ${name}: a write tool cannot be risk "safe" — it needs a confirmation gate`);
  }
}

function assertNoTenantParameters(name, parameters) {
  const properties = parameters?.properties ?? {};
  for (const forbidden of ["shopId", "shop_id", "userId", "user_id", "tenantId"]) {
    if (forbidden in properties) {
      throw new Error(
        `Tool ${name}: "${forbidden}" cannot be a model-supplied parameter — it comes from the authenticated context`,
      );
    }
  }
}

/**
 * Define one tool. Throws at import time on a malformed definition, so a bad
 * tool cannot reach a shop: the process fails to boot instead.
 */
export function defineTool(definition) {
  const {
    name,
    kind,
    risk,
    target = "server",
    /**
     * Words that mean "this tool might be wanted", in every language a shop
     * actually speaks it: English, Hindi, and the roman Hinglish a shopkeeper
     * types. Used to decide which tools are worth their weight on a given turn.
     *
     * Recall matters far more than precision here. A tool wrongly offered costs
     * a few hundred tokens; a tool wrongly withheld makes the assistant say it
     * cannot do something it can, which is worse than being slow. So these lists
     * are deliberately generous, and a message that matches nothing gets every
     * tool rather than a guess.
     *
     * `always: true` keeps a tool in every turn regardless.
     */
    keywords = [],
    always = false,
    description,
    parameters = { type: "object", properties: {}, additionalProperties: false },
    roles = null,
    feature = null,
    summarize = null,
    handler,
  } = definition ?? {};

  if (!NAME_PATTERN.test(String(name ?? ""))) {
    throw new Error(`Tool name "${name}" must be snake_case, 3-49 chars`);
  }
  if (!TOOL_KINDS.includes(kind)) throw new Error(`Tool ${name}: kind must be one of ${TOOL_KINDS.join(", ")}`);
  if (!TOOL_RISK_VALUES.includes(risk)) throw new Error(`Tool ${name}: risk must be one of ${TOOL_RISK_VALUES.join(", ")}`);
  if (!TOOL_TARGETS.includes(target)) throw new Error(`Tool ${name}: target must be one of ${TOOL_TARGETS.join(", ")}`);
  if (kind === "read" && target !== "server") throw new Error(`Tool ${name}: only a write can target the client`);
  if (typeof description !== "string" || description.trim().length < 20) {
    throw new Error(`Tool ${name}: needs a description the model can actually route on (20+ chars)`);
  }
  if (typeof handler !== "function") throw new Error(`Tool ${name}: handler must be a function`);
  if (roles !== null && (!Array.isArray(roles) || roles.length === 0)) {
    throw new Error(`Tool ${name}: roles must be null (any role) or a non-empty array`);
  }
  if (kind === "write" && typeof summarize !== "function") {
    throw new Error(`Tool ${name}: a write tool must supply summarize() — the shopkeeper confirms a sentence, not JSON`);
  }

  assertRiskMatchesKind(name, kind, risk);
  assertNoTenantParameters(name, parameters);

  if (!Array.isArray(keywords)) throw new Error(`Tool ${name}: keywords must be an array`);
  if (!always && keywords.length === 0) {
    throw new Error(`Tool ${name}: needs keywords, or always:true — otherwise routing can never offer it`);
  }

  return Object.freeze({
    name, kind, risk, target, description, parameters, roles, feature, summarize, handler,
    keywords: Object.freeze(keywords.map((word) => String(word).toLowerCase())),
    always,
  });
}

/** The OpenAI function-calling shape. Only what the model needs to choose and call. */
export function toProviderTool(tool) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/**
 * Whether this caller may use this tool at all.
 *
 * Role is checked here so an unavailable tool is never advertised to the model:
 * a cashier's agent should not be told a price-change tool exists and then be
 * refused, because the model will keep trying and narrate a capability the
 * shopkeeper does not have.
 */
export function toolAvailableTo(tool, ctx) {
  if (tool.roles && !tool.roles.includes(ctx.role)) return false;
  if (tool.feature && !ctx.features?.has(tool.feature)) return false;
  return true;
}

export function assertToolAllowed(tool, ctx) {
  if (!toolAvailableTo(tool, ctx)) {
    throw new AppError(`This action is not available on your account`, 403, "AI_TOOL_FORBIDDEN");
  }
}
