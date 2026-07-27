# Audit Risk Scoring

Implementation: `backend/src/modules/assurance/risk-scoring.service.js`

Every risk score in this product is produced by the formula below and nothing
else. No model output participates. The full derivation — every input, multiplier
and per-rule contribution — is persisted on the finding in
`scoreBreakdownJson` and shown in the UI, so any score can be recomputed by hand
from the stored record alone.

## The formula

```
contribution(rule) = min(60, round(weight × severityMultiplier))
base               = min(100, Σ contribution(rule))
modified           = clamp(round(base × materiality × history), 0, 100)
final              = max(modified, declared rule floor)
```

### Inputs

**weight** — the rule's `defaultWeight` (8–45 across the catalog), unless the shop
has set a `weightOverride` in `AuditRule`. The breakdown records which was used
via `weightSource: "rule_default" | "shop_override"`.

**severityMultiplier**

| Severity | Multiplier |
|---|---|
| LOW | 0.5 |
| MEDIUM | 1.0 |
| HIGH | 1.5 |
| CRITICAL | 2.0 |

**Per-rule cap (60).** One rule can contribute at most 60 points, so a single
noisy rule cannot saturate a score on its own. When the cap bites, the breakdown
records `cappedAt: 60` alongside the uncapped `rawContribution`.

**materiality** — from the transaction's amount. Bigger money raises the score,
but within bounds: materiality can never manufacture a finding, only re-rank one.

| Amount | Multiplier |
|---|---|
| ≤ ₹500 | 0.8 |
| ₹500 – ₹5,000 | 1.0 |
| ₹5,000 – ₹25,000 | 1.15 |
| > ₹25,000 | 1.3 |

The amount used per entity type: bill grand total, customer outstanding, stock
value at recorded cost, purchase total, expense amount, closing total sales.
Sync events have no amount, so they always sit in the 0.8 band.

**history** — repeat-offender modifier, counted from prior findings on the *same
entity* that a human resolved as `CONFIRMED_ISSUE` or `CORRECTED`. Unreviewed
findings never inflate a score.

| Prior confirmed findings | Multiplier |
|---|---|
| 0 | 1.0 |
| 1–2 | 1.1 |
| ≥ 3 | 1.2 |

**Declared rule floor.** A rule may declare `minimumRiskScore`. It is applied
last, recorded in the breakdown, and attributed to the rule that set it.

This exists because the per-rule cap of 60 makes it impossible for any single
rule to reach CRITICAL, and some defects are severe regardless of the rupee
amount. Currently one rule declares a floor: `BILL_CROSS_SHOP_REFERENCE`
(floor 85) — a cross-tenant reference is a data-isolation defect whether the bill
is ₹50 or ₹50,000. The breakdown exposes `scoreFloor`, `scoreFloorRuleCode` and
`scoreFloorApplied` so the override is never invisible.

## Risk levels

| Level | Score |
|---|---|
| LOW | 0 – 29 |
| MEDIUM | 30 – 54 |
| HIGH | 55 – 79 |
| CRITICAL | 80 – 100 |

## Confidence

Confidence is **not** a probability and not a model output. It is a deterministic
data-sufficiency measure starting at 1.0 with declared deductions, floored at 0.3:

| Deduction | Amount | Trigger |
|---|---|---|
| Insufficient baseline | 0.15 | a triggered rule's details report `baselineStatus: INSUFFICIENT_DATA` or a zero sample count |
| Advisory attribution | 0.10 | a rule reports `staffAttributionAvailable: false` or `userIdAttributionAvailable: false` (stock movements, expenses) |
| Offline origin | 0.05 | the record carries a source device, so client timestamps are not authoritative |

Every applied deduction is listed in `confidenceReasons` on the finding. When
nothing is deducted the reason reads "all triggered rules used complete,
server-authoritative data".

## Worked example

`BILL_MARKED_PAID_WITHOUT_PAYMENTS` on a ₹2,500 bill with no prior findings:

```
weight 38 (rule default) × 2.0 (CRITICAL)      = 76 raw
min(60, 76)                                     = 60   ← per-rule cap applied
base = min(100, 60)                             = 60
materiality: ₹2,500 → 1.0                       = 60
history: 0 prior confirmed → 1.0                = 60
no rule floor declared                          = 60
final = 60 → HIGH
confidence = 1.0
```

A second example, from the MVP acceptance run — a staff bill with a 60% discount
that also failed its own arithmetic:

```
BILL_DISCOUNT_WITHOUT_AUTHORIZATION  26 × 1.5 = 39
BILL_EXCESSIVE_DISCOUNT              20 × 1.0 = 20
BILL_TOTAL_MISMATCH                  40 × 2.0 = 80 → capped to 60
base = min(100, 39 + 20 + 60) = 100
materiality ₹600 → 1.0 ; history 1.0
final = 100 → CRITICAL
```

## Reproducibility guarantees

1. **Same inputs ⇒ same score.** Rules read only the context bundle; none reads
   the clock or a random source beyond what the context supplies. Verified by
   `assurance-engine.integration.test.js` ("risk score is deterministic").
2. **Input hash.** Every `AuditEvaluation` stores `inputHash`, a SHA-256 over the
   canonical inputs used. An unchanged entity re-evaluates to an identical hash.
3. **Immutable evaluation record.** `AuditEvaluation.resultJson` holds the whole
   result, so a historical conclusion survives later edits to the underlying
   transaction.
4. **Version stamps.** Every finding records `engineVersion` and
   `rulesetVersion` (a content hash over all `ruleCode@version` pairs), plus the
   `ruleVersion` of each rule that fired. Changing any rule produces a new
   ruleset version, so old findings remain traceable to the logic that raised them.
5. **Test coverage.** Score arithmetic, level boundaries, the per-rule cap, the
   100-point clamp, materiality bands, history modifiers and end-to-end
   reproducibility from the persisted breakdown are all asserted in the test
   suites; the MVP acceptance test re-derives every flagged finding's score from
   its stored breakdown.

## What scoring deliberately does not do

- It does not rank by "likelihood of fraud". It ranks by how much a finding
  should be looked at, given how severe the broken control is and how much money
  is involved.
- It does not learn. There is no model, no training and no black box; changing
  behaviour means changing a weight or a rule, visibly and with a version bump.
- It does not decide anything. A score never closes, hides or escalates a finding
  on its own; a human transition is always required.
