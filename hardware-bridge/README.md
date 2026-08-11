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
