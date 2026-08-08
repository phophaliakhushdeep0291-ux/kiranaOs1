export function compareVersions(left, right) {
  const a = String(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

export class UpdateChecker {
  constructor({ currentVersion, manifestUrl, fetchImpl = globalThis.fetch }) {
    this.currentVersion = currentVersion;
    this.manifestUrl = manifestUrl;
    this.fetchImpl = fetchImpl;
    this.state = { available: false, currentVersion };
  }

  snapshot() { return { ...this.state }; }

  async check() {
    if (!this.manifestUrl || typeof this.fetchImpl !== "function") return this.snapshot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await this.fetchImpl(this.manifestUrl, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return this.snapshot();
      const manifest = await response.json();
      const latestVersion = String(manifest?.version || "");
      if (!/^\d+\.\d+\.\d+$/.test(latestVersion)) return this.snapshot();
      this.state = {
        available: compareVersions(latestVersion, this.currentVersion) > 0,
        currentVersion: this.currentVersion,
        latestVersion,
        downloadUrl: typeof manifest.downloadUrl === "string" && /^https:\/\//.test(manifest.downloadUrl) ? manifest.downloadUrl : undefined,
      };
      return this.snapshot();
    } catch { return this.snapshot(); }
    finally { clearTimeout(timer); }
  }
}
