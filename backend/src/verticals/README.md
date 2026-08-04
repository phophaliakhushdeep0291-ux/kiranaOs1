# Backend verticals

Eleven sibling trades. None is a parent of another — a pharmacy is not a kind of
kirana shop — so nothing here nests, and `registry.js` is the only composition
point. Shared services reach profiles through the stable
`modules/shops/businessProfiles.js` facade and must not import an individual
vertical.

Do not put generic inventory, billing, payments or reporting code here. Put only
trade-specific orchestration here; reusable variant, batch, serial and ledger
logic belongs in a shared domain module.

## Layout

Every vertical is laid out the same way, so the file you want is in the same
place whichever trade you are in:

```
verticals/<trade>/
├── capabilities.js   what this trade can do
├── navigation.js     what this trade adds to the sidebar
├── profile.js        composes the two into a frozen preset
└── index.js          the module's public face
```

`profile.js` is deliberately thin. `capabilities.js` and `navigation.js` are the
two lists an owner-facing change actually edits, so they stay one file each with
nothing else in them.

## Navigation is composed, not written out

`profile.js` in this directory owns `SHARED_NAVIGATION` — dashboard, customers,
purchases, suppliers, sales, returns, reports, cash & payments, expenses, staff,
settings. Those are not trade features, and `defineBusinessProfile` appends them
to every profile automatically.

A vertical's `navigation.js` therefore lists **only what that trade adds**, and
must never repeat a shared key. This is enforced, not suggested — see
`tests/business-vertical-architecture.examples.js`.

It matters more than it looks. `bootstrapForShop` ships `navigation` to the
client, which hard-blocks any route whose key is missing. An entry a vertical
forgets is not a missing shortcut; it is a "Not part of this business profile"
wall on a core screen. Every profile used to hand-write its own full list and
every one of the eleven had dropped something — kirana had no `products`, ten
had no `cash-payments`, electronics had no `customers`.

Navigation keys are validated against `NAVIGATION_KEYS`. A typo is otherwise
invisible: it just silently hides a screen.

## Capabilities gate features, business type does not

Prefer `requireCapability("BATCH_TRACKING")` over
`requireBusinessType("pharmacy")`. Batch tracking is wanted by pharmacies,
cosmetics shops and kirana stores alike, and a capability check is the only one
of the two that a custom shop can opt into — `settingsForBusinessType` lets the
`other` type enable anything in the vocabulary.

Most capabilities are currently declarative: they describe the intended shape of
a trade and drive presets, but only `BATCH_TRACKING` is enforced at a route so
far. Adding a capability to this list does not by itself gate anything.

## Business type keys are persisted

The strings in `BUSINESS_TYPES` are written into every shop's
`settingsJson.businessProfile.businessType`, and the directory names here mirror
`frontend/src/features/verticals/<key>/`. Renaming either is a data migration
plus a cross-stack rename, not a tidy-up. `auto_parts` is the one key whose
directory differs (`auto-parts/`).
