# KiranaOS Financial Ledger Consistency Contract

This contract prevents negative udhar, duplicate payments, and dashboard/customer drift.

## Source of truth

`Customer.udharAmount` is only a cache. The source of truth is `UdharLedger`.

A customer's outstanding balance is always:

| Ledger row type | Meaning | Balance effect |
|---|---|---:|
| `debit` + `mode=credit` | Bill amount moved to udhar | `+amount` |
| `debit` + `mode=opening_balance` | Customer opening balance | `+amount` |
| `debit` + `mode=reversal` | Reversal of a customer payment | `+amount` |
| `debit` + `mode=adjustment` | Owner-approved balance increase | `+amount` |
| `debit` + `mode=system_repair` | One-time repair to correct legacy negative ledger | `+amount` |
| `payment` + `mode=cash` | Customer paid by cash | `-amount` |
| `payment` + `mode=upi` | Customer paid by UPI | `-amount` |
| `payment` + `mode=reversal` | Credit bill cancelled | `-amount` |
| `payment` + `mode=adjustment` | Owner-approved balance decrease | `-amount` |

The API must never return a negative udhar outstanding. If legacy rows calculate negative, the repair job creates a `system_repair` debit so the ledger returns to zero.

## Bill/payment/udhar consistency table

| Business action | Bill row | Payment rows | UdharLedger rows | Customer cache update |
|---|---|---|---|---|
| Fully paid cash sale | `Bill.grandTotal`, `paidAmount=grandTotal`, `creditAmount=0` | `cash = grandTotal` | none | no udhar change |
| Fully paid UPI sale | `paidAmount=grandTotal`, `creditAmount=0` | `upi = grandTotal` | none | no udhar change |
| Split cash+UPI sale | `paidAmount=cash+upi`, `creditAmount=0` | one row per mode | none | no udhar change |
| Full udhar sale | `paidAmount=0`, `creditAmount=grandTotal` | none | `debit/credit = grandTotal` linked to `billId` | recompute from ledger |
| Partial paid + udhar sale | `paidAmount=cash+upi`, `creditAmount=remaining` | cash/upi rows only | `debit/credit = remaining` linked to `billId` | recompute from ledger |
| Customer pays old udhar | no bill row | no bill payment row | `payment/cash` or `payment/upi` | recompute from ledger |
| Reverse customer payment | no bill row | no bill payment row | mark original payment reversed + add `debit/reversal` | recompute from ledger |
| Cancel paid bill | bill status `cancelled` | original payments stay for audit | no udhar ledger unless bill had credit | no udhar change |
| Cancel credit bill | bill status `cancelled` | original payments stay for audit | `payment/reversal = bill.creditAmount` linked to `billId` | recompute from ledger |
| Restore cancelled credit bill | bill status `active` | original payments remain | `debit/credit = bill.creditAmount` linked to `billId` | recompute from ledger |

## Invariants enforced in code

1. `paidAmount + creditAmount + waivedAmount === grandTotal` for every confirmed non-estimate bill.
2. `buyerPaidAmount <= grandTotal`.
3. Credit/udhar bills require a customer.
4. Customer payment cannot exceed derived ledger outstanding.
5. `Customer.udharAmount` is recomputed from ledger after every debit/payment/reversal.
6. Customer update APIs must not directly overwrite `udharAmount`.
7. Customer opening balance creates an `UdharLedger` debit row.
8. Udhar summary/list views derive balances from ledger instead of trusting stale customer cache.

## Device-limit contract

1. Device limit means active login sessions by unique `deviceId`, not historical registered Device rows.
2. Logout revokes the session and frees the slot.
3. Access tokens include `sessionId`; protected requests verify the session is still active.
4. Protected device APIs require the request `x-device-id` to match the active session's device id.
5. Development override is disabled by default and only works when `ENABLE_DEV_DEVICE_LIMIT_OVERRIDE=true`.
