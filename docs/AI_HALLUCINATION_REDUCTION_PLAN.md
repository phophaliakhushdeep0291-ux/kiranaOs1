# KiranaOS AI hallucination-reduction plan

## Safety target

AI may help interpret or rank evidence, but it must never become the source of a
product, quantity, unit, customer, amount, payment result, stock state, or
completed action. Financial and inventory writes remain deterministic and
human-confirmed. A provider response that cannot be proved from the transcript,
tenant catalogue, current application state, or a server tool result fails into
clarification or a manual workflow.

## Measurement contract

The release gate tracks two different errors because optimizing only one makes
the other worse:

- Unsafe acceptance: an invented, ambiguous, unsupported, or substituted value
  is accepted. Target: 0% for the versioned adversarial corpus and 0% for every
  destructive or money-changing command.
- Legitimate recall: a fully evidenced command is accepted. Target: at least
  95% after the corpus is large enough to represent Hindi, Hinglish, English,
  trade vocabulary, accents, pack sizes, and noisy transcription.

Production monitoring must segment results by provider model, safety-policy
version, and prompt fingerprint. It must never use shop, user, device, customer,
phone, transcript, audio, product name, or free-form text as metric labels.

## Delivery phases

### 1. Deterministic grounding and fail-closed semantics — implemented for the covered workflows

- Strict JSON schema; unknown fields and malformed provider output are rejected.
- Agent answers are composed from explicitly mapped values in successful server
  tool results. A success flag alone cannot validate provider prose. The
  operational answer records the result's subject and report dates.
- Exact integer paise are formatted without converting large values through
  floating-point numbers. Missing amounts stay unavailable, and negative stock
  keeps its sign. Stock units and pricing units are separate fields.
- Customer balances use the derived ledger balance. Staff product lookups omit
  costs before data reaches the provider. Named reporting periods resolve to
  explicit dates in the shop timezone.
- Unknown or unencodable results cannot create a successful evidence trace.
  A provider failure after a successful read still returns the verified data.
- Products, quantities, units, customers, phones, amounts, discounts, targets,
  and intent keywords must be supported by first-party evidence.
- Product-changing and bill-line commands require one unambiguous product from
  the current tenant catalogue. Merely repeating a spoken name does not prove
  that the product exists.
- Intents with missing payloads are rejected rather than accepted as incomplete
  commands.
- Catalogue outages force manual selection; they never relax validation.
- Approved agent plans are claimed atomically before any handler runs. Parallel
  confirmation and cancellation compete for the same pending status. Current
  role, business type, feature access and owner-PIN risk are checked again.
- A timed-out write has an uncertain outcome, since the underlying operation
  might still finish. Later plan steps are skipped, the original plan cannot be
  replayed, and the user is directed to inspect the record before another action.

### 2. Versioned canary and privacy-safe telemetry — implemented

- Every parser result records provider model, policy version, and a one-way
  fingerprint of the system prompt plus schema.
- Rejection reason counters are exported without tenant or transcript data.
- The versioned red-team corpus is a release gate and cannot silently shrink.
- Any model, prompt, or schema change is attributable to a distinct telemetry
  series and must pass the same canary before rollout.

### 3. Human outcome labels — implemented; production sample collection remains

- One-tap correct, misunderstood, and unsafe feedback is available on voice and assistant
  results.
- Feedback stores only the action-log ID, bounded reason code, policy fingerprint, and
  outcome; do not copy raw audio or free-form customer data into evaluation
  tables.
- Outcome proportions use minimum sample sizes and Wilson confidence intervals.
  Small samples are shown as insufficient evidence. These voluntary feedback
  labels do not establish population false-accept or false-reject rates; that
  requires independently labelled accepted and rejected requests.

### 4. Shadow evaluation and staged rollout — requires provider traffic

- Mirror an explicitly consented, redacted sample to the candidate model without
  executing its output.
- Compare incumbent and candidate only through the deterministic grounder.
- Stop rollout automatically on any destructive unsafe acceptance, material
  recall regression, schema failure spike, or grounding-rejection spike.
- Roll out by fixed cohorts (internal, 1%, 5%, 25%, 100%) with a rollback model
  and prompt fingerprint recorded for each stage.

### 5. Continuous adversarial coverage — ongoing

- Add every confirmed failure as a minimized, anonymized regression case.
- Maintain separate suites for voice commands, diagnostic narratives, assurance
  classification, invoice OCR, and tool-using agent plans.
- Test number swaps, mixed units, duplicate aliases, nonexistent catalogue
  entities, prompt/context injection, stale state, tenant boundaries, tool-result
  invention, and provider timeouts.

## Honest limitations

Local deterministic tests prove behavior for the checked corpus, not every novel
model response or accent. Production false-accept and false-reject rates require
consented labeled traffic. Until that evidence exists, KiranaOS should claim
strong fail-closed controls and zero unsafe acceptance on its named corpus—not
universal freedom from hallucination.

The agent policy `2026-09-08.1` covers the registered core and trade summary
formats. It can still choose an irrelevant lookup, misunderstand a requested
period, or miss part of a question. Summaries show a bounded number of records
with a count when more exist. New tools and fields need an explicit formatter
and coverage before their values can appear in an operational reply. Proposals
still require human review; deterministic display does not prove that every
proposed action matches the person's intent.

## Verification added on 2026-09-08

- `backend/tests/ai-agent-response-grounding.examples.js` checks fabricated
  amounts after a successful unrelated read, a success flag with no evidence,
  exact large paise, negative stock, absent values, real catalogue field mappings,
  staff cost visibility, shop-timezone periods, and the complete turn-to-audit
  path with a scripted provider. It also checks large results and provider failure.
- `backend/tests/ai-agent-plan-concurrency.examples.js` exercises actual database
  claims, including two requests forced to read the same pending plan before
  claiming it, confirmation versus rejection, tenant boundaries, changed risk,
  an uncertain timeout followed by a late write, and suppression of later steps.
- Both suites run in `npm run test:ai-safety` with an isolated database. Their
  scripted provider tests require no external API request or merchant data.
