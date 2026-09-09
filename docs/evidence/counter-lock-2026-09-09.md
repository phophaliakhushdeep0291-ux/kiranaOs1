# Counter lock and offline device unlock — 9 September 2026

Local working-tree verification only. This does not complete the overall application audit or the production release gate.

## Corrected behavior

- Wrong PINs, rejected requests, timeouts, network loss and malformed success responses cannot unlock the counter. A PIN needs an explicit server `valid: true` for the same authenticated session. The normal refresh-token secret rotation does not invalidate that session identity.
- Startup and idle locks apply offline. Protected page components do not mount before the saved local policy is checked. Reload does not renew the idle timestamp. Capture-phase activity handling blocks the first click after expiry before a page action can run.
- Security policies are session-scoped. A failed local settings read uses protective defaults. Late reads cannot overwrite a new account's policy or a newer settings decision. Invalid booleans and unrecognized timeout labels cannot silently disable protection.
- Offline screen unlock uses a device authenticator enrolled through Settings → Security, after online owner-PIN approval. Enrollment is scoped to the user, shop, authenticated session and device. Logout removes it; old unscoped enrollments must be enrolled again. No owner PIN or reusable PIN hash is stored locally.
- Device assertions validate credential ID, user handle, request challenge/type/origin, relying-party hash, user-presence and user-verification flags, signature counter and the cryptographic signature. ECDSA P-256 and RSA SHA-256 are supported. Pending responses cannot reopen a logged-out, switched or re-enrolled session.
- A device without enrolled offline unlock must reconnect to verify its owner PIN. The lock and Security settings explain this in English/Hindi. Cached merchant records are not deleted by this policy.

The verification follows the relevant [WebAuthn assertion checks](https://www.w3.org/TR/webauthn-2/#sctn-verifying-assertion) and [public-key response accessors](https://www.w3.org/TR/webauthn-2/#sctn-public-key-easy). Browser integration uses Chrome's [virtual authenticator](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/) solely in an isolated test profile. Its simulated private keys remain in the harness process, not the app, logs or evidence report.

## Verified evidence

- `npm run prod:check`: **2,437 tests passed, 1 skipped**, TypeScript passed, 5,782 translation keys checked, production build passed, bundle and production-app checks passed. Initial JS: **852.5 kB raw / 257.3 kB gzip**. Log: `frontend/qa-artifacts/counter-lock-production-verified-20260909.log`.
- Focused behavioral tests use real cryptographic key generation and signatures, not mocked signature verification. Coverage includes negative/malformed PIN responses, network errors, session boundaries/rotation, enrollment approval, forged/replayed/wrong-account assertions, cancellation, missing storage and policy read races.
- Fresh-profile production browser verification passed **53/53 routes** after service-worker installation, full Chrome shutdown/relaunch and network disablement. Build: `counter-lock-verified-20260909`. Report time: 9 September 2026, 06:06:14 UTC.
- Before enrollment: wrong PIN, offline PIN attempt and offline reload all retained the lock without a mounted business-page `main`. Reconnecting and entering the correct PIN resumed the counter.
- After enrollment via the real settings UI: cold offline startup locked, bogus signatures and missing presence/verification bits were rejected, and a valid device assertion unlocked without network access.
- An expired idle timestamp followed by a real dashboard link click left the browser on the dashboard lock screen instead of navigating to billing. Verified device unlock resumed it.
- Cloud-only review persistence still passed: header, Sync Status and Daily Closing agreed after restart. Product and customer records remained available. Local route-readiness measurements: 183–793 ms, average 269 ms; these are not production/device performance guarantees.
- Report/screenshots: `frontend/qa-artifacts/counter-lock-verified-20260909/`. The 390×844 enrolled lock screenshot was visually inspected.

QA used a separate API on port 3001 and `backend/prisma/sync-health-test-20260908-6a9e.db`, with no merchant financial data changes. Earlier passing browser runs are retained, but the verified directory above includes the final token-rotation, policy-cache and first-click fixes.

## Boundaries and next defects

- This is a screen lock, not encryption of the offline business database. It does not resist arbitrary script execution, developer-tools changes, or a compromised OS/browser. Device custody still needs an OS lock and disk encryption. Server PIN checks remain authoritative for protected financial actions.
- Real Windows Hello / Android / Apple hardware has not been certified here. The browser proof uses a virtual authenticator; it is not physical fingerprint/face evidence.
- **Next confirmed defect:** Security's `ChangePinDialog` labels itself as owner PIN management but calls `useChangePassword`, with six-character password validation. The backend changes `passwordHash`, not `pinHash`. Correct the workflow and its authorization/rotation tests rather than relabeling the result as a PIN change.
- Existing release requirements (candidate CI, PostgreSQL concurrency, payment/receipt hardware, backup custody and field evidence) remain open under `RELEASE_GATE.md`.
