# Money Safety and Future Paise Migration

KiranaOS currently stores money fields as `Float` in Prisma/SQLite/PostgreSQL for backward compatibility with the existing app and test data.

Step 8 does **not** convert database columns to integer paise. Instead, it reduces floating-point drift now and documents the future safe migration path.

## Current rule

All money calculations must go through `src/utils/money.js`:

- `round2(value)` — normalize one value to two decimals through integer paise.
- `toPaise(value)` / `fromPaise(paise)` — in-memory conversion helpers.
- `sumMoney(values)` — sum money via integer paise, not raw floating-point addition.
- `addMoney(...values)` — add money values through integer paise.
- `subtractMoney(start, ...values)` — subtract values through integer paise.
- `multiplyMoney(amount, multiplier)` — multiply a rate/amount and round once to paise.
- `moneyEquals(a, b)` — compare money values using paise.

## Why this matters

JavaScript floating-point math can produce values such as:

```text
0.1 + 0.2 = 0.30000000000000004
```

That is dangerous for validations like:

```text
paid + credit + waived === grandTotal
```

So backend validations must use `moneyEquals()` and money totals must use `sumMoney()` / `addMoney()`.

## Fields to migrate later

A future migration should convert these fields from rupee `Float` columns to integer paise columns:

### Bill

- `subtotal`
- `discount`
- `gst`
- `grandTotal`
- `actualAmount`
- `buyerPaidAmount`
- `waivedAmount`
- `grossProfit`
- `paidAmount`
- `creditAmount`

### BillItem

- `ratePerRateUnit`
- `costPerRateUnit`
- `lineTotal`
- `lineCost`
- `lineProfit`

### Payment

- `amount`

### Product

- `costPerRateUnit`
- `minPricePerRateUnit`
- `defaultPricePerRateUnit`

### Customer / UdharLedger

- `udharAmount`
- `amount`

### StockLedger / PurchaseHistory

- `purchaseBillAmount`
- `calculatedBuyRate`
- `damageLossValue`
- `pricePerRateUnit`
- `totalCost`
- `billAmount`

## Suggested migration plan

1. Add new nullable integer paise columns beside the current Float columns.
2. Backfill paise columns using `Math.round(oldValue * 100)` in a one-time migration script.
3. Update backend reads/writes to use paise columns internally and convert to rupees only at API boundaries.
4. Run reconciliation tests comparing old Float values and new paise values.
5. Once stable, remove old Float columns or keep them as generated/display-only columns.

## Current safety checklist

Until that migration happens:

- Do not compare raw money floats with `===`.
- Do not use raw `Math.round(value * 100) / 100` outside `src/utils/money.js`.
- Do not build report/payment totals with raw `reduce((s, x) => s + x.amount, 0)`.
- Use `multiplyMoney()` for rate × quantity calculations.
- Use `sumMoney()` for reports and payments.
- Use `moneyEquals()` for bill-payment validation.

## Phase 27 update: paise shadow columns

Phase 27 adds a non-breaking PostgreSQL transition layer instead of immediately replacing every Float column.

New nullable `BigInt` shadow columns were added beside money Float fields, for example:

- `Bill.grandTotal` → `Bill.grandTotalPaise`
- `Bill.paidAmount` → `Bill.paidAmountPaise`
- `BillItem.lineTotal` → `BillItem.lineTotalPaise`
- `Payment.amount` → `Payment.amountPaise`
- `Customer.udharAmount` → `Customer.udharAmountPaise`
- `Product.defaultPricePerRateUnit` → `Product.defaultPricePerRateUnitPaise`

The migration backfills paise values using:

```sql
ROUND((COALESCE("moneyField", 0)::numeric * 100))::bigint
```

This allows production to verify every rupee Float value has a matching integer paise value before runtime code is switched to paise-first reads/writes.

### New commands

Read-only reconciliation:

```bash
npm run money:paise:reconcile
```

Backfill/repair after taking a database backup:

```bash
ALLOW_MONEY_PAISE_BACKFILL=true npm run money:paise:backfill
```

The PostgreSQL production proof now includes read-only reconciliation through `npm run proof:postgres`.

### Important safety rule

Do not remove the old Float columns yet. Phase 27 is a migration bridge. The next safe step is to update service writes so every bill, payment, udhar ledger, stock ledger, product price, and purchase history write stores both Float and paise fields consistently. Only after that should API reads become paise-first.
