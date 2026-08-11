# KiranaOS AI command safety

## Scope

The AI feature is an optional command parser, not an autonomous POS operator.
It may suggest a structured command, but it does not write bills, stock,
customers, payments, discounts, cancellations, reports, or exports. Normal
authorization, confirmation, owner-PIN, tenant, device, and transaction controls
remain authoritative.

## Trust boundary

The transcript, cart context, visible UI data, catalogue text, and provider
response are all untrusted. The backend applies these gates in order:

1. Request validation bounds the transcript and every context collection.
2. Only allow-listed context fields are sent to the provider.
3. Only transcript-relevant product candidates from the authenticated shop are
   included; another tenant's catalogue is never queried.
4. OpenAI requests use strict structured output. Every provider, including
   providers without native structured output, must pass the same strict Zod
   schema after parsing.
5. A deterministic grounder verifies products/aliases, quantities, units,
   customers, mobile numbers, payments, udhar, discounts, targets, and sensitive
   intent keywords against the transcript.
6. Effective confidence is the lower of model confidence and evidence
   confidence. Minimum thresholds are 0.65 for safe suggestions, 0.80 for
   confirmation-level suggestions, and 0.90 for owner-level suggestions.
7. Invalid, ambiguous, unsupported, low-confidence, or catalogue-unavailable
   item commands return permissionAllowed=false and require manual fallback.
8. The frontend rejects blocked, schema-invalid, manual-fallback, ambiguous, or
   sub-0.65 responses and uses the deterministic local/manual flow.

The API exposes bounded safety reason codes, never private chain-of-thought,
hidden prompts, or raw provider reasoning.

## Diagnostic assistant grounding

The support assistant uses a separate, narrower trust boundary. Its root cause,
recommended action, and confidence are computed deterministically from the
authenticated shop's diagnostics. A configured language model cannot author or
replace any of those fields. It may only return one to five identifiers from a
strict, per-report enum of server-issued evidence IDs.

The server validates the response again even when a provider supports native
structured output. Free-form prose, unknown IDs, duplicate IDs, empty or oversized
selections, and additional fields fail closed. The server always retains its own
highest-ranked signal, composes the final narrative from the verified evidence
catalog, and records `aiGrounding.status`, selected IDs, and any rejection reason.
Provider output never raises or mutates deterministic confidence. If the provider
is missing, fails, or returns unsupported output, the deterministic support answer
remains available.

## Test gates

The local release gate runs `tests/ai-hallucination-guard.examples.js` and
`tests/diagnostic-ai-grounding.examples.js`. It requires:

- 100% rejection of provider objects that violate the strict schema.
- 0 unsafe acceptances in the committed adversarial cases.
- 100% acceptance of the committed unambiguous Hindi/Hinglish/English examples.
- Fail-closed handling for malformed JSON and unavailable product catalogues.
- Strict structured-output configuration on the OpenAI path.
- Sanitization of unrecognized client context before provider submission.
- Audit status of parsed versus blocked for every returned provider result.
- 0 accepted free-form or unverified diagnostic narratives.
- A strict per-report evidence-ID enum and rejection of extra provider fields.
- Server-owned diagnostic prose, next steps, and confidence.

These deterministic fixtures prove the application's guardrails; they do not
prove a live model's language accuracy. Before enabling a provider in
production, run a private, consented evaluation set representative of real store
accents, catalogues, noise, and code-switching. Release only if unsafe action
acceptance remains 0%, high-risk false acceptance remains 0%, and unambiguous
legitimate-command acceptance is at least 90%. Any failed safety case blocks the
rollout; a lower legitimate acceptance rate keeps AI optional and falls back to
manual input.

## Operations and privacy

The metrics endpoint reports ai_commands_total by provider, status, and intent,
plus ai_command_effective_confidence by provider and status. Metric labels never
contain shop, user, device, customer, transcript, phone, mobile, email, token, or
audio data. Alert on sustained provider errors, a sharp rise in blocked/manual
fallback rate, or a confidence-distribution shift.

AI action audit rows remain tenant-scoped. Audio uploads are streamed from an
isolated temporary file and removed after success or failure. Do not send live
customer transcripts to an evaluation service without consent and an approved
retention policy.

## Rollout sequence

1. Deterministic parser only.
2. AI suggestions in shadow mode; no user-visible execution.
3. Read-only navigation and search suggestions.
4. Billing drafts that always require user review.
5. Confirmation-level suggestions with existing application confirmation.
6. Owner-level suggestions only with the existing owner-PIN workflow.

There is no rollout stage in which the model bypasses deterministic permissions
or directly commits a POS mutation.
