# KiranaOS AI hallucination control plan

## Safety objective

No model output may create a financial fact, product identity, customer identity,
quantity, price, payment status, stock state, compliance conclusion, diagnostic
cause, or completed action unless that claim is independently present in
server-controlled evidence.

## Enforced now

1. Voice commands use a strict schema, temperature zero, transcript evidence,
   tenant catalogue matching, confidence thresholds, permission checks, and
   confirmation for risky actions.
2. Product mutations fail closed when the tenant catalogue cannot be loaded.
3. Provider-authored voice messages and clarification prose are discarded;
   the server composes the only text shown to a cashier.
4. Diagnostic AI can only select server-issued evidence IDs. The server writes
   the diagnosis, next step, and confidence.
5. Assurance AI cannot author user-visible financial claims. Its output can
   select exact deterministic remediation/evidence values; final prose is
   server-composed. Evidence classification is advisory and confidence is
   capped until a reviewer verifies the document.
6. Invoice OCR is review-only, never posts, only prefills exact catalogue matches
   with high confidence and consistent arithmetic, and reports every mismatch.

## Required release gates

- Unsafe adversarial acceptance rate must remain 0% for voice commands and
  diagnostic narratives.
- Invented provider prose must never appear in the returned voice command.
- Invented assurance amounts, events, identities, or actions must never appear
  in an explanation, case summary, or classification reason.
- Unknown schema fields, malformed JSON, unavailable catalogues, unsupported
  evidence IDs, and provider failures must all fail closed.
- AI safety tests remain a required step in release certification.

## Next maturity stages

1. Add a versioned red-team corpus covering Hindi, Hinglish, homophones,
   prompt injection, number swapping, mixed units, duplicate product aliases,
   and multi-turn context poisoning.
2. Track per-intent false-accept, false-reject, clarification, and manual-fallback
   rates without storing raw audio or unredacted customer data.
3. Add field-level provenance to OCR results: page region, extracted token,
   deterministic check status, and reviewer decision.
4. Run shadow evaluation for every model/prompt change against a pinned corpus;
   block rollout if safety regresses or legitimate-command recall drops.
5. Canary model changes per tenant cohort with an immediate deterministic-only
   kill switch and versioned audit logs.
6. Require human confirmation for every financial mutation regardless of model
   confidence; AI may prepare an action but never execute it.

## Honest boundary

These controls prove code-level fail-closed behavior against the maintained test
corpus. They do not prove that speech recognition is always correct or that an
external model can never produce a novel adversarial output. Production proof
requires monitored shadow traffic, labeled review outcomes, and continuous
red-team expansion.
