# Shop pilot follow-up — 2 October 2026

PR #394 merged after release certification passed. The synthetic shop's browser closing for 1 October still reconciles: sales ₹798.50, cash received ₹299.75, UPI received ₹250.50, cash expenses ₹50.50 and opening float ₹500. Expected and counted cash both equal ₹749.25.

Backup/recovery and sync checks passed in isolated databases (19 and 61 integration tests respectively). Seven business-type service fixture suites passed. These are not physical shop or full browser certification for every business type.

The browser pilot exposed misleading sync diagnostics: a historical cancellation rejected with `Wrong owner PIN` was described as saving a bill failing because of a temporary server problem, with an automatic-retry promise. Missing and incorrect owner PIN errors now identify the approval problem, require attention and name cancellation/restoration correctly. Regression coverage uses the stored error string without an HTTP status, matching the observed server record.

The local queue was empty and the fleet showed one current terminal with zero sequence lag. A historical server failure can remain after local dismissal; this change does not erase server history. Physical printing, payment settlement, full network disconnection and independently operating two browser counters still require validation.
