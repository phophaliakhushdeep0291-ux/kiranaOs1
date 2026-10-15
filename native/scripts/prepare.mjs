import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateApiBase } = require('../desktop/policy.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!['desktop', 'mobile'].includes(target)) throw new Error('Choose desktop or mobile');
const config = JSON.parse(await fs.readFile(path.join(root, 'app-config.json'), 'utf8'));
const apiBaseUrl = validateApiBase(process.env.KIRANA_NATIVE_API_URL || config.apiBaseUrl);
const frontend = path.join(root, '../frontend');
const result = spawnSync(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'runner'], {
  cwd: frontend, stdio: 'inherit', env: { ...process.env, VITE_NATIVE_APP: target, VITE_API_BASE_URL: target === 'desktop' ? '/api' : apiBaseUrl, KIRANA_OUT_DIR: path.join(root, 'web') },
});
if (result.status !== 0) process.exit(result.status || 1);
await fs.writeFile(path.join(root, 'runtime-config.json'), JSON.stringify({ apiBaseUrl, target }, null, 2));
console.log(`Bundled ${target} counter. API: ${apiBaseUrl}`);
