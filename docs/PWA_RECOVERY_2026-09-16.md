# Offline restart and update recovery — 16 September 2026

This follow-up starts from `fd347a3e30e9f87dced9c8b4e3d0d0c617f8740f` on `work/production-e2e-readiness`. That revision passed [release certification](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/actions/runs/35130683949), including PostgreSQL and Redis. Its PR run skipped image proof as configured; these subsequent changes require their own CI run.

## Defects and corrections

- **Interrupted deployment could corrupt the offline shell.** An old worker stored a newly fetched `index.html` in its own cache, even though its verified install only contained the previous build's scripts. Online navigation still receives fresh HTML, but now only an atomic worker install publishes a new offline shell.
- **Hosting errors hid the installed counter.** HTTP 5xx, 408 and 429 now fall back to the existing offline shell. Explicit access/not-found responses retain their original behavior. If no shell exists, the host's response remains visible.
- **Public table ordering was intercepted.** `/t/<shop>/<table>` now bypasses the worker like `/order/...`; the owner's `/tables` route retains offline support.
- **Readiness omitted lazy boot files.** The installed core now includes the shared layout and the English/Hindi dictionary chunks. The release gate checks the emitted manifest and files, including the layout's transitive imports and styles, instead of assuming that route files imply a complete boot.
- **Cached modules missed on hosts using `Vary: Origin`.** Install-time requests and browser module imports can send different Origin headers. The local preview returned `Vary: Origin`, and inventory remained on “Opening…” until the servers resumed. Cache matching now ignores Vary only for same-origin immutable files named in the build's core/vertical manifests. Other resources retain normal Vary matching.
- **Offline stock history disappeared on reload.** The ledger query read only memory before returning an offline result. It now hydrates the scoped persisted cache first, retaining the existing guard against products from another shop and the server's authority to replace old synced history.

The worker behavior tests execute the real worker source with controlled fetch/cache implementations. They cover deployment changes, hosting errors, a hanging connection, late responses, public/sensitive route bypass, Origin variation and normal image variation. Build-verification tests reject missing layout, language, shared script and stylesheet files.

## Size tradeoff

The previous offline size measurement omitted existing code required to boot: the layout and three language chunks. Their unique dependency closure adds about 1 MB raw / 229 kB gzip to the largest shop's background install (3,439.8 → 4,447.2 kB raw; 1,022.4 → 1,251.6 kB gzip). Startup remains about 259.3 kB gzip with its existing 300 kB limit. No route or vendor was added to the startup imports.

The complete offline install is now bounded at 4.5 MiB raw / 1.25 MiB gzip. This explicitly accounts for the previously omitted files; it is not a startup budget increase. Each build continues to report all per-shop payloads and check boot coverage. Both languages remain available after installation, including an offline language switch.

## Browser test boundary

Testing uses the existing dummy shop and isolated SQLite database, with only this worktree's frontend preview and test API paused using process signals. Browser connectivity itself remains enabled, so this simulates an unresponsive app host and API. A fresh tab opened its cached lock screen and correctly required an online PIN check or prior offline authenticator enrollment. This does not certify physical biometric enrollment or an operating-system/browser process restart.

The initial inventory loading failure and the fresh-tab lock behavior are recorded in [the evidence folder](evidence/pwa-recovery-2026-09-16/). Target-device checks, live providers, deployment backup/restore and Docker image proof remain separate launch requirements described in [the production E2E report](PRODUCTION_E2E_2026-09-16.md).

After the cache-matching fix, inventory reopened with both servers paused and showed all three products. Billing also opened and saved a ₹25 cash sale as `PENDING-BAD833`. Restoring the servers automatically synced it as `KOS-2026-000005`. The isolated server reconciliation confirmed five distinct bills totalling ₹125, soap stock 30 → 25, customer credit ₹0, and exactly one payment and one stock movement for the outage sale. The servers were restored after each test.

The final stock-history change was verified separately on the built `index-CC__zuLh.js`: with the test API paused and the frontend host running, a full page reload restored the three products, ₹1,995 stock value and saved soap sale movements once the API request timed out. See `ledger-api-outage-reload.txt` and its screenshot. This verifies persisted history recovery during an API outage. An attempted repeat with both servers paused reached the browser's network error page before service-worker readiness/control was established; a final-build cold start with the frontend host unavailable remains unverified. The earlier successful installed-worker outage test and this final API-only test have different boundaries.

## Final validation

Frontend `npm run prod:check` passed on 17 September: 2,779 tests passed, 1 skipped; typechecking, 6,104 translation keys, production build, security checks, 32 boot dependency entries and 177 installed assets verified. Startup JavaScript remains 259.3 kB gzip. Source parsing and repository hygiene also passed.
