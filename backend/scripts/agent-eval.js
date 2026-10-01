/**
 * Does the assistant do the RIGHT thing?
 *
 * The suites next door answer the opposite question. The red-team corpus asks
 * whether it can be made to do a wrong thing; the hallucination guard asks
 * whether a number can be invented; the grounding examples ask whether a
 * provider's sentence can reach a shopkeeper unverified. All three are about
 * damage. None of them would notice if the assistant became useless — if it
 * stopped finding the product, answered only the first half of a sentence, or
 * refused a question it can answer perfectly well.
 *
 * That gap is what this file is. It is the difference between "we swapped the
 * model and nothing broke" and "we swapped the model and nothing broke, and
 * here is the number that says so".
 *
 *
 * SIX DIMENSIONS, NOT ONE PASS/FAIL
 *
 * A single score tells you a run got worse. It does not tell you what to fix, so
 * every case is scored separately on:
 *
 *   toolSelection      did it reach for the tools the task needs, and no others
 *   argumentGrounding  did it resolve ids from lookups instead of inventing them
 *   writeDiscipline    did a change stay a proposal, at the right risk level
 *   evidence           did the reply carry the figure that was actually read
 *   refusal            did an unanswerable question get an honest answer
 *   language           did it answer in the shop's language, names untranslated
 *
 * A fall in toolSelection is a routing or prompt problem. A fall in
 * writeDiscipline is a safety problem and should stop a release. A fall in
 * evidence means the reply stopped carrying its number, which is the failure a
 * shopkeeper actually notices. Three different repairs; one undifferentiated
 * score would have sent you looking in the wrong place for all three.
 *
 *
 * TWO MODES, ONE DATASET
 *
 *   replay (default)  the model's choices come from the dataset, so the run is
 *                     deterministic, free, offline, and in the release gate. It
 *                     scores OUR code: routing, argument validation, proposal
 *                     handling, evidence rendering, grounding.
 *
 *   live              a real provider chooses. It scores THE MODEL and THE
 *                     PROMPT. It costs money and it is stochastic, so it is
 *                     never in the gate — you run it before changing a model,
 *                     a prompt, or a tool description.
 *
 * Both score the same cases with the same scorer against the same ratchet, only
 * at different floors. That is the property that makes the number comparable
 * across a model swap, which is the entire reason to build this rather than add
 * more assertions.
 *
 *
 * Run it:  node scripts/agent-eval.js            (replay)
 *          node scripts/agent-eval.js --live     (needs GROQ_API_KEY or OPENAI_API_KEY)
 *          node scripts/agent-eval.js --json report.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { runAgentTurn, AI_AGENT_POLICY_VERSION, AI_AGENT_PROMPT_FINGERPRINT } from "../src/modules/ai/agent/agent.service.js";
import { chatProviders } from "../src/modules/ai/provider-gateway.js";

export const DIMENSIONS = ["toolSelection", "argumentGrounding", "writeDiscipline", "evidence", "refusal", "language"];

export async function loadDataset(url = new URL("../tests/fixtures/ai-agent-eval.v1.json", import.meta.url)) {
  return JSON.parse(await readFile(url, "utf8"));
}

/**
 * A provider that replays the dataset's recorded choices.
 *
 * It is not a mock of a model in any interesting sense — it is a way to hold the
 * model's decisions fixed so that a change in the score can only have come from
 * our code. `$ref:` placeholders are resolved against the seeded shop, because a
 * dataset cannot know the ids a fresh database will generate.
 */
export function replayProvider(steps, refs) {
  const resolve = (value) => {
    if (typeof value === "string" && value.startsWith("$ref:")) {
      const key = value.slice(5);
      if (!(key in refs)) throw new Error(`Dataset references unknown fixture "${key}"`);
      return refs[key];
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner)]));
    }
    return value;
  };

  let step = 0;
  return {
    provider: "replay",
    model: `dataset-v1`,
    client: { chat: { completions: { create: async () => {
      const calls = steps[step] ?? [];
      step += 1;
      // Out of scripted steps, or this step deliberately calls nothing: the
      // model "answers". The loop discards that sentence and composes its own,
      // which is the behaviour under test.
      if (step > steps.length || calls.length === 0) {
        return { choices: [{ message: { role: "assistant", content: "(replayed)" } }] };
      }
      return { choices: [{ message: { role: "assistant", tool_calls: calls.map((call, index) => ({
        id: `replay-${step}-${index}`,
        type: "function",
        function: { name: call.tool, arguments: JSON.stringify(resolve(call.args ?? {})) },
      })) } }] };
    } } } },
  };
}

const called = (turn) => turn.trace.filter((row) => row.kind === "read").map((row) => row.tool);
const proposed = (turn) => turn.plan.map((row) => ({ tool: row.tool, risk: row.risk }));

/**
 * Score one turn against one case.
 *
 * A dimension a case says nothing about is not scored for that case, rather than
 * scored as a pass. Counting silent dimensions as passes is how an eval drifts
 * into reporting a high number for a dataset that stopped checking anything.
 */
export function scoreCase(testCase, turn) {
  const expect = testCase.expect ?? {};
  const results = {};
  const failures = [];
  const check = (dimension, condition, detail) => {
    results[dimension] = results[dimension] !== false && condition;
    if (!condition) failures.push(`${dimension}: ${detail}`);
  };

  if (Array.isArray(expect.tools)) {
    const actual = called(turn);
    for (const tool of expect.tools) {
      check("toolSelection", actual.includes(tool), `expected ${tool}, called [${actual.join(", ") || "none"}]`);
    }
    // Reaching for something the task never needed is its own failure: it spends
    // the tool budget and the shopkeeper's time, and on a small model it is the
    // usual precursor to answering the wrong question.
    for (const tool of expect.mustNotCallTools ?? []) {
      check("toolSelection", !actual.includes(tool), `called ${tool}, which this task does not need`);
    }
    if (expect.tools.length === 0 && !expect.mustNotCallTools) {
      check("toolSelection", actual.length === 0, `expected no lookups, called [${actual.join(", ")}]`);
    }
  }

  // An id the model made up is the single most dangerous kind of plausible
  // output: it names a real-looking row that is not the one the shopkeeper meant.
  for (const [tool, field] of Object.entries(expect.argumentsResolvedFrom ?? {})) {
    const step = turn.trace.find((row) => row.tool === tool);
    check("argumentGrounding", Boolean(step), `${tool} was never called, so ${field} could not have been resolved`);
  }

  if (Array.isArray(expect.proposals)) {
    const actual = proposed(turn);
    for (const wanted of expect.proposals) {
      const match = actual.find((row) => row.tool === wanted.tool);
      check("writeDiscipline", Boolean(match), `expected a ${wanted.tool} proposal, got [${actual.map((row) => row.tool).join(", ") || "none"}]`);
      if (match && wanted.risk) {
        check("writeDiscipline", match.risk === wanted.risk, `${wanted.tool} proposed at risk "${match.risk}", expected "${wanted.risk}"`);
      }
    }
    // The property the whole design rests on: proposing is not doing.
    check("writeDiscipline", turn.requiresConfirmation === true, "a change was prepared without asking anyone to confirm it");
    if (expect.requiresOwnerPin) {
      check("writeDiscipline", turn.requiresOwnerPin === true, "an owner-PIN change did not demand the PIN");
    }
  }

  if (expect.grounding) {
    const dimension = expect.grounding === "no_verified_evidence" ? "refusal" : "evidence";
    check(dimension, turn.safety.grounding === expect.grounding, `grounding was "${turn.safety.grounding}", expected "${expect.grounding}"`);
  }

  for (const needle of expect.replyContains ?? []) {
    const dimension = /[ऀ-ॿ]/.test(needle) ? "language" : "evidence";
    check(dimension, turn.reply.includes(needle), `reply is missing "${needle}"`);
  }
  for (const needle of expect.replyExcludes ?? []) {
    const dimension = /[ऀ-ॿ]/.test(needle) ? "language" : "evidence";
    check(dimension, !turn.reply.includes(needle), `reply should not contain "${needle}"`);
  }

  return { id: testCase.id, category: testCase.category, results, failures, reply: turn.reply, stoppedBecause: turn.stoppedBecause };
}

/**
 * Run the whole dataset and score it.
 *
 * `seed` returns the shop context plus the `$ref` table the dataset's recorded
 * arguments are written against. In live mode there is no script, so the model
 * is simply asked the utterance and scored on what it decides to do.
 */
export async function runEval({ dataset, ctx, refs, live = false, provider = null } = {}) {
  const cases = [];
  for (const testCase of dataset.cases) {
    const injected = live
      ? provider
      : replayProvider(testCase.replay ?? [], refs ?? {});
    let turn;
    try {
      turn = await runAgentTurn(
        ctx,
        { message: testCase.utterance, language: testCase.language ?? "hi" },
        injected ? { provider: injected } : {},
      );
    } catch (error) {
      cases.push({ id: testCase.id, category: testCase.category, results: {}, errored: String(error?.message ?? error), failures: [`turn threw: ${error?.message}`] });
      continue;
    }
    cases.push(scoreCase(testCase, turn));
  }

  const scores = {};
  for (const dimension of DIMENSIONS) {
    const scored = cases.filter((row) => dimension in row.results);
    const passed = scored.filter((row) => row.results[dimension] === true);
    // A dimension no case exercises reports null, not 1. "Nothing checked it"
    // and "everything passed" must never render as the same number.
    scores[dimension] = scored.length === 0 ? null : passed.length / scored.length;
  }

  return {
    suite: dataset.name,
    schemaVersion: dataset.schemaVersion,
    mode: live ? "live" : "replay",
    policyVersion: AI_AGENT_POLICY_VERSION,
    promptFingerprint: AI_AGENT_PROMPT_FINGERPRINT,
    cases: cases.length,
    scores,
    failed: cases.filter((row) => row.failures.length > 0).map((row) => ({ id: row.id, failures: row.failures })),
    detail: cases,
  };
}

/**
 * Hold the report against the dataset's floors.
 *
 * A dimension with no cases cannot clear a floor it was never measured against,
 * so it is a violation rather than a pass — otherwise deleting the last case for
 * a dimension would silently turn its gate off.
 */
export function checkPolicy(report, dataset) {
  const floors = dataset.policy?.[report.mode] ?? {};
  const violations = [];
  for (const [dimension, floor] of Object.entries(floors)) {
    if (dimension === "comment") continue;
    const score = report.scores[dimension];
    if (score === null || score === undefined) {
      violations.push(`${dimension}: no case exercises it, so its floor of ${floor} is unproven`);
      continue;
    }
    if (score < floor) violations.push(`${dimension}: ${score.toFixed(3)} below floor ${floor}`);
  }
  return violations;
}

/** CLI. The test imports the functions above and supplies its own seeded shop. */
if (import.meta.url === `file://${process.argv[1]}`) {
  // The registry is populated by importing the tools, exactly as the HTTP
  // controller does. Without this the CLI scores an assistant that has no tools
  // at all and reports a flat zero, which reads as a catastrophic regression
  // rather than as the setup mistake it is.
  await import("../src/modules/ai/agent/register-core.js");
  const live = process.argv.includes("--live");

  // Say it once, before spending anything. Without this a missing key surfaces
  // as the same exception sixteen times over, under a report of six null scores
  // — which is a correct red build for an incomprehensible reason. The run is
  // refused rather than reported, because "no key" is not a score.
  if (live && chatProviders().length === 0) {
    console.error(
      "Live mode needs a provider. Set GROQ_API_KEY or OPENAI_API_KEY in backend/.env\n" +
      "(or export it for this run), then try again. `npm run eval:agent` scores the\n" +
      "same dataset offline with no key and no spend.",
    );
    process.exit(2);
  }
  if (live) {
    const [primary] = chatProviders();
    console.error(`Live run against ${primary.provider}/${primary.model} — this spends real API credit.\n`);
  }

  const jsonAt = process.argv[process.argv.indexOf("--json") + 1];
  const dataset = await loadDataset();
  const { seedEvalShop, dropEvalShop } = await import("../tests/helpers/agent-eval-shop.js");
  const seeded = await seedEvalShop();
  try {
    const report = await runEval({ dataset, ctx: seeded.ctx, refs: seeded.refs, live });
    const violations = checkPolicy(report, dataset);
    if (jsonAt && process.argv.indexOf("--json") > -1) await writeFile(jsonAt, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, detail: undefined }, null, 2));
    if (violations.length) {
      console.error(`\nBelow the ratchet:\n  ${violations.join("\n  ")}`);
      process.exitCode = 1;
    }
  } finally {
    await dropEvalShop(seeded);
  }
}
