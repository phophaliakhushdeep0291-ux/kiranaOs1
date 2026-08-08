# Competitive evidence and anti-hallucination policy

`docs/competitive-evidence.json` is the source of truth for KiranaOS parity claims. It compares current KiranaOS evidence with official product pages and prevents a source file, mock adapter or optimistic roadmap item from being described as a finished integration.

## Allowed claim language

- `verified`: implemented and covered by an executable test; runtime-dependent claims also have a current artifact.
- `partial`: useful code exists, but the benchmark workflow is incomplete.
- `external_blocked`: adapters or test fixtures may exist, but provider credentials, deployed infrastructure or physical hardware proof is missing. Never call this production-integrated.
- `absent`: the benchmark workflow is not implemented.

Every non-absent claim must include an official competitor URL, KiranaOS source paths, executable test commands and a verification date. Runtime-dependent claims must also name the missing proof or link a verified artifact. Evidence older than 120 days loses scoring confidence. Domain caps prevent strong local code from hiding missing legal submission, physical hardware, provider, live UX or production-infrastructure proof.

Run `npm run competitive:evidence` from `backend` for the current scored report. The same verifier runs inside the AI-safety test suite, so invalid or inflated evidence fails the normal backend test gate.

## Improvement loop

1. Start with the lowest capped domain or the highest-weight absent claim.
2. Implement the complete operator workflow, tenant isolation, audit history and failure recovery.
3. Add source and integration tests plus runtime proof when the capability crosses a provider or hardware boundary.
4. Update the claim status only after the verifier's evidence requirements are met.
5. Rerun local certification and publish the scored report with its caps and external gaps intact.

The matrix is deliberately conservative. Its score is evidence coverage, not market share, customer satisfaction or deployed scale.
