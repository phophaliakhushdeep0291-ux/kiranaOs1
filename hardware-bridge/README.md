# KiranaOS Hardware Bridge

The bridge is a small, dependency-free companion service for a billing counter. It binds only to `127.0.0.1`, requires a per-device bearer token, allows only explicitly configured frontend origins, limits request size and time, durably journals print progress, and never accepts remote bridge URLs from the KiranaOS frontend.

Supported adapters:

- raw ESC/POS over a network printer (`network`, normally TCP 9100);
- raw ESC/POS through a named Windows print queue (`windows`);
- cash-drawer pulses through either printer adapter;
- an optional scale adapter executable that returns `{"weight": 1.25, "unit": "kg"}`.

Example PowerShell setup:

```powershell
$env:KIRANA_BRIDGE_TOKEN = "replace-with-at-least-32-random-characters"
$env:KIRANA_BRIDGE_ALLOWED_ORIGINS = "https://pos.example.com,http://localhost:5173"
$env:KIRANA_BRIDGE_PRINTER_TRANSPORT = "windows"
$env:KIRANA_BRIDGE_PRINTER_NAME = "TVS RP3160"
npm.cmd start
```

For a LAN printer, set `KIRANA_BRIDGE_PRINTER_TRANSPORT=network`, `KIRANA_BRIDGE_PRINTER_HOST`, and optionally `KIRANA_BRIDGE_PRINTER_PORT` (default 9100). Pair the same token in KiranaOS Printer Settings and verify Health, Test print, Drawer, and Scale before production use.

Print job ids and per-copy progress are persisted at `~/.kiranaos/hardware-bridge-print-jobs.json` by default; override with `KIRANA_BRIDGE_JOB_JOURNAL`. Concurrent retries share one in-flight job, restarts resume only unfinished copies, and reusing a job id with a different copy count is rejected. As with every raw printer protocol, a machine crash in the tiny interval after the printer accepts bytes but before the journal fsync can still require an operator to inspect the last receipt.

Device certification is still operational work: each printer/scale model, paper width, code page, cutter, drawer wiring, driver, and failure/retry scenario must be tested on the actual counter hardware before it is marked approved for a rollout.
