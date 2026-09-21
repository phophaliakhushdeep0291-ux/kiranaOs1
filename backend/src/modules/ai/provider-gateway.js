/**
 * One way in to a language model.
 *
 * Before this file there were seven `new OpenAI(...)` call sites across five
 * modules — the agent loop, the command parser, the transcriber, invoice OCR,
 * the assurance explainer and the incident reporter — and each one had made up
 * its own answer to the same four questions:
 *
 *     how long do we wait?        45s / none / 12s / 20s, depending where you look
 *     how many times do we retry? 0 / 2 (SDK default) / 1 / a caller-side budget
 *     what if the provider is down? nothing — every one of them just failed
 *     what did it cost?           nobody recorded a single token
 *
 * Those are not seven decisions. They are one decision copied seven times and
 * then drifted, which is why a Groq outage took the whole assistant down while
 * a perfectly good OpenAI key sat unused in the same environment.
 *
 * So: providers are an ordered list, not a single choice. A call walks the list
 * until one answers. Within a provider it retries only what is worth retrying,
 * with jitter, and only inside the caller's deadline — a retry that outlives the
 * shopkeeper's patience is just a more expensive failure. A provider that keeps
 * failing is taken out of rotation by the breaker rather than being asked again
 * on every request, because a dead endpoint answers slowly, and paying that
 * latency on every turn is how one broken dependency becomes a broken counter.
 *
 * Everything that happens here is counted. Not for a dashboard's sake: without
 * tokens per model there is no answer to "what does the assistant cost per shop",
 * and without latency per provider there is no evidence for which one to make
 * primary. Both questions were previously unanswerable.
 */
import OpenAI from "openai";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/index.js";
import { incrementMetric, observeMetric, setGaugeMetric } from "../../lib/metrics.js";

/** Consecutive failures before a provider is taken out of rotation. */
const BREAKER_THRESHOLD = 4;
/** How long it stays out before one request is allowed through to probe it. */
const BREAKER_COOLDOWN_MS = 30_000;
/** Attempts against one provider, including the first. */
const MAX_ATTEMPTS_PER_PROVIDER = 3;
/** Base for exponential backoff; the real wait adds jitter and respects the deadline. */
const RETRY_BASE_MS = 250;
/** Never sleep longer than this between attempts, whatever the backoff says. */
const RETRY_CAP_MS = 2_000;
/** A provider needs at least this much of the deadline left to be worth calling. */
const MIN_VIABLE_BUDGET_MS = 1_500;

/**
 * Provider order.
 *
 * Groq first because it is the cheap fast one these shops actually run on;
 * OpenAI second because it is the one that stays up. A deployment with only one
 * key configured gets a one-element list and behaves exactly as before, which
 * is what makes this safe to roll out.
 */
function buildProviders() {
  const providers = [];
  if (env.GROQ_API_KEY) {
    providers.push({
      provider: "groq",
      model: env.GROQ_MODEL || "openai/gpt-oss-20b",
      client: new OpenAI({
        apiKey: env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
        // Retries belong to this file. The SDK's own retry loop has no view of
        // the turn deadline and would happily spend it three times over.
        maxRetries: 0,
      }),
    });
  }
  if (env.OPENAI_API_KEY) {
    providers.push({
      provider: "openai",
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      client: new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 }),
    });
  }
  return providers;
}

let cachedProviders = null;
let cachedKey = null;

/** Rebuilt when the credentials change, so a rotated key does not need a restart. */
export function chatProviders() {
  const key = `${env.GROQ_API_KEY ? "g" : ""}${env.GROQ_MODEL}|${env.OPENAI_API_KEY ? "o" : ""}${env.OPENAI_MODEL}`;
  if (cachedProviders && cachedKey === key) return cachedProviders;
  cachedProviders = buildProviders();
  cachedKey = key;
  return cachedProviders;
}

/** name -> { failures, openedAt }. Process-local on purpose; see note below. */
const breakers = new Map();

/*
 * The breaker is per process, not shared through Redis.
 *
 * A shared breaker would trip faster across a fleet, but it also turns one
 * instance's bad network into every instance's outage, and it puts a Redis
 * round-trip on the path of every AI call. Per-process is the conservative
 * choice: worst case each instance independently learns the provider is down,
 * which costs BREAKER_THRESHOLD requests per instance rather than per fleet.
 */
function breakerFor(name) {
  let state = breakers.get(name);
  if (!state) {
    state = { failures: 0, openedAt: 0 };
    breakers.set(name, state);
  }
  return state;
}

function breakerAllows(name, now) {
  const state = breakerFor(name);
  if (state.openedAt === 0) return true;
  if (now - state.openedAt < BREAKER_COOLDOWN_MS) return false;
  // Half-open: let exactly this request through. It either closes the breaker
  // on success or re-opens it on failure, so a still-dead provider costs one
  // request per cooldown window instead of all of them.
  state.openedAt = 0;
  state.failures = BREAKER_THRESHOLD - 1;
  return true;
}

function recordBreakerSuccess(name) {
  const state = breakerFor(name);
  state.failures = 0;
  state.openedAt = 0;
  setGaugeMetric("ai_provider_circuit_open", { provider: name }, 0);
}

function recordBreakerFailure(name, now) {
  const state = breakerFor(name);
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD && state.openedAt === 0) {
    state.openedAt = now;
    setGaugeMetric("ai_provider_circuit_open", { provider: name }, 1);
    incrementMetric("ai_provider_circuit_trips_total", { provider: name });
  }
}

/** Only for tests, which must not inherit another test's breaker state. */
export function __resetProviderGatewayForTests() {
  breakers.clear();
  cachedProviders = null;
  cachedKey = null;
}

function statusOf(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
}

/**
 * Is another attempt against *this* provider worth making?
 *
 * Rate limits and 5xx are the provider having a moment. Connection faults are
 * the network having one. Everything else — a bad key, an unknown model, a
 * malformed request — will fail identically no matter how many times it is
 * sent, and retrying it only spends the deadline that the next provider needs.
 */
function isRetryable(error) {
  const status = statusOf(error);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (status >= 400 && status <= 499) return false;
  const code = String(error?.code ?? "");
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return true;
  return /connection error|fetch failed|socket hang up|network/i.test(String(error?.message ?? ""));
}

/**
 * Is it worth trying the *next* provider?
 *
 * Almost always yes — a different vendor is the whole point. The exception is a
 * request we built wrong (400), which is our bug and will be rejected just as
 * firmly by the second provider. Failing over on those would double the latency
 * of every programming error and hide it behind a fallback.
 */
function shouldFailOver(error) {
  if (error?.code === "AI_TURN_TIMEOUT") return false;
  return statusOf(error) !== 400;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * One request, bounded by the caller's deadline.
 *
 * The deadline is the turn's, not this call's: a turn is several model requests
 * plus tool work, and each request may only spend what is left. That is why the
 * timeout is computed here rather than fixed on the client.
 */
async function callOnce(candidate, body, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new AppError("The assistant took too long to respond. Please try again.", 504, "AI_TURN_TIMEOUT");
  }
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      candidate.client.chat.completions.create(
        { ...body, model: body.model ?? candidate.model },
        { signal: controller.signal, timeout: remaining, maxRetries: 0 },
      ),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AppError("The assistant took too long to respond. Please try again.", 504, "AI_TURN_TIMEOUT"));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tokens are recorded; rupees are not.
 *
 * A price table in application code is wrong the day a vendor changes a rate,
 * and wrong silently, which is worse than absent — someone reads a cost
 * dashboard built on stale constants and makes a decision from it. Tokens per
 * provider and model are the durable fact; whatever prices them today can do
 * that arithmetic where the rates are actually maintained.
 */
function recordUsage(purpose, candidate, completion, latencyMs, attempts) {
  const labels = { provider: candidate.provider, model: candidate.model, purpose };
  incrementMetric("ai_provider_requests_total", { ...labels, outcome: "ok" });
  observeMetric("ai_provider_latency_ms", labels, latencyMs);
  observeMetric("ai_provider_attempts", labels, attempts);
  const usage = completion?.usage;
  if (!usage) return;
  const prompt = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  if (prompt > 0) incrementMetric("ai_provider_tokens_total", { ...labels, kind: "prompt" }, prompt);
  if (output > 0) incrementMetric("ai_provider_tokens_total", { ...labels, kind: "completion" }, output);
}

/**
 * Ask a model, and keep asking somewhere until one answers or the clock runs out.
 *
 * Returns the completion plus who produced it, because the caller has to record
 * which model it is about to trust — a turn logged against "groq" that actually
 * came from the OpenAI fallback is a trace nobody can debug from.
 *
 * `candidates` exists for tests and for the injected-provider path the agent
 * loop already supports; production passes nothing and gets the env's list.
 */
export async function runChatCompletion({ purpose = "chat", body, deadline, candidates = null } = {}) {
  const available = candidates ?? chatProviders();
  if (!available.length) {
    throw new AppError("No AI API key configured. Add GROQ_API_KEY or OPENAI_API_KEY.", 503, "AI_KEY_MISSING");
  }

  const startedAt = Date.now();
  let lastError = null;
  let outOfTime = false;

  for (const [index, candidate] of available.entries()) {
    const now = Date.now();
    if (deadline - now < MIN_VIABLE_BUDGET_MS) { outOfTime = true; break; }
    if (!breakerAllows(candidate.provider, now)) {
      incrementMetric("ai_provider_requests_total", {
        provider: candidate.provider, model: candidate.model, purpose, outcome: "circuit_open",
      });
      continue;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const completion = await callOnce(candidate, body, deadline);
        recordBreakerSuccess(candidate.provider);
        recordUsage(purpose, candidate, completion, Date.now() - attemptStartedAt, attempt);
        if (index > 0) {
          incrementMetric("ai_provider_failovers_total", {
            from: available[0].provider, to: candidate.provider, purpose,
          });
        }
        return {
          completion,
          provider: candidate.provider,
          model: candidate.model,
          attempts: attempt,
          failedOver: index > 0,
          latencyMs: Date.now() - startedAt,
          usage: completion?.usage ?? null,
        };
      } catch (error) {
        lastError = error;
        const retryable = isRetryable(error);
        incrementMetric("ai_provider_requests_total", {
          provider: candidate.provider, model: candidate.model, purpose,
          outcome: retryable ? "retryable_error" : "error",
        });
        // A deadline breach is not the provider's fault and must not count
        // toward tripping its breaker — otherwise a few slow turns take a
        // healthy provider out of rotation for everyone.
        if (error?.code !== "AI_TURN_TIMEOUT") recordBreakerFailure(candidate.provider, Date.now());
        if (!retryable || attempt === MAX_ATTEMPTS_PER_PROVIDER) break;

        // Full jitter. A fleet of tills that all retried at exactly 250ms would
        // reconverge on the provider in a single spike and re-trigger the very
        // rate limit they are backing off from.
        const backoff = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
        const wait = Math.floor(Math.random() * backoff);
        if (deadline - Date.now() <= wait + MIN_VIABLE_BUDGET_MS) break;
        await sleep(wait);
      }
    }

    if (!shouldFailOver(lastError)) break;
  }

  // What the caller is told has to match what actually went wrong. A turn that
  // ran out of clock is a timeout — the frontend has a sentence for that — and
  // calling it "unavailable" would send a shopkeeper looking for an outage that
  // is not happening.
  if (lastError) throw lastError;
  if (outOfTime) {
    throw new AppError("The assistant took too long to respond. Please try again.", 504, "AI_TURN_TIMEOUT");
  }
  throw new AppError("The assistant is temporarily unavailable. Try again shortly.", 503, "AI_PROVIDERS_UNAVAILABLE");
}

/** What the gateway currently believes about each provider. For /health and support. */
export function providerHealthSnapshot() {
  return chatProviders().map((candidate) => {
    const state = breakerFor(candidate.provider);
    return {
      provider: candidate.provider,
      model: candidate.model,
      circuitOpen: state.openedAt !== 0 && Date.now() - state.openedAt < BREAKER_COOLDOWN_MS,
      consecutiveFailures: state.failures,
    };
  });
}
