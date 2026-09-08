# Competitive recheck — 2026-09-08

The internal evidence checklist currently scores 7.68/10. This is not a market
rating, customer-validation result, or proof that KiranaOS equals a leading POS.
The change from 7.81 reflects correction of an overstated local-release claim:
the most recent full original-worktree certification failed source stability.
An older success remains historical evidence only.

## Current official benchmarks

- Zoho describes multi-location stock management, online order fulfillment and
  pickup, synchronized online/in-store data, and offline billing. Those are
  end-to-end operational benchmarks, not merely screen-count targets.
  [Zoho POS features](https://www.zoho.com/en-us/pos/features/?source_from=actions-on-customers).
- GOFRUGAL describes central pricing, outlet reporting, chain-wide loyalty,
  warehouse repacking and stock transfers, and omnichannel connections. Matching
  individual APIs does not establish that the entire chain workflow is proven.
  [GOFRUGAL multi-store POS](https://www.gofrugal.com/multi-store-pos/).
- Shopify documents supported offline card readers, per-device and per-order
  limits, pending-payment state, and processing or decline after reconnection.
  Its documented hardware/region restrictions must not be generalized to all
  markets. KiranaOS has no equivalent credentialed offline-card acceptance proof.
  [Shopify offline payments](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-payments).

These are vendor-published feature descriptions, not independent reliability
studies. The recheck does not estimate market share or infer competitors' uptime.

## KiranaOS evidence and remaining proof

1. Recovery improved: the cafe command now uses exact shared-snapshot restore
   verification. Six local PostgreSQL scenarios passed, including one-paise
   corruption and incorrect-checksum rejection before target reset. The retained
   test schema contained 143 tables and 131 migration records, not a proof that
   every current migration has been deployed.
2. AI grounding improved: the isolated safety suite passed with server-composed
   tool evidence, atomic plan execution, uncertainty handling, and zero unsafe
   accepts on the named adversarial corpus. Novel prompts and production error
   rates remain unproven; see the hallucination-reduction plan.
3. Whole-release certification remains pending for current source. A hash-checked
   independent snapshot is being used so parallel edits do not invalidate the
   run. A snapshot manifest is provenance, not test success.
4. Hardware/provider gaps remain: physical-device compatibility, acquirer
   credentials, offline acceptance terms, GSP submission, native marketplace
   ingestion, and live settlement/recovery require their own proofs.
5. Cloud operations and accessibility remain incomplete: deployed failover,
   monitored backup cadence/retention, production-scale recovery, and manual
   assistive-technology workflows cannot be certified by local component tests.

## Next operator-facing checks

- Test payment intent recovery across refresh, network loss, and failed checkout
  script loading; no duplicate charge or unsupported success message may result.
- Exercise online order stock reservation through fulfillment, cancellation,
  refund and payout reconciliation across two locations.
- Finish the stable-snapshot release run and investigate each failed stage; do
  not change the score merely because a narrower suite passes.

The checker now rejects invalid dates, missing npm scripts, changed runtime
artifact content, and proof files whose actual workflow did not pass. These
consistency checks reduce unsupported claims; they do not replace execution or
independent customer and provider validation.
