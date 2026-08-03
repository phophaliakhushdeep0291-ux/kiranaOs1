# Backend verticals

Each directory owns one business-profile preset. `registry.js` is the only
composition point. Shared services access profiles through the stable
`modules/shops/businessProfiles.js` facade and must not import individual
verticals.

Do not put generic inventory, billing, payments or reporting code here. Put
only trade-specific orchestration here; reusable variant, batch, serial and
ledger logic belongs in shared domain modules.
