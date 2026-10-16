import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await fs.readFile(new URL('../runtime-config.json', import.meta.url), 'utf8'));
if (config.target !== 'mobile') throw new Error('Run npm run prepare:mobile before syncing Android/iOS.');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/@capacitor/cli/bin/capacitor', import.meta.url)), 'sync', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
