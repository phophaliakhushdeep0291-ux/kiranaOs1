import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (separatorIndex <= 0 || separatorIndex === args.length - 1) {
  console.error("Usage: node scripts/run-with-env.js KEY=value [KEY=value ...] -- command [args...]");
  process.exit(1);
}

const env = { ...process.env };
for (const assignment of args.slice(0, separatorIndex)) {
  const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    console.error(`Invalid environment assignment: ${assignment}`);
    process.exit(1);
  }
  env[match[1]] = match[2];
}

const [command, ...commandArgs] = args.slice(separatorIndex + 1);
const result = spawnSync(command, commandArgs, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.stack || result.error.message || result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
