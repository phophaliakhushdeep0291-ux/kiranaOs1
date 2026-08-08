import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Windows installer registers an automatic hidden service and launches setup", async () => {
  const installer = await readFile(new URL("../windows/installer.iss", import.meta.url), "utf8");
  const service = await readFile(new URL("../windows/KiranaOSHardwareBridge.xml", import.meta.url), "utf8");
  const setup = await readFile(new URL("../windows/setup-app/Program.cs", import.meta.url), "utf8");
  assert.match(installer, /PrivilegesRequired=admin/);
  assert.match(installer, /SignTool=release-sign/);
  assert.match(installer, /KiranaOS\.HardwareBridge\.Setup\.exe/);
  assert.match(installer, /icacls\.exe/);
  assert.match(installer, /\/inheritance:r/);
  assert.match(installer, /S-1-5-18/);
  assert.match(installer, /S-1-5-32-544/);
  assert.match(service, /<startmode>Automatic<\/startmode>/);
  assert.match(service, /127\.0\.0\.1|server\.mjs/);
  assert.match(setup, /PrinterSettings\.InstalledPrinters/);
  assert.match(setup, /Test print/);
  assert.doesNotMatch(setup, /Console\.(Write|Read)/);
});

test("release build refuses to create an unsigned retail installer", async () => {
  const build = await readFile(new URL("../windows/build-installer.ps1", import.meta.url), "utf8");
  assert.match(build, /Unsigned retail installers are intentionally not produced/);
  assert.match(build, /Get-FileHash -Algorithm SHA256/);
  assert.match(build, /WinSW v2\.12\.0 SHA-256 verification failed/);
  assert.match(build, /must match hardware-bridge package version/);
  assert.match(build, /must match the bridge health version/);
  assert.match(build, /signtool verify \/pa \/all/);
});
