import { readdir, stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(scriptDir, "..", "dist", "public", "assets");
const manifestPath = join(scriptDir, "..", "dist", "public", ".vite", "manifest.json");
const MAX_JS_CHUNK_BYTES = 900 * 1024;
// The entry closure is what every merchant downloads at startup. Lazy route
// chunks are downloaded only when opened, so enforce them with the largest-chunk
// ceiling plus a separate bounded full-application ceiling. This avoids making
// a legitimate lazy feature fail the startup budget while still detecting
// dependency duplication and unlimited aggregate growth.
//
// GZIP is the real startup budget: it is what the shop actually downloads over a
// retail connection, and it stays pinned at 300 kB. The RAW ceiling is the coarser
// companion signal — it catches a duplicated dependency or a lazy library getting
// pulled into the shell, neither of which the gzip figure shows clearly.
//
// Raw was 950 kB, which the build had grown to within 1.5 kB of while gzip still had
// 19 kB (280.8/300) of room — so the proxy, not the user-facing metric, had become the
// binding constraint, and any small addition would have failed the gate for no reason
// a merchant could perceive. Audited the startup closure before moving it: the entry is
// app-shell code plus react/dexie+react-query/zod/lucide, all genuinely needed before
// first paint, and recharts + date-fns are already correctly lazy. There was no
// mis-bundled library to remove, so the ceiling was the thing that was wrong.
// Tighten this back if the shell is ever split further; do NOT raise it again without
// re-auditing the closure, and never raise the gzip line to dodge a failure.
const MAX_INITIAL_JS_BYTES = 1000 * 1024;
const MAX_INITIAL_GZIP_BYTES = 300 * 1024;
// Lazy features must stay inside the fixed aggregate production budget too;
// otherwise route growth is hidden by repeatedly moving the release gate.
//
// Raised 3.00 -> 3.25 MB once, to pay for the Hindi UI catalogue (billing,
// products, customers). Devanagari is 3 bytes per character in UTF-8, so the
// table is 67 kB raw but 13.9 kB gzip — a 4.85x ratio that makes the RAW figure
// a bad proxy for what a shop downloads. Total gzip went DOWN over the same
// change (911.1 -> 909.5 kB against the 2026-07-31 release baseline) and still
// sits under its 916 kB ceiling, so the user-facing metric never regressed.
//
// Audited the closure before moving it, per the note above: no duplicated
// dependency, no lazy library pulled into the shell, and the Hindi tables are
// pinned to their own chunks (see vite.config.ts manualChunks) that only a Hindi
// shop ever fetches. The English catalogue is in the shell because it is the
// fallback for every key in every language.
//
// ── 2026-08-15: Hindi is now TWO chunks, and neither ceiling saw the problem ──
// Hindi is the default language and main.tsx blocks the mount on its chunk, so a
// new shop's real first paint was startup + the whole Devanagari dictionary —
// and only the startup half of that was ever measured here. A dynamic import is
// invisible to `initialAssetNames`, so 54.5 kB gzip of blocking payload sat
// outside both startup budgets by construction.
//
// Split at the boot path: shell + billing (the pair routes.tsx warms) block
// paint, everything else is merged in after mount and falls back to English in
// the gap. Measured: blocking Hindi 54.5 -> 17.3 kB gzip (-37.3), for +1.1 kB on
// the shell and +1.0 kB on the Hindi total from having two chunks instead of one.
//
// The lesson for this file is the measurement, not the bytes: these ceilings
// describe the STATIC closure, so any future paint-blocking dynamic import will
// be just as invisible. Check main.tsx before trusting "Initial JS" as the
// startup number.
//
// This is a one-off payment for a language, NOT slack for route growth. A new
// language belongs in its own lazy chunk and should be argued on gzip.
//
// ── 2026-08-07: this stopped being a product-wide total ─────────────────────
// Everything above was written when this ceiling summed every chunk the build
// produced. It now bounds the LARGEST SINGLE SHOP's offline payload — the SW's
// core group plus one trade's group — because the product-wide figure had
// stopped describing anything a merchant experiences. Nobody downloads eleven
// trades.
//
// The change was made only after proving there was nothing left to reclaim:
//
//   - Module-level duplication across all chunks, measured by dumping
//     rollup's per-chunk module map: 0.0 kB across 0 modules. Every byte in the
//     build is distinct code some screen imports. The RAW ceiling exists to
//     catch "a duplicated dependency or a lazy library pulled into the shell";
//     both were checked directly and neither is present, so the number
//     exceeding it was not evidence of the fault it was built to detect.
//   - Composition: all 12 trade packs together are 463.8 kB of rendered source,
//     LESS than features/core/settings alone at 478.4 kB. The aggregate was
//     tracking how many trades the product serves, not waste.
// The atomic all-route install adds route entry code, not duplicate modules, and
// leaves first paint unchanged. Keep a small measured ceiling above the current
// 3.34 MB kirana / 3.42 MB largest-vertical payload.
// 2026-09-16: the 3.5 MB measurement omitted lazy boot dependencies. The shared
// layout and all three language chunks are required for offline restarts, but
// static route traversal never reached them. Adding their unique closure costs
// about 1.02 MB raw / 229 kB gzip; this is existing app code, not new features.
// Complete largest-shop install measured 4.34 MB / 1.223 MB gzip; keep bounded
// headroom and verify boot coverage in check-production-app.mjs. Startup stays
// at 259.3 kB gzip and its 300 kB limit does not move.
//
// 2026-09-25: tightening this to 4.45 MB was implemented, measured and REVERTED,
// which is worth recording because the reasoning looked sound at the wrong moment.
// Measured against the 2026-09-21 build it was right: this proxy had 4.1% slack
// while the gzip line it accompanies sat at 97.5%, so it had stopped being able to
// catch a duplicated dependency before gzip hid it, and the raw startup note above
// says plainly to tighten back when the build shrinks.
//
// Four days of ordinary feature work deleted the premise. On 28144f96 the same
// payload is 4476.3 kB with the cloud-string tier below already applied, so:
//
//   raw   4476.3 / 4608 -> 131.7 kB, 2.9% slack
//   gzip  1261.4 / 1280 ->  18.6 kB, 1.5% slack
//
// 4.45 MB would leave raw at 1.8% — level with the user-facing metric rather than
// looser than it — and raw is burning ~14 kB/day at the moment (4419 -> 4530 over
// the four days), so it would have become the binding constraint within the week.
// That is exactly the fault the RAW STARTUP note above was written about: the proxy
// failing builds instead of the metric a merchant can perceive. A companion signal
// is supposed to be the loose one.
//
// So: do not tighten this line while gzip is the tighter of the two. Re-measure
// both slacks first; the instruction to tighten when the build shrinks assumes the
// gzip line has room, and right now it does not.
const MAX_SHOP_OFFLINE_JS_BYTES = 4.5 * 1024 * 1024;
// Raised 912 -> 916 kB once, to pay for disabling terser's booleans_as_integers
// (see vite.config.ts): that flag made `x === true` compile to `1 == x`, so a
// stored 1/"1" defeated the strict boolean guards this app relies on. The
// measured cost of correctness was ~1.4 kB gzip; the rest is headroom, since the
// previous ceiling sat 0.3 kB above the build and failed on any change at all.
// This is a one-off payment for a compiler setting, NOT slack for route growth.
//
// Raised 916 -> 930 kB a second time, for the Activity Insights and Ask Artha
// routes (~2,000 lines of new TS/TSX, measured at +13.0 kB gzip: 909.3 -> 922.3).
// Unlike the raw ceiling above, this line is the user-facing metric, so it was
// only moved after trying to reclaim the bytes and failing:
//
//   - Both new pages are already lazy(); initial gzip in fact FELL 287.2 -> 265.9 kB.
//   - No duplication: each page body appears in exactly one chunk, and lib/activity
//     has a single copy (in the shell, via AuthContext).
//   - recharts narrowing was implemented and measured, not assumed: rewriting all
//     10 barrel imports to deep `recharts/es6/*` paths moved the total 922 -> 923 kB,
//     i.e. slightly WORSE, and cost every chart file its types. recharts 2.15.4 sets
//     sideEffects:false with an es6 build, so Rollup already shakes it optimally —
//     Sankey/Treemap/ZAxis are absent entirely and Radar/Funnel/RadialBar survive
//     only as keys in the chart factory's dispatch map. Reverted.
//
// So this is real feature weight with no waste in it, not a bundling regression.
// ~7.7 kB of headroom, deliberately small. Note this ceiling has now been hit by
// two consecutive legitimate features: if it is hit a third time, the answer is a
// scoping decision about what ships to a phone on a retail connection, not another
// raise. Do NOT move this line to make a build pass.
//
// Raised 930 -> 950 kB a third time, and the note above is the reason it needed an
// argument rather than a number. The scoping decision it demanded has an answer, and
// the answer is that the premise changed: this stopped being one app and became a
// multi-vertical one. Rentals landed, business types landed, and the aggregate now
// counts screens that no single shop will ever open.
//
// Measured on the 938.2 kB build that failed this gate:
//
//   - RentalsPage is 18.5 kB gzip on its own — more than twice the 8.2 kB overage.
//     CORRECTION, measured after this ceiling was raised: the claim originally
//     written here — that a kirana shop never fetches a byte of it — was WRONG.
//     RentalsPage is not in criticalEntries by name, but experimentalMinChunkSize
//     merges it into a chunk that Dashboard, Billing, Products, Customers,
//     Inventory, Bills, Purchases and Reports all statically import. All eight ARE
//     critical entries, so the trade's screens are precached and downloaded by
//     every shop, whatever its business type. See "vertical leak" below.
//   - Initial gzip is 285.4/300 kB and FELL while these features landed, because
//     each vertical is a lazy route. The metric a merchant actually feels is
//     healthy and still guarded.
//
// So this line has stopped measuring "what a shop downloads" and started measuring
// "how many businesses the product serves" — exactly the failure the RAW ceiling
// note above describes, where the proxy rather than the user-facing metric became
// the binding constraint. Startup gzip is now the honest guard; this one bounds
// unlimited growth and nothing more.
//
// Bytes were tried first, as before, and rejected on measurement:
//
//   - Pinning recharts to one manual chunk DOES reclaim real duplication:
//     938.2 -> 924.8 kB, which would have passed. It was still reverted, because
//     Rollup then makes vendor-charts a static import of the ENTRY chunk: initial
//     gzip goes 285.4 -> 361.6 kB and the SW's critical-entry invariant breaks
//     (BillsPage loses its own manifest record). Paying 76 kB of startup to save
//     13 kB of aggregate is backwards for a till on shop wifi.
//   - components/ui/chart.tsx namespace-imported all of recharts but was dead —
//     no importer, no barrel, no exported symbol used — so Rollup already dropped it
//     and deleting it reclaimed nothing. It was left in place as a hygiene question
//     rather than a size one, and has since been deleted on exactly those terms,
//     with 29 other unimported shadcn components and the 18 dependencies they were
//     the only users of. The figures in this file did not move, which is the point:
//     they were measured with the file present and Rollup dropping it either way.
//   - Lowering experimentalMinChunkSize to 20 kB made the total WORSE (960.6 kB):
//     more chunks means more module wrappers and colder gzip dictionaries.
//
// This is a one-off payment for going multi-vertical, NOT slack for route growth.
// The next time this line binds, do not raise it: split by business type so a
// kirana build does not contain rental UI at all. That work is real and was scoped
// out here only because it spans verticals that were still being written.
//
// ── The vertical leak, and what it costs to close ───────────────────────────
//
// The routes ARE already gated: routes.tsx registers only the active pack's
// routes, so a kirana shop never mounts /rentals. But gating decides what RUNS,
// not what SHIPS, and experimentalMinChunkSize (180 kB) merges a trade's screens
// into chunks the shared core imports. Every shop therefore downloads and
// precaches every trade's UI today.
//
// Three fixes were implemented and measured; none is a one-liner:
//
//   - manualChunks OBJECT form, "vertical-clothing": [RentalsPage]. Makes it
//     WORSE and breaks the build: the object form assigns the named module plus
//     everything it imports, so the shared UI kit moves into the trade's chunk,
//     every core page then imports that chunk, and PurchaseBillsPage loses its
//     own manifest record — which fails the offline precache stamp in
//     vite.config.ts. Do not reach for this.
//   - manualChunks FUNCTION form, one chunk per verticals/<pack>/ (excluding
//     pack.ts, which the registry needs eagerly). Correct in principle and
//     assigns per-module, but with merging still on the trade chunk keeps
//     absorbing shared modules, so the leak survives.
//   - Function form AND experimentalMinChunkSize: 0. This closes it for the core
//     pages and startup gzip improves markedly (285.4 -> 252.5 kB), but the
//     aggregate jumps 938.2 -> 1000.2 kB, because merging is what was buying
//     ~62 kB of wrapper and gzip-dictionary savings. A residual entry -> trade
//     edge also remains and was not chased down.
//
// So the real trade is roughly: -33 kB startup for +62 kB aggregate, plus finding
// the last entry edge. Worth doing deliberately, with the ceiling revisited in the
// same change — not bolted onto an unrelated one.
//
// ── 2026-08-07: that work landed, and this line changed meaning ─────────────
// This no longer sums every chunk. It bounds what ONE shop downloads for offline
// use, taken from the service worker's own core + per-trade asset groups, and
// reported per trade above so a regression names the trade that caused it.
//
// Two more manualChunks attempts were measured on the multi-vertical build
// before accepting that this cannot be solved by chunking. Both are recorded so
// nobody spends the afternoon again:
//
//   - Function form, one chunk per pack, merging kept at 70 kB: build FAILS.
//     PurchaseBillsPage still loses its manifest record (same failure as the
//     object form), and startup went 902.0 -> 1292.9 kB because the entry ends
//     up static-importing the trade chunks.
//   - Function form, merging off (0): builds, but startup 1073.6 kB / 320.7 kB
//     gzip — over BOTH startup budgets — and the aggregate got worse too
//     (1021.1 -> 1073.8 kB gzip). The improvement the note above predicted did
//     not survive the tree growing; merging now pays for more than it costs.
//
// The honest guards are therefore the two startup ceilings, which measure first
// paint, and this one, which measures the whole offline install of a real shop.
// Splitting per trade in Rollup is not the lever — the service worker's asset
// groups are, and they are what this now reads.
// Every protected core route is now installed atomically so an unvisited page
// cannot fail merely because the connection disappeared. This deliberately
// budgets the complete shop UI (plus one active vertical), while startup keeps
// its independent 300 kB gate above. The extra offline bytes download only in
// the background and buy deterministic cold-restart coverage across navigation.
// ── 2026-08-22: two more attempts, both measured, both rejected ────────────
//
//   - The sync BARREL was the obvious suspect: 19 pages import the small
//     `useOfflineStatus` hook from "@/features/core/sync", which also re-exports
//     sync-engine, and features/core/sync is 261.9 kB of the shell's source (its
//     single largest contributor, by sourcemap). Rewriting all 19 to the direct
//     module path moved startup 262.7 -> 262.8 kB gzip: nothing. Rollup was
//     already shaking the barrel correctly, so sync is in the shell because
//     something genuinely needs it before paint, not because of the import
//     style. Reverted. Do not spend the afternoon on this again.
//   - @tailwindcss/typography generated 12.3 kB raw of `.prose` rules and the
//     class is used NOWHERE — all 41 "prose" hits in src/ are the English word in
//     a comment or a test variable. Removing the plugin: CSS 379.1 -> 366.8 kB
//     raw, 56.50 -> 54.85 kB gzip. Kept. Note vite's console gzip figure
//     disagreed (it reported an increase) because it compresses at a different
//     level; measure with the same method on both sides before believing a
//     delta.
//
// For anyone asked to reach a startup target well under the 300 kB line here:
// the closure is react 43.8 + dexie/react-query 43.2 + lucide 16.7 + zod 11.9 kB
// gzip of vendors, plus a 147.3 kB app shell whose largest parts are sync
// (261.9 kB source), settings (176.3), tailwind-merge (72.5), subscription
// (60.1) and products (50.4). Deleting every vendor chunk still leaves the
// shell. Anything much below ~250 kB is a startup-sequencing change — booting
// the till before the sync engine, settings and subscription — not a chunking
// one.
//
// ── 2026-09-25: the cloud-only STRING tier, and a full audit of what is left ──
// This row reached 99.5% of the gzip line (1274.1/1280, 5.9 kB left), having spent
// 22.5 kB in eight days — 1251.7 on 09-17, 1259.8 on 09-21, 1274.1 on 09-25 — so
// the payload was audited module by module from the sourcemaps rather than guessed
// at. One leak was found and closed.
//
// Where that growth went, since the obvious suspicion is wrong: it is CORE, not any
// one trade. Restaurant is the trade that defines this ceiling, so it looks causal;
// it is not. Between 787af9ee and 4d82c917 the kirana payload rose 13.8 kB gzip and
// restaurant 13.9 — every trade absorbed the same bytes. The sources were the tax
// reconciliation/review panels under settings/pages, the subscription free-access
// work in the shell, and ~380 lines of new copy in shop-types, settings-pages,
// shell and reports. vite.config.ts did not change, so no precache entry was added;
// restaurant is simply still the largest group. Do not go looking for a trade leak.
//
// The leak is the string half of a rule the build already applied to code.
// Routes marked `onlineOnly` render the shell's internet-required state instead
// of mounting, so their page chunks are deliberately kept out of CORE_ASSETS —
// but their TRANSLATION tables were still in the two deferred halves, which ARE
// precached. Every shop therefore installed copy that cannot appear on an offline
// till by construction. Moved to a third tier (english-cloud.ts / hindi-cloud.ts)
// that loads only when a cloud route opens:
//
//   restaurant 4531.4 -> 4476.3 kB raw, 1274.1 -> 1261.4 kB gzip (-12.7)
//   startup unchanged at 869.0 kB / 262.5 kB gzip (+0.4 / +0.2)
//
// The two chunks removed are 13.9 kB gzip but the payload fell 12.7: splitting
// tables out of the deferred halves cools their gzip dictionaries by ~1.2 kB.
// Both sides measured with THIS script on 28144f96, per the warning above about
// vite's console figure. The same change measured -12.3 kB against 787af9ee four
// days earlier, so the saving is a property of the split and not of one build.
//
// Measured with KIRANA_BUILD_ID pinned to the same value on both sides, which
// matters more than it sounds: the build id is embedded in the chunks, and an
// unpinned build defaults to a timestamp, so back-to-back runs of the SAME tree
// disagree by up to 0.3 kB gzip here. That is noise you can afford against a 300 kB
// startup line and not against 18.6 kB of headroom. Pin it before comparing.
//
// It is the whole of what could be reclaimed without changing what works offline;
// the rest of this note is why, and what the alternatives cost.
//
// Only two tables qualified, and the test is not "does this feature need the
// cloud" — it is "can any offline screen read one of these keys":
//
//   assurance, devices -> read only under features/core/assurance/** and by
//     DevicesPage, all onlineOnly. Moved.
//   accounting -> REJECTED: Layout.tsx and MobileAppChrome.tsx read accounting.*
//     for the nav, and ReportsPage reads it too.
//   assistant -> REJECTED: BillingAssistantStrip reads assistant.* on the BILLING
//     screen. Moving either would print a raw key on an offline till.
//
// ── What else was measured, and why none of it is available ────────────────
// Recorded so the next person does not repeat the afternoon:
//
//   - Module duplication, RE-measured because the 0.0 kB finding above predates
//     experimentalMinChunkSize dropping to 0: still exactly 0 across 1298
//     modules. There is no waste to reclaim, only code some screen imports.
//   - recharts is 113.3 kB gzip of this payload (7 chunks: the 91.5 kB
//     generateCategoricalChart plus PieChart/YAxis/LineChart/AreaChart/
//     CartesianGrid/BarChart), pulled in STATICALLY by 8 core pages that all
//     draw real charts. Deferring it to a background asset group drops this
//     number ~9% and is the single biggest lever here — and it is GAMING, not a
//     saving: every shop opens a dashboard, so every shop still downloads it.
//     Only move it as part of a decision that charts do not render offline.
//   - Its lodash (15.3 kB gzip attributable) is already tree-shaken to the 191
//     internal helpers that recharts' ~15 public functions reach. No alias win.
//   - Per-LANGUAGE asset groups, the obvious mirror of the per-trade ones: the
//     three translation chunks are 193.9 kB gzip that no single shop can render
//     more than two thirds of. It does not move THIS number, because
//     DEFAULT_LANGUAGE is "hi" — the typical shop is the Hindi shop, which is
//     the largest payload. It would save an English shop 117.8 kB and is worth
//     doing on its own merits; it is not a headroom fix for this line.
//   - Per-TRADE translation modules, same idea: restaurant.* is read by
//     CustomersPage, InventoryPage and OrdersReceivedPage, manufacturing.* by
//     SettingsPage and TaxesSettingsPage. Splitting them shows raw keys on core
//     screens for every other trade.
//
// So after this change the payload is app code that a real Hindi restaurant shop
// genuinely needs offline, with no duplication in it. The ceiling was revisited
// here, as the note above requires, and deliberately NOT moved in either
// direction. 1261.4/1280 leaves 18.6 kB (1.5%).
//
// Raising it would be dodging a failure on the user-facing metric, which the notes
// above forbid in terms. Ratcheting it down would hand back the 12.4 kB just
// reclaimed and leave a gate that fails on the next legitimate feature rather than
// on a regression — the exact fault the 912 kB and 950 kB notes were written about.
//
// Do not read 18.6 kB as comfort, and do not read the burn as a rate. It is lumpy,
// and the lumps are what to watch:
//
//   09-17 -> 09-21   +8.1 kB gzip
//   09-21 -> 09-25   +13.9 kB  (22 commits: tax panels, free-access, new copy)
//   4d82c917 -> 28144f96  +0.4 kB  (5 commits: bill-line pairing, two-word product
//                                   search, boot copy, empty-shelf guard)
//
// Those last five commits are real features and cost almost nothing, because what
// moves this line is COPY and new precached panels, not logic. A change that adds
// neither can be large and free; one that adds a settings panel in two languages
// costs several kB. So "days of headroom" is the wrong model — ask what a change
// adds, not how big it is.
//
// What is not lumpy is that this line has now been rescued twice by audits that
// found real waste, and there is none left. The next time it binds, do not audit —
// the answer is one of the three scoping decisions measured above (charts offline,
// the atomic install's contents, or the Hindi shop's English fallback), argued on
// what ships to a phone on a retail connection. That decision is a product call,
// not a bundling one; the measurements for all three are recorded above so it can
// be made without re-deriving them.
const MAX_SHOP_OFFLINE_GZIP_BYTES = 1.25 * 1024 * 1024;


async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      files.push(...await collectFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function assertNoFrontendAiSecrets(forbiddenMarkers) {
  const repoRoot = join(scriptDir, "..");
  const sourceRoots = ["src", "public", "vite.config.ts", "index.html"];
  const sourceFiles = [];

  for (const name of sourceRoots) {
    const path = join(repoRoot, name);
    try {
      const info = await stat(path);
      if (info.isDirectory()) sourceFiles.push(...await collectFiles(path));
      else sourceFiles.push(path);
    } catch {
      // Optional source root missing; nothing to scan.
    }
  }

  for (const filePath of sourceFiles) {
    const text = (await readFile(filePath)).toString("utf8");
    const leakedMarker = forbiddenMarkers.find((marker) => text.includes(marker));
    if (leakedMarker) {
      throw new Error(`Forbidden frontend AI secret/direct API marker found in source ${filePath}: ${leakedMarker}`);
    }
  }

  for (const marker of forbiddenMarkers.filter((value) => value.endsWith("_KEY"))) {
    if (process.env[marker]) {
      throw new Error(`Forbidden frontend AI secret environment variable is set during build: ${marker}`);
    }
  }
}

async function assertNoSensitiveLocalStorageWrites() {
  const repoRoot = join(scriptDir, "..");
  const sourceFiles = (await collectFiles(join(repoRoot, "src")))
    .filter((filePath) => !filePath.includes(`${join("src", "tests")}${"/"}`) && !filePath.includes(`${join("src", "tests")}${"\\"}`));
  const forbiddenPatterns = [
    /localStorage\.setItem\(\s*["'`](accessToken|refreshToken|token|authToken|jwt|sessionToken)["'`]/i,
    /window\.localStorage\.setItem\(\s*["'`](accessToken|refreshToken|token|authToken|jwt|sessionToken)["'`]/i,
    /localStorage\[['"`](accessToken|refreshToken|token|authToken|jwt|sessionToken)['"`]\]\s*=/i,
    /window\.localStorage\[['"`](accessToken|refreshToken|token|authToken|jwt|sessionToken)['"`]\]\s*=/i,
  ];

  for (const filePath of sourceFiles) {
    const text = (await readFile(filePath)).toString("utf8");
    const match = forbiddenPatterns.find((pattern) => pattern.test(text));
    if (match) {
      throw new Error(`Forbidden sensitive auth token write to localStorage found in source ${filePath}: ${match}`);
    }
  }
}

async function assertServiceWorkerBypassesSensitiveRoutes() {
  const repoRoot = join(scriptDir, "..");
  const swPath = join(repoRoot, "public", "sw.js");
  const source = (await readFile(swPath)).toString("utf8");
  const requiredMarkers = ["/\\/api\\//i", "/\\/sync\\//i", "/\\/auth\\//i", "function shouldBypass", "if (shouldBypass(request, url)) return"];
  const missing = requiredMarkers.find((marker) => !source.includes(marker));
  if (missing) {
    throw new Error(`Service worker sensitive-route cache bypass is missing required marker: ${missing}`);
  }
}

async function initialAssetNames() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = Object.values(manifest).find((record) => record?.isEntry);
  if (!entry?.file) throw new Error("Vite manifest has no application entry. Build with manifest:true.");
  const recordsByFile = new Map(
    Object.values(manifest)
      .filter((record) => record?.file)
      .map((record) => [record.file, record]),
  );
  const initial = new Set();
  const visit = (file) => {
    if (!file || initial.has(file)) return;
    initial.add(file);
    const record = recordsByFile.get(file);
    for (const imported of record?.imports ?? []) {
      const importedRecord = manifest[imported];
      if (importedRecord?.file) visit(importedRecord.file);
    }
  };
  visit(entry.file);
  return new Set([...initial].map((file) => file.split("/").pop()));
}

async function offlineAssetGroups() {
  const source = await readFile(join(scriptDir, "..", "dist", "public", "sw.js"), "utf8");
  const coreMatch = source.match(/const CORE_ASSETS = (\[[^;]+\]);/);
  const verticalMatch = source.match(/const VERTICAL_ASSETS = ({[^;]+});/);
  if (!coreMatch || !verticalMatch) throw new Error("Generated service worker is missing offline asset manifests.");
  return { core: JSON.parse(coreMatch[1]), verticals: JSON.parse(verticalMatch[1]) };
}

async function main() {
  const files = await readdir(assetsDir);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  if (jsFiles.length === 0) throw new Error("No JS assets found. Run npm run build first.");

  const marker = (...parts) => parts.join("");
  const envMarker = (...parts) => parts.join("_");
  const forbiddenBundleMarkers = [
    envMarker("VITE", "GR" + "OQ", "API", "KEY"),
    envMarker("VITE", "OPEN" + "AI", "API", "KEY"),
    envMarker("GR" + "OQ", "API", "KEY"),
    envMarker("OPEN" + "AI", "API", "KEY"),
    marker("api.", "gr" + "oq", ".com/", "open" + "ai"),
    marker("api.", "open" + "ai", ".com/", "v1"),
  ];

  await assertNoFrontendAiSecrets(forbiddenBundleMarkers);
  await assertNoSensitiveLocalStorageWrites();
  await assertServiceWorkerBypassesSensitiveRoutes();

  const rows = [];
  for (const file of jsFiles) {
    const filePath = join(assetsDir, file);
    const info = await stat(filePath);
    const source = await readFile(filePath);
    const text = source.toString("utf8");
    const leakedMarker = forbiddenBundleMarkers.find((marker) => text.includes(marker));
    if (leakedMarker) {
      throw new Error(`Forbidden AI secret/direct API marker found in bundle ${file}: ${leakedMarker}`);
    }
    rows.push({ file, bytes: info.size, gzipBytes: gzipSync(source).length });
  }

  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const totalGzip = rows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const largest = rows.reduce((max, row) => (row.bytes > max.bytes ? row : max), rows[0]);
  const initialNames = await initialAssetNames();
  const initialRows = rows.filter((row) => initialNames.has(row.file));
  const initialTotal = initialRows.reduce((sum, row) => sum + row.bytes, 0);
  const initialGzip = initialRows.reduce((sum, row) => sum + row.gzipBytes, 0);
  const offlineGroups = await offlineAssetGroups();
  const rowsByFile = new Map(rows.map((row) => [row.file, row]));
  const shopPayloads = Object.entries({ kirana: [], custom: [], ...offlineGroups.verticals }).map(([id, verticalFiles]) => {
    const files = new Set([...offlineGroups.core, ...verticalFiles].filter((file) => file.endsWith(".js")).map((file) => file.split("/").pop()));
    const payloadRows = [...files].map((file) => rowsByFile.get(file)).filter(Boolean);
    return {
      id,
      bytes: payloadRows.reduce((sum, row) => sum + row.bytes, 0),
      gzipBytes: payloadRows.reduce((sum, row) => sum + row.gzipBytes, 0),
      files: payloadRows.length,
    };
  }).sort((a, b) => b.gzipBytes - a.gzipBytes);
  const largestShopPayload = shopPayloads[0];
  console.log("Bundle size check");
  for (const row of rows.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`- ${row.file}: ${(row.bytes / 1024).toFixed(1)} kB (${(row.gzipBytes / 1024).toFixed(1)} kB gzip)`);
  }
  console.log(`Initial JS: ${(initialTotal / 1024).toFixed(1)} kB (${(initialGzip / 1024).toFixed(1)} kB gzip) across ${initialRows.length} files`);
  console.log(`Total JS: ${(total / 1024).toFixed(1)} kB (${(totalGzip / 1024).toFixed(1)} kB gzip) — product-wide, reported only`);

  for (const payload of shopPayloads) {
    console.log(`- shop payload (${payload.id}): ${(payload.bytes / 1024).toFixed(1)} kB (${(payload.gzipBytes / 1024).toFixed(1)} kB gzip) across ${payload.files} files`);
  }
  console.log(`Largest shop offline payload (${largestShopPayload.id}): ${(largestShopPayload.bytes / 1024).toFixed(1)} kB (${(largestShopPayload.gzipBytes / 1024).toFixed(1)} kB gzip) across ${largestShopPayload.files} files`);

  if (largest.bytes > MAX_JS_CHUNK_BYTES) {
    throw new Error(`Largest JS chunk ${(largest.bytes / 1024).toFixed(1)} kB exceeds ${(MAX_JS_CHUNK_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (initialTotal > MAX_INITIAL_JS_BYTES) {
    throw new Error(`Initial JS ${(initialTotal / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_JS_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (initialGzip > MAX_INITIAL_GZIP_BYTES) {
    throw new Error(`Initial gzip JS ${(initialGzip / 1024).toFixed(1)} kB exceeds ${(MAX_INITIAL_GZIP_BYTES / 1024).toFixed(0)} kB startup budget.`);
  }
  if (largestShopPayload.bytes > MAX_SHOP_OFFLINE_JS_BYTES) {
    throw new Error(`Largest shop offline JS ${(largestShopPayload.bytes / 1024).toFixed(1)} kB exceeds ${(MAX_SHOP_OFFLINE_JS_BYTES / 1024).toFixed(0)} kB budget.`);
  }
  if (largestShopPayload.gzipBytes > MAX_SHOP_OFFLINE_GZIP_BYTES) {
    throw new Error(`Largest shop offline gzip JS ${(largestShopPayload.gzipBytes / 1024).toFixed(1)} kB exceeds ${(MAX_SHOP_OFFLINE_GZIP_BYTES / 1024).toFixed(0)} kB budget.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
