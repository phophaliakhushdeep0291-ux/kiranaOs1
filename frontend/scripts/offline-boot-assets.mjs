// Dynamic boot imports are invisible to a static dependency walk from index.
// Verify the emitted build, so source-list assertions cannot certify an install
// that has its route chunks but lacks its layout, translations or shared CSS.
const BOOT_ENTRIES = [
  "index.html",
  "src/components/layout/index.ts",
  "src/features/core/settings/translations/english-deferred.ts",
  "src/features/core/settings/translations/hindi-critical.ts",
  "src/features/core/settings/translations/hindi-deferred.ts",
];

export function assertOfflineBootAssets(manifest, coreAssets) {
  const cached = new Set(coreAssets);
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const record = manifest[key];
    if (!record?.file) throw new Error(`Offline boot entry missing from build manifest: ${key}`);
    for (const file of [record.file, ...(record.css ?? []), ...(record.assets ?? [])]) {
      if (!cached.has(`/${file}`)) throw new Error(`Offline boot dependency missing from install: ${file} (${key})`);
    }
    for (const dependency of record.imports ?? []) visit(dependency);
  };
  BOOT_ENTRIES.forEach(visit);
  return visited.size;
}
