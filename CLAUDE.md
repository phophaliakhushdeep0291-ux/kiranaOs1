# Working in this repo

Start with `ARCHITECTURE.md` — the shape of the system, the four models that
explain most of the code, and the traps that have already cost time.

## Work in a worktree

**Call `EnterWorktree` at the start of any session that will change files here.**

More than one Claude session runs against this checkout, and they share one
working tree, one index and one branch. When two sessions work in it at once the
failure is not a merge conflict — it is quieter than that:

- an auto-commit sweeps up whatever is in the tree, so one session's commit
  carries another session's half-finished files
- unrelated work reaches `main` in a single PR, unreviewed, because it happened
  to be staged at the same moment
- `git checkout` moves the tree under the other session's running dev server

All three have happened. On 2026-08-23 a PR meant to carry a product-image change
also merged 1,569 lines of voice dictation from a second session, because both
were editing the same checkout.

A worktree gives the session its own branch, index and files, which removes the
whole class of problem. `scripts/new-worktree.mjs <name>` does the same thing from
a shell, and additionally copies the untracked things a worktree cannot inherit —
`backend/.env`, `frontend/.env*`, and its own `dev.db` — then installs
dependencies. Never junction the main repo's `node_modules` into a worktree:
`prisma generate` through such a link corrupts the main checkout's client.

A session cannot remove its own worktree; tidy up from the main checkout.

## Before believing a UI observation

Check which tree the port you are looking at is actually served from. A stale dev
server from another worktree is the most expensive way to be wrong. The API's
`ALLOWED_ORIGINS` trusts only 5173, 5174, 5500 and 51977, and the backend does not
reload `.env`, so pick a port from that list rather than editing the allowlist.

## Gates

`cd frontend && npm run prod:check` is the release gate: typecheck, i18n, tests,
build, bundle budget and the production app check. Run it before saying a change
is ready. The i18n hardcoded-string allowlist is a **ratchet** — a listed file is
a ceiling, not a pass.
