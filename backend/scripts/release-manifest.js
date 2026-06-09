import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
const commit = git.status === 0 ? git.stdout.trim() : process.env.GITHUB_SHA || "unknown";
const manifest = {
  name: pkg.name,
  version: process.env.RELEASE_VERSION || pkg.version,
  commit,
  generatedAt: new Date().toISOString(),
  requiredProofCommands: [
    "npm run migration:safety",
    "npm run release:gate",
    "npm run proof:ops",
    "npm run proof:postgres",
    "npm run proof:dr",
  ],
  requiredHumanChecks: [
    "backup before migration",
    "restore drill",
    "Razorpay test-mode checkout/webhook",
    "Redis worker heartbeat",
    "frontend-backend E2E",
    "rollback image recorded",
  ],
};
const outDir = path.join(root, "release-artifacts");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `release-manifest-${manifest.version}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ type: "release_manifest", status: "written", file: outFile, version: manifest.version }));
