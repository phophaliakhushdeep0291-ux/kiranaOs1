# KiranaOS Hardware Bridge

The bridge is a small, dependency-free companion service for a billing counter. It binds only to `127.0.0.1`, requires a per-device bearer token, allows only explicitly configured frontend origins, limits request size and time, durably journals print progress, and never accepts remote bridge URLs from the KiranaOS frontend.

## Shop installation

The retail installation path is the signed `KiranaOS-Hardware-Bridge-<version>-x64.exe` produced by the Windows release workflow. The installer:

- installs the bundled runtime and bridge under Program Files;
- registers `KiranaOS Hardware Bridge` as an automatic, delayed-start Windows service with restart-on-failure;
- opens one native setup window—no terminal is shown;
- detects Windows printer queues, generates the private 256-bit device token internally, and displays a six-character pairing code;
- keeps the private config and print journal under `%ProgramData%\KiranaOS\HardwareBridge`, readable only by administrators and SYSTEM.

Choose the receipt printer, select **Save printer and create pairing code**, then type the six-character code in KiranaOS → Settings → Printer. Codes expire after ten minutes, stop after five wrong attempts, and are single-use. KiranaOS exchanges the code locally for the long token and never syncs that token to the cloud. The setup window includes a real **Test print** action and reports only an actionable result—never a stack trace or adapter code.

## Browser permission for the counter

Recent Chrome and Edge gate a request from a public HTTPS page to a loopback address behind local network access. When it is not granted the request is neither answered nor refused — it is issued and then held, so the bridge logs nothing, the browser reports no CORS error and files no console warning, and the frontend's four-second abort surfaces the misleading "Hardware bridge did not respond in time." Measured on Chrome 151.0.7922.77 with a default profile; Chromium 148 still allowed the same request, so the change is recent and the exact first affected version is not established here. `Access-Control-Allow-Private-Network` does **not** address it: a `no-cors` request, which involves no preflight at all, is held in exactly the same way, so the gate sits above CORS.

The permission that matters is **loopback**, not "local network". Chrome keeps them apart: granting the `loopback_network` content setting for the frontend origin makes the same request succeed in ~10ms, while granting `local_network` leaves it hanging exactly as before — and does so while `navigator.permissions.query({ name: "local-network-access" })` reports `"granted"`. That query is therefore useless as a readiness check for the bridge, and it is wrong in *both* directions: Chromium 148 reports `"denied"` for the same permission while loopback requests succeed in about 4ms. Only an actual request settles the question, which is why the counter's error message names both possible causes instead of accusing the browser from a permission state.

The installer therefore offers a task that writes the frontend origins into `LoopbackNetworkAllowedForUrls` under `HKLM\SOFTWARE\Policies\Google\Chrome` and the matching Edge key. Loopback is also the narrower grant, which suits a bridge that refuses any non-loopback address anyway. The Edge key mirrors Chrome's naming but has not been verified against an Edge binary. The list comes from the same `KIRANA_FRONTEND_ORIGINS` that becomes the bridge's own origin allowlist, so a counter can never be allowed in the browser but rejected by the bridge. If either key already holds an entry this installer did not write — a shop managed by group policy or MDM — Setup leaves it alone and tells the operator which policy to ask their administrator for. Uninstalling withdraws only an allowlist that still matches ours.

This grants nothing beyond the shop's own KiranaOS origin, and only on the machine where the bridge is installed. Browsers other than Chrome and Edge have their own policy stores and are not covered.

Creating another pairing code rotates the private device token, immediately invalidating every previously paired browser. Installer upgrades stop the existing service before replacing files, refresh the registered service definition, and restart it after the secured files are in place.

The setup window and Printer Settings show the installed version. The service checks the configured HTTPS update manifest every six hours; Printer Settings displays an update notice and download version when a newer release exists.

Supported adapters:

- raw ESC/POS over a network printer (`network`, normally TCP 9100);
- raw ESC/POS through a named Windows print queue (`windows`);
- cash-drawer pulses through either printer adapter;
- an optional scale adapter executable that returns `{"weight": 1.25, "unit": "kg"}`;
- an optional customer-display adapter executable that receives a validated two-line frame as JSON on standard input;
- printing a provider-issued UPI payment QR as an ESC/POS raster through either printer adapter.

The administrator-only setup application can select installed vendor scale and customer-display adapter executables without exposing commands or credentials to the browser. It fingerprints and copies each selected executable into the administrators/SYSTEM-only ProgramData bridge directory before the service can launch it, preventing a later swap from a user-writable source folder. A scale adapter writes one JSON reading to standard output. A customer-display adapter receives a frame such as `{"revision":20,"state":"sale","itemCount":2,"totalPaise":12345,"width":20,"lines":["2 ITEMS","TOTAL INR 123.45"]}` on standard input and exits only after the device accepted it. The bridge owns line formatting, permits printable ASCII only, keeps totals in integer paise, serializes display writes, and drops stale revisions so a slow earlier update cannot overwrite a newer cart total.

`POST /v1/print-qr` takes a QR module grid (`moduleCount` plus a base64, row-major, MSB-first bitset) and an integer `amountPaise`, never pixels, a URL, or printable text. The bridge builds every printable byte itself — the caption, the four-module quiet zone, the `GS v 0` raster and the cut — so a compromised tab cannot smuggle terminal control sequences onto the counter printer, exactly as the customer display works. A module scale below three dots is refused rather than printed, because a phone camera needs roughly 0.33mm per module and a slip nobody can scan is worse than no slip. The grid itself is recovered from the payment provider's own QR image server-side: a QR generated locally would collect into a VPA with no intent binding, so it would take money no bill could ever settle against. Payment QR slips are deliberately not journalled like receipts — they record no sale, so reprinting one is safe.

Scale, drawer and customer-display support remains **software-ready, not physically certified** until a named device model passes retained connect, disconnect, timeout, malformed-reading and recovery runs. The Settings page reports the bridge's real capabilities and includes explicit test actions; billing never stops when an informative customer display is unavailable.

Developer-only environment setup remains available for source debugging:

```powershell
$env:KIRANA_BRIDGE_TOKEN = "replace-with-at-least-32-random-characters"
$env:KIRANA_BRIDGE_ALLOWED_ORIGINS = "https://pos.example.com,http://localhost:5173"
$env:KIRANA_BRIDGE_PRINTER_TRANSPORT = "windows"
$env:KIRANA_BRIDGE_PRINTER_NAME = "TVS RP3160"
npm.cmd start
```

This source-debug path is not part of shop installation. A shopkeeper never needs PowerShell or a terminal.

## Sending accounting vouchers to TallyPrime

A shop that keeps its books in Tally can push sales, purchases, receipts and expenses straight into the copy of TallyPrime running on the same counter, from Settings → Integrations. The browser cannot do this itself: it will not open a connection from an HTTPS page to a loopback port, and Tally answers no CORS preflight, so the bridge forwards the envelope.

Set the address and restart the service:

```powershell
$env:KIRANA_BRIDGE_TALLY_URL = "http://127.0.0.1:9000"
```

or add `"tally": { "url": "http://127.0.0.1:9000" }` to `config.json`. Leaving it blank means the shop does not use Tally: `/v1/health` then reports `capabilities.tally: false` and the app hides the option rather than failing at the moment somebody presses send.

Three constraints are deliberate:

- **The address is configuration, never a request field.** A bridge that posted wherever the page asked would be an open proxy running inside the shop's network with the shop's trust.
- **It must be loopback.** Tally has no authentication on this gateway, so reaching one across the shop's LAN would let any device on that network write to the books.
- **An unusable address stops the service at startup**, where an installer or operator sees it, rather than at the counter on a Saturday evening.

In Tally itself, the gateway must be switched on (F1 → Settings → Connectivity → Gateway of Tally) and the right company open. Tally answers HTTP 200 even when it imports nothing, so the bridge reads the counters in its reply and reports a rejection as a failure — the app records vouchers as sent only when Tally actually took them.

Every voucher carries a `REMOTEID` derived from the shop and the document it came from, so an envelope that arrives twice is recognised as the same vouchers rather than a second set. The app additionally records what it has already pushed and asks only for the remainder.

Print job ids, a SHA-256 fingerprint of the exact receipt payload, and per-copy progress are persisted at `~/.kiranaos/hardware-bridge-print-jobs.json` by default; override with `KIRANA_BRIDGE_JOB_JOURNAL`. Concurrent retries share one in-flight job, restarts resume only unfinished copies, and reusing a job id with different content, printer controls, or copy count is rejected. Pre-fingerprint legacy journal rows fail closed and require operator inspection plus a new job id. As with every raw printer protocol, a machine crash in the tiny interval after the printer accepts bytes but before the journal fsync can still require an operator to inspect the last receipt.

## Physical printer certification — exactly two resale models

The resale scope is locked to exactly these two 80mm USB/Ethernet ESC/POS models. Every other model is unsupported and intentionally ignored.

| Retained evidence | TVS RP 3160 Gold | Epson TM-T82III |
|---|---|---|
| Normal receipt | **Awaiting physical run** | **Awaiting physical run** |
| Paper-out mid-print | **Awaiting physical run** | **Awaiting physical run** |
| Cable/network disconnect mid-print | **Awaiting physical run** | **Awaiting physical run** |
| Printer powered off | **Awaiting physical run** | **Awaiting physical run** |
| Retry after every failure | **Software guard passed; physical run pending** | **Software guard passed; physical run pending** |
| Duplicate-print guard | **Software journal passed; physical run pending** | **Software journal passed; physical run pending** |
| Cash-drawer kick | **Awaiting physical run** | **Awaiting physical run** |
| Clean Windows install → test print, no terminal | **Awaiting clean-machine run** | **Awaiting clean-machine run** |
| Certification decision | **NOT CERTIFIED** | **NOT CERTIFIED** |

Software artifacts are retained by `tests/failure-recovery.test.mjs`, `tests/job-journal.test.mjs`, `tests/pairing.test.mjs`, and `tests/installer-contract.test.mjs`. Physical artifacts must be stored under the release run's `hardware-bridge-certification/<model>/<scenario>/` directory with printer status screenshots, bridge version, driver version, receipt photographs, journal snapshot, timestamps, and tester sign-off. A spool acknowledgement or a unit test is not a physical print certification. Do not change either decision to CERTIFIED—and do not close BUG-005 for that model—until every physical row has retained evidence.

## Signed release build

Run `windows/build-installer.ps1` from a Windows release worker with .NET 8, Inno Setup, SignTool, the `KIRANA_CODE_SIGN_PFX` / `KIRANA_CODE_SIGN_PASSWORD` secrets, and an explicit comma-separated `KIRANA_FRONTEND_ORIGINS`. The build rejects non-HTTPS origins except loopback development origins, requires the installer/package/health versions to agree, and verifies the pinned WinSW v2.12.0 SHA-256 before signing it. The installer removes inherited access from the ProgramData credential/journal directory and grants access only to SYSTEM and local administrators. The build signs the service wrapper, setup application, uninstaller, and installer, then fails unless Authenticode verification passes. `.github/workflows/hardware-bridge-installer.yml` publishes the signed installer artifact; it deliberately cannot publish an unsigned retail build.
