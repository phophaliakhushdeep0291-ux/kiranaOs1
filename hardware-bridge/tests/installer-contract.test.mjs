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
  assert.match(installer, /PrepareToInstall/);
  assert.match(installer, /Parameters: "refresh"[^\r\n]+ShouldRefreshService/);
  assert.match(installer, /Parameters: "start"[^\r\n]+ShouldRefreshService/);
  assert.match(service, /<startmode>Automatic<\/startmode>/);
  assert.match(service, /127\.0\.0\.1|server\.mjs/);
  assert.match(setup, /PrinterSettings\.InstalledPrinters/);
  assert.match(setup, /Test print/);
  assert.match(setup, /config\.Token = RandomToken\(\)/);
  assert.match(setup, /InstallProtectedAdapter/);
  assert.match(setup, /SHA256\.HashData\(payload\)/);
  assert.match(setup, /Path\.Combine\(ConfigDirectory, "adapters"\)/);
  assert.doesNotMatch(setup, /Console\.(Write|Read)/);
});

test("installer grants the frontend browser permission to reach the counter", async () => {
  const installer = await readFile(new URL("../windows/installer.iss", import.meta.url), "utf8");
  const build = await readFile(new URL("../windows/build-installer.ps1", import.meta.url), "utf8");
  // Recent Chrome and Edge gate a public page's request to 127.0.0.1 behind
  // local network access. Without this policy the bridge answers nothing and
  // the counter sees only a timeout.
  assert.match(installer, /SOFTWARE\\Policies\\Google\\Chrome\\LocalNetworkAccessAllowedForUrls/);
  assert.match(installer, /SOFTWARE\\Policies\\Microsoft\\Edge\\LocalNetworkAccessAllowedForUrls/);
  assert.match(installer, /Name: "browserpolicy"/);
  assert.match(installer, /WizardIsTaskSelected\('browserpolicy'\)/);
  // A machine-wide browser policy must never silently overwrite one the shop's
  // administrator set, and must be withdrawn when the bridge is removed.
  assert.match(installer, /PolicyKeyHasForeignValues/);
  assert.match(installer, /CurUninstallStepChanged/);
  assert.match(build, /\/DFrontendOrigins=/);
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
