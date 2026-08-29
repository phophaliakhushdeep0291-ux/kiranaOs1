# Shipping the restaurant two-plan change

Restaurant is sold as two plans: **Counter** (₹699/mo, ₹6,990/yr) for a takeaway,
cloud kitchen, bakery or tea shop, and **Dine-in** (₹1,499/mo, ₹14,990/yr) for a
floor with tables.

The line is one question — *do guests sit down?* — because it is the one a
shopkeeper answers before the sentence finishes, and because it is where the
software genuinely divides: a cloud kitchen never opens `tables`, `kot` or
`service-ops`.

## The order matters

Two features move **up** a tier in this change: `restaurant_tables` and
`restaurant_kot` go from Counter to Dine-in. For a restaurant already paying,
that is a working screen being taken away mid-service unless it is frozen first.

`subscription.service.js` reads:

```js
featuresJson: subscription.entitledFeaturesJson ?? plan.featuresJson
```

A subscription carrying its own snapshot keeps what it has when the plan
underneath it changes. A subscription without one falls through to the plan and
silently loses whatever moved.

**So the freeze runs before the config reaches production, not after.**

```bash
node scripts/freeze-subscription-entitlements.js --check
```

Exits non-zero while any subscription is unfrozen, so a pipeline can be gated on
it. Then:

```bash
node scripts/freeze-subscription-entitlements.js
```

It writes `entitledFeaturesJson` and `lockedPrice*Paise` only where they are
null — an existing snapshot may record a more generous entitlement than the plan
now lists, which is exactly the thing worth keeping, so it is never overwritten.

## What each side gets

| | Counter | Dine-in |
| --- | --- | --- |
| Menu, courses, portions, add-ons | ✅ | ✅ |
| Recipes — selling a dish moves its ingredients | ✅ | ✅ |
| Batch and expiry | ✅ | ✅ |
| Billing, GST, offline, backup, own online ordering | ✅ | ✅ |
| Tables and running table bills | — | ✅ |
| Kitchen tickets routed by station | — | ✅ |
| Per-table guest QR ordering | — | ✅ |
| Reservations | — | ✅ |
| Devices / outlets / staff | 2 / 1 / 3 | 10 / 3 / 20 |

`restaurant_recipe_inventory` moves **down** to Counter. A cloud kitchen lives on
ingredient depletion; putting it behind the table plan would sell that shop a
floor it does not have in order to reach the one stock feature it needs.

## Where it is enforced

| Surface | Gate |
| --- | --- |
| `tables/tables.routes.js` | `requireFeature("restaurant_tables")` |
| `kot/kot.routes.js` | `requireFeature("restaurant_kot")` |
| `service-ops/service-ops.routes.js` | `requireFeature("restaurant_tables")` |
| reservation routes within service-ops | `requireFeature("restaurant_reservations")` |
| `menu/menu.routes.js` | `requireFeature("restaurant_menu")` |
| `recipes/recipes.routes.js` | `requireFeature("restaurant_recipe_inventory")` |
| public `/shops/:shopId/tables/:tableId/*` | `restaurant_table_qr`, answered as **404** |

The guest routes answer 404 rather than 403 on purpose. The person holding the
phone is a diner: they have done nothing wrong, cannot act on "feature not
included", and are owed no detail about what this restaurant pays for. A sticker
that is no longer in service simply does not resolve.

## Old plan codes stay valid

A till that has not synced in a fortnight still sends `growth` or `pro`. All four
codes remain in `PLAN_CONFIGS`; for a restaurant, `pro` resolves onto Dine-in —
the same price and the same features — rather than a third plan nobody can buy.
`offeredPlanCodesForBusinessType("restaurant")` returns `["starter", "growth"]`,
and that is what checkout should render.

## Who sees a change

| Today | Pays | Becomes | Will pay |
| --- | --- | --- | --- |
| starter | ₹599 | Counter | ₹699 |
| growth | ₹1,499 | Dine-in | ₹1,499 |
| pro | ₹1,999 | Dine-in | ₹1,499 |

Every existing restaurant is price-locked by the freeze, so the ₹100 rise reaches
new sales only. Dine-in deliberately lands on today's growth price: that cohort
is not re-priced, and the pro cohort gets cheaper while keeping everything.

## Tests

- `tests/restaurant-two-plans.examples.js` — the split, both prices, yearly as
  exactly ten months, Dine-in a superset of Counter, the registry agreeing with
  the plans it gates, and no other trade moved.
- `tests/subscription-entitlement-freeze.examples.js` — `--check` fails while
  anything is loose and writes nothing, the freeze records features and price,
  and a second run does not re-photograph.

Both run in `npm run test:restaurant`.
