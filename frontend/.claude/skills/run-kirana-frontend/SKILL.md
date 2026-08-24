---
name: run-kirana-frontend
description: Run, launch, drive and screenshot the Artha (KiranaOS) frontend for UI/UX review — open any route, resize to a phone or POS viewport, click and fill controls, and get an accessibility / layout / touch-target report on what is actually on screen. Use for "run the app", "start the frontend", "screenshot billing", "check this screen on mobile", "review the UI", "is this accessible", "does this overflow".
---

# Run and drive the Artha frontend

A React 19 + Vite PWA (Hindi-first, offline-first, ~78 routes) for a shop
counter. It is driven headlessly over the Chrome DevTools Protocol by
`.claude/skills/run-kirana-frontend/driver.mjs`, which opens a route, looks at
it, pokes it, and reports what is wrong with it.

**All paths below are relative to `frontend/`.** The driver resolves its own
`node_modules` and output directory from its file location, so the commands
also work verbatim from the repo root with a `frontend/` prefix.

## Prerequisites

- Node ≥ 20 (verified on v24.12.0) and Google Chrome. The driver looks for
  `C:\Program Files\Google\Chrome\Application\chrome.exe`; override with
  `CHROME_PATH`.
- `frontend/` is a **pnpm** project and pnpm is not on PATH. Use
  `npx --yes pnpm ...`, never `npm install` — it dies on `workspace:`.

## Setup — always work in a worktree

More than one agent session shares this checkout. Do not run the app from the
main tree; make a worktree that has the untracked things it needs (`backend/.env`,
`node_modules`, its own `dev.db`) copied in:

```bash
node scripts/new-worktree.mjs uiux
```

That takes a few minutes (a real `npm ci` per package — never junction the main
`node_modules` into a worktree, `prisma generate` through such a link corrupts
the main checkout's Prisma client).

## Run the servers

Two servers, from inside the worktree. The backend's `ALLOWED_ORIGINS` trusts
only 5173, 5174, 5500 and 51977 and it does **not** reload `.env` — pick a port
from that list.

```bash
cd .claude/worktrees/uiux/backend && npm run dev
```

```bash
cd .claude/worktrees/uiux/frontend && npm run dev -- --port 5174 --strictPort
```

Wait until both answer, then drive:

```bash
until curl -sf http://127.0.0.1:3000/health/ready >/dev/null && curl -sf http://127.0.0.1:5174/ >/dev/null; do sleep 1; done; echo READY
```

Point the driver elsewhere with `QA_FRONTEND_URL` / `QA_API_URL`.

## Run (agent path) — the driver

One command, chain steps with a spaced `;`. First call launches Chrome
**detached** and registers a QA shop; later calls re-attach to the same browser,
so the login and the current screen survive between invocations (~2s per call).

```bash
cd .claude/worktrees/uiux/frontend && node .claude/skills/run-kirana-frontend/driver.mjs size mobile ";" goto /billing ";" shot billing-mobile ";" audit
```

Screenshots land in `qa-artifacts/uiux/` (gitignored) — **open them and look**.

| Command | Does |
|---|---|
| `goto <route>` | navigate, wait for `.app-route-ready` |
| `shot [name]` / `shotfull [name]` | viewport / full-page PNG |
| `size <WxH>` or `mobile small large tablet desktop pos` | `mobile` = 390×844, `pos` = 1920×1080 |
| `theme <light\|dark>` | see gotcha below — dark is a preview, not a user state |
| `audit` | the UI/UX report |
| `controls` | visible controls tagged `r0`, `r1`, … |
| `click <r0\|css\|text=…>` | real mouse event at the centre; warns if an overlay took it |
| `fill <r0\|css> <value>` | native setter, so React state updates |
| `press <Enter\|Tab\|Escape\|…>` | key event |
| `text [css]` / `eval <js>` / `errors` | innerText, evaluate, captured runtime errors |
| `quit` | close the detached Chrome |

`help` prints the same list.

### Reading `audit`

It **reports; it never throws.** That is the whole difference from
`scripts/capture-*.mjs`, which are release *gates* that assert and die on the
first problem — right for CI, useless for review, where you want all ten issues
on a screen at once.

- **`appReady`** — read this first. `false` means the page had not finished
  rendering and every other number is meaningless (an unready page reports
  zero controls and zero problems, which looks exactly like a clean page).
- **`bleeding`** — elements crossing the viewport edge that are genuinely
  **clipped**, outermost first, with `suspectMinWidthAuto` when the cause is
  the usual one. **Trust this, not `documentWidth`** (see gotcha).
- **`reachableByScroll`** — a count, not a defect. Overflow inside an
  `overflow-x:auto` ancestor is meant to scroll (a 1020px ledger table in a
  960px wrapper), so it is kept out of `bleeding` and counted here instead.
- **`touchTargets`** — hit areas under 44px, overlay-aware. `rawBox` appears
  when the measured box differs from the visual one.
- **`clicksStolen`** — a control whose centre point belongs to some other
  element. Invisible in a screenshot; this is how a floating button eats a
  dropdown. Controls scrolled out of their own container are excluded — they
  are reachable, and counting them made every desktop route cry wolf.
- **`clippedControls`** — a control lying outside an `overflow:hidden`/`clip`
  ancestor. Unlike the above it cannot be scrolled to; it is painted nowhere.
- **`axe`** — WCAG 2.0/2.1/2.2 A + AA violations from axe-core.

## Run (human path)

`npm run dev -- --port 5174` and open `http://127.0.0.1:5174` in a real browser.
You land on `/login` — every route redirects there until a session exists. To
sign in as the shop the driver registered, read its mobile number out of
`localStorage["kiranaos.qa.mobile"]`; the password is `Test@12345` and the owner
PIN is `2468`. Or just register your own shop through the UI.

## Test

```bash
cd frontend && npm run prod:check
```

Typecheck, i18n, vitest, build, bundle budget, production app check. The i18n
hardcoded-string allowlist is a **ratchet** — a listed file is a ceiling, not a
pass.

## Gotchas

- **`.gitignore` swallows this skill.** Line 29 is `.claude/`, which matches at
  *any* depth, so `frontend/.claude/skills/` is ignored by default and a skill
  written there silently never gets committed. Git cannot re-include a file
  whose parent directory is excluded, so the fix is a negation per level
  (`!frontend/.claude/`, `!frontend/.claude/skills/`,
  `!frontend/.claude/skills/**`) — already in `.gitignore`; do not "tidy" it
  away. Verify with `git add -n <path>`, not `git check-ignore`, whose exit code
  is 0 even when the last matching pattern is a negation.
- **Horizontal overflow is silent.** The shell sets `overflow-x: clip`, so an
  over-wide child is *sliced off* instead of making the page scroll.
  `documentWidth` stays exactly equal to the viewport while content is
  genuinely unreachable — the "Add customer" dialog is 188px too wide at 390px
  and `documentWidth` still reads 390. Read `bleeding`. The cause is nearly
  always a grid/flex child at `min-width: auto`.
- **Touch targets are only padded below 1024px.** `.tap-target::after` paints a
  `max(100%, 44px)` overlay, but the rule lives inside
  `@media (max-width: 1023px)`. So a 41×17 link is a real 44×44 hit area on a
  phone and a real 41×17 hit area at desktop width. The audit measures the
  overlay, so undersized findings at `mobile`/`tablet` are genuine; at
  `desktop` they are the design's deliberate mouse-sized controls. Judge touch
  at touch viewports — and note a counter POS (`pos`, 1920×1080) is a *wide
  touchscreen*, where the overlay does **not** apply.
- **Dark mode is not reachable.** The CSS keys off a `.dark` class
  (`@custom-variant dark (&:is(.dark *))`), not `prefers-color-scheme`, and
  nothing in `src/` ever adds that class. `theme dark` sets it for you, but the
  tokens are only half-consumed: `--background` flips to `222 47% 8%` while
  `body` still computes `rgb(255,255,255)`, because the shell paints hardcoded
  colours. So `theme dark` previews unfinished styles — it is not a state a
  user can get into. A full `goto` drops the class; run `theme` **after**
  `goto`.
- **The route argument gets mangled by Git Bash.** MSYS rewrites a leading-slash
  argument into a Windows path, so `goto /billing` arrives as
  `C:/Program Files/Git/billing`. The driver peels the MSYS root back off; if
  you write your own script, quote the route or expect
  "Cannot navigate to invalid URL".
- **CDP instrumentation is per-connection.** `Page.addScriptToEvaluateOnNewDocument`
  is scoped to the CDP connection, and this driver exits after every command —
  so axe-core silently vanished from every run after the first. The driver now
  re-instruments on every attach and tops up the already-open document; keep
  that if you refactor.
- **Check which tree a port serves before believing anything.** A stale dev
  server from another worktree is the most expensive way to be wrong. 5173 and
  51977 are usually another session's.
- **Editing anything under `frontend/` full-reloads the page**, which looks
  exactly like a form resetting itself. Finish driving before you edit.
- The UI defaults to **Hindi**, so `text=` matching and `controls` labels are
  Devanagari (`ग्राहक जोड़ें` = Add customer).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Timed out waiting for backend http://127.0.0.1:3000/api` | Backend is not up. It boots from the worktree's own `backend/.env`; a worktree made with plain `git worktree add` has none. |
| `audit` shows `"axe": {"note": "axe-core absent…"}` | Only happens if `node_modules/axe-core` is missing — reinstall with `npx --yes pnpm install --frozen-lockfile --force`. |
| `appReady: false`, everything reads zero | The audit caught a mid-render page. Put `goto` in the *same* invocation, before `audit`. |
| `click … -> NOT FOUND` | Refs come from the last `controls` call and are stamped into the DOM; re-run `controls` after the DOM changes. |
| `goto` warns `never reached .app-route-ready` | Route rendered an error boundary or is still fetching — run `text` and `errors`. |
| Chrome will not start / port busy | `node .claude/skills/run-kirana-frontend/driver.mjs quit`, or change `QA_DEBUG_PORT`. |
