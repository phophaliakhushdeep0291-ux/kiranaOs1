# Competitive evidence and anti-hallucination policy

`docs/competitive-evidence.json` is the source of truth for KiranaOS parity claims. It compares current KiranaOS evidence with official product pages and prevents a source file, mock adapter or optimistic roadmap item from being described as a finished integration.

## Allowed claim language

- `verified`: implemented and covered by an executable test; runtime-dependent claims also have a current artifact.
- `partial`: useful code exists, but the benchmark workflow is incomplete.
- `external_blocked`: adapters or test fixtures may exist, but provider credentials, deployed infrastructure or physical hardware proof is missing. Never call this production-integrated.
- `absent`: the benchmark workflow is not implemented.

Every non-absent claim must include an official competitor URL, KiranaOS source paths, executable test commands and a verification date. Runtime-dependent claims must also name the missing proof or link a verified artifact. Evidence older than 120 days loses scoring confidence. Domain caps prevent strong local code from hiding missing legal submission, physical hardware, provider, live UX or production-infrastructure proof.

Run `npm run competitive:evidence` from `backend` for the current scored report. The same verifier runs inside the AI-safety test suite, so invalid or inflated evidence fails the normal backend test gate.

The verifier validates real calendar dates, fixed scoring weights, repository-scoped
paths and actual npm script names. Verified runtime artifacts must have a matching
canonical-JSON content checksum, a completed proof date matching the claim, and
workflow-specific evidence (not just a `passed` label). The canonical checksum is
SHA-256 over `JSON.stringify(JSON.parse(fileContents))`, avoiding line-ending
differences. It detects drift; it is not a digital signature or independent audit.
New runtime proof formats need explicit validators before being marked verified.

These checks do not execute the referenced test commands, refresh competitor
webpages, or prove that historical artifacts cover today's changed source. A
passing matrix check means its evidence records passed these consistency checks.
Current release readiness still requires running the complete release suite on a
stable source snapshot. Do not replace a newer failure with an older success.

On 2026-09-08, the local-release claim was corrected to partial: the latest full
run failed source-snapshot stability on September 2. The August 24 pass remains
historical. The resulting 7.68/10 internal evidence score is not an independent
product rating or proof of parity with any competitor.

## September 30 follow-up

The machine-readable score remains a September 8 evidence snapshot. Later
September 29 deployment evidence records successful live smoke/readiness checks
and a production dump, but does not prove scheduled offsite durability or a
restore of that production dump. Do not repeat the old “latest observed” dates
as a current release verdict, or promote the combined production claims merely
because a narrower check passed.

[September 30 offline verification](OFFLINE_WORKFLOW_VERIFICATION_2026-09-30.md)
records fresh local browser and regression results plus the fixes developed on
top of `7e0c21f9`. These are local QA results, not deployment, provider, physical
hardware, or a complete release-certification run. No competitive score was
raised by this work.

## Improvement loop

1. Start with the lowest capped domain or the highest-weight absent claim.
2. Implement the complete operator workflow, tenant isolation, audit history and failure recovery.
3. Add source and integration tests plus runtime proof when the capability crosses a provider or hardware boundary.
4. Update the claim status only after the verifier's evidence requirements are met.
5. Rerun local certification and publish the scored report with its caps and external gaps intact.

The matrix is deliberately conservative. Its score is evidence coverage, not market share, customer satisfaction or deployed scale.
