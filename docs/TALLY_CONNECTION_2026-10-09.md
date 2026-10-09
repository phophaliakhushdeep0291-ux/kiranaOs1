# TallyPrime connection — 9 October 2026

The connection is implemented in **Settings → Integrations → Connect TallyPrime**.
It is a one-way transfer of synced INR accounting records to a local TallyPrime
company. It retains the existing plan/owner/admin access controls. UAE VAT books
are explicitly refused until their mapping is validated; an AED ledger must
never go through the Indian GST exporter.

## Shop setup

1. Once the signed installer is released, install Hardware Bridge **1.5.0** on the Windows PC that
   runs TallyPrime. In Hardware Bridge Setup, enable **Connect TallyPrime** and
   enter its server port (normally 9000). A printer is optional for Tally use.
2. Open the intended company in TallyPrime. Enable **Server** or **Both** under
   F1 → Settings → Connectivity → Client/Server Configuration using the same port.
3. Back up the company. Review import settings with the accountant, including
   **Overwrite vouchers with the same GUID** before repeat imports. Select
   **Ignore Duplicates** for existing masters to preserve their settings/balances,
   and check that existing ledger groups and tax settings match the exported mappings.
4. In KiranaOS, enter the six-character pairing code from the bridge, then select
   **Check Tally connection**. Already-paired browsers can leave the code blank.
5. Select the detected company and link it. The base currency must match the shop.
   Unknown/ambiguous currency symbols are refused. The company link is fixed:
   changing company requires reconciliation rather than silently reusing history.
6. Choose a date range and books. **Preview unsent vouchers** shows the destination,
   voucher count, previously sent count, master count and exact invoice numbers.
7. **Send vouchers** imports masters first, then vouchers. Review the results in
   Tally's Day Book, cash/bank ledgers and tax ledgers before routine operation.

No port forwarding, public Tally server, cloud-server localhost routing or API
credentials entered into the browser are required. The paired bridge only talks
to its configured loopback Tally endpoint and rechecks company identity/currency
before each write.

## Export and recovery

- Sales and sales returns, purchases, purchase returns, credit collections, paid
  expenses and completed production runs retain the existing voucher mappings.
- Accounts-only export is the default. Enable stock lines only for a Tally
  company configured to carry inventory. Stock quantities retain three decimal
  places, including small weight sales, returns and production movements. Finer
  quantities are refused before transfer rather than rounded into different stock;
  use accounts-only sales export or reconcile the stock unit first.
- **Prepare XML files** includes the selected range, including previously sent
  vouchers. Download/import masters first, then vouchers. Downloading does not
  mark them as sent. Manual imports must be reconciled before using direct send
  for the same period.
- Remote IDs and GUIDs are deterministic per shop/document. A durable local
  bridge journal also prevents accepted/uncertain vouchers being blindly resent,
  including after restart or simultaneous requests through the same bridge.
- A saved browser recovery record separates “sending” from “accepted.” If Tally
  accepted the vouchers but cloud confirmation failed, **Save confirmation only**
  retries the signed acknowledgement and does not send vouchers again.
- After a lost/partial response, the user must verify every listed voucher and
  amount in Tally before confirming. Missing vouchers require reconciliation in
  Tally. An uncertain import is deliberately not auto-retried.
- Backend confirmation is tied to the exported document manifest, shop and linked
  company using an HMAC; confirmation and its audit commit together. A client
  cannot modify document IDs or reuse another shop's receipt.
- The bridge journal has a 10,000-batch ceiling and refuses further writes when
  full. Archive/reconciliation is an operator procedure, not automatic pruning.

## Boundaries and acceptance

This is not two-way synchronisation or a tax-filing integration. Changes,
cancellations and manual imports after a transfer require accountant reconciliation.
An app receipt proves the connector's observation/explicit user reconciliation;
it is not independent audit evidence from Tally. The GUID overwrite setting and
other counters using a different bridge still matter.

The implementation is tested against isolated local Tally XML stub responses,
not a licensed Windows Tally installation. A real TallyPrime version/company must
still validate company discovery, existing-master import, duplicate import settings,
GST/inventory mappings and the final account totals. The Windows setup compiles,
but the signed installer must still be built/released. No production data was migrated
and no real Tally company was written during development.

## Verification and release status

Local verification on 9 October 2026 passed:

- Frontend production gate: typecheck, translations, build, bundle limits and
  production checks; **3,453 tests passed, one skipped**. Initial JavaScript was
  274.2 kB gzip against 300 kB, and the largest offline bundle was 1,283.7 kB
  against 1,290 kB. Existing limits were not raised.
- Hardware Bridge: **39 tests passed**, covering paired company discovery,
  destination validation, partial imports, response loss, concurrent requests and
  durable retry protection across restarts.
- Isolated backend accounting/Tally regressions and 24 API integration tests
  passed, alongside backend production checks and migration safety checks.

The [Windows check on commit 248febca](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/actions/runs/37911116584)
passed all 39 bridge tests and compiled the self-contained Windows setup. The
subsequent stock-quantity correction passed the isolated backend regression suite.
Compilation is
separate from a signed release and from testing a real Tally company. The
repository currently has no signing secrets or frontend-origin release variable;
configure `KIRANA_CODE_SIGN_PFX_BASE64`, `KIRANA_CODE_SIGN_PASSWORD` and
`KIRANA_FRONTEND_ORIGINS` through the repository's protected CI settings before
running the existing signed-installer workflow for version 1.5.0.

Deploy additive migrations 000143–000145 and generate the matching Prisma client
with the API release (000142 is also required on installations that have not
deployed the market foundation). This document does not authorize deployment.

Official references checked for this implementation:
- [Tally XML collection and export examples](https://help.tallysolutions.com/sample-xml/)
- [Importing XML/JSON and version requirements](https://help.tallysolutions.com/import-data-from-xml-or-json/)
- [Import configuration and GUID overwrite behaviour](https://help.tallysolutions.com/getting-started-with-importing-data-into-tallyprime/)
- [Official API Explorer connectivity setup](https://tallysolutions.com/tallyprime-api-explorer/)
