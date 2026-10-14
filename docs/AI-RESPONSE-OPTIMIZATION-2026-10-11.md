# AI response improvements — 11 October 2026

## Changes

- Complete first-turn requests for supported sales periods, gross profit, stock health and total outstanding credit use the existing guarded read tools directly. They need zero model requests and still create the normal audit record. English, Hindi and common Hinglish daily-sales phrases are supported.
- Multi-part requests, named-product questions, ambiguous periods and conversation follow-ups retain the model path. No stock or financial result is cached between turns.
- A model step containing only previously completed reads ends the loop, instead of spending the remaining six-step budget repeating the same work.
- History retains the newest contiguous messages within 12,000 characters, down from a possible 48,000. The individual message and message-count limits remain in force.
- Tool waits respect the remaining turn deadline. Partial failures are visible, and a proposed change no longer hides the verified information read alongside it. Confirmation and owner-PIN requirements remain unchanged.
- Audit records capture the number of gateway calls for comparing future performance. This counts logical calls, not provider-internal retry attempts.

## Evidence

The isolated database regressions prove zero provider calls for supported direct reports, fresh data on successive turns, role checks, bounded recent history, failure without fabricated values, and a two-call stop for a repeated-read loop. The full `test:ai-safety` suite passed, including grounding, red-team cases, write confirmation/concurrency, bill units and the scripted agent evaluation.

The frontend production gate passed (3,460 tests passed, one existing skip), and backend production checks passed. These are deterministic regressions and production-build checks; no live model latency or token-spend percentage is claimed. Complex questions still depend on the configured provider and existing tool coverage.
