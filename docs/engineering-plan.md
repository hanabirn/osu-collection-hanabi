# Engineering plan — from "plain three-file site" to a tooled project

**Status:** Phase 1 done (2026-09-10). Phases 2–7 not started.

## Why

The site is plain HTML/CSS/JS with no framework and no client bundler:

- `index.html` — ~100 KB, all 20-plus tab sections inlined, ~232 inline
  `on*=""` handlers wired to **121 distinct global function names**.
- `js/` — 36 files, ~17.5k lines, **global-scope scripts, no `import`/`export`**;
  files see each other through `window`. `js/osu.js` alone is ~5.8k lines /
  262 functions.
- `css/` — 3 files, ~6.5k lines, no scoping (`osu.css` is ~4.7k).
- No TypeScript, no linter, no formatter, no tests, no CI.
- The only build step is `scripts/build.mjs` (esbuild **minify only** — no
  bundle, no hashing; every file keeps its path and global names because the
  inline handlers depend on them).

Consequences: a change can silently break another file (nothing checks the
121 cross-file globals); every change is verified by hand in a browser; and
`osu.js` is too big to navigate or review.

## Decision (2026-09-10)

A full stop-the-world rewrite to Vue + TS + Tailwind is **not** the plan: solo
maintainer, live product, no test net. Instead — **build the foundation first,
keep the vanilla DOM code working**, and decide about a framework later, one
tab at a time.

Ground rules for every phase:

- The site stays shippable at the end of each phase.
- Verify locally in the browser, then batch commits and push once (Netlify
  build credits are limited — see the deploy-batching note).
- `netlify/functions/**` (CommonJS, its own `package.json`) and `mp-bot/**`
  are **out of scope**, except optional shared types in phase 4.

---

## Phase 1 — Foundation ✅ (done 2026-09-10)

Pure additive config. **No `.js` / `.css` / `.html` / `sw.js` / `netlify.toml`
/ `scripts/build.mjs` was touched. `dist/` output is unchanged** (the only
per-build byte difference is `sw.js`'s pre-existing `BUILD_ID` timestamp).

Added:

| File | Purpose |
|---|---|
| `.gitattributes` | Force LF in the repo (dev on Windows `core.autocrlf=true`, build/serve on Linux). Does **not** renormalise existing files. |
| `.editorconfig` | 4-space / LF / UTF-8, matching the current style. |
| `.nvmrc` | Node `20` (match the Netlify build image). `package.json` also gains `"engines": { "node": ">=20" }`. |
| `eslint.config.mjs` | ESLint 9 flat config. Extends `js/recommended` for real-bug rules (`no-dupe-keys`, `no-const-assign`, `no-unreachable`, `valid-typeof`, …). `no-undef` **off** (global-scope scripts share names; checkJs handles genuine undefineds better). `no-unused-vars` is a **warn**. Per-area blocks for `js/**` (browser), `netlify/functions/**` (Node CJS), `scripts/**`+`*.mjs` (Node ESM), `js/i18n/**` (`I18N` global). NBSP allowed in template strings. |
| `.prettierrc.json` / `.prettierignore` | Config only — matches current style (4-space, single quote, width 100). The existing 24k lines are **not** reformatted yet (phase 5). `js/i18n/` is ignored (many keys per line on purpose). |
| `jsconfig.json` | TypeScript checking, **opt-in**: `checkJs: false`, `strict: true`, `@types/node`. A file gets checked by adding `// @ts-check` at the top. Phases 3–4 do this file by file. |
| `types/globals.d.ts` | Ambient decls for what TS can't see: `window.showDirectoryPicker`, `window.__LANG`. Shrinks away after phase 3. |

`package.json` scripts added: `dev` (`http-server . -p 8080 -c-1` — one-command
local server, same as `python -m http.server` but cache-disabled), `lint`,
`lint:fix`, `format`, `format:check`, `typecheck`.

### Phase 1 baseline (record; phases 2–4 drive these down)

- `npm run lint` → **0 errors, 222 warnings**, all `no-unused-vars` on
  top-level functions that are only referenced from inline handlers in
  `index.html` (ESLint can't see HTML). Clears in phase 5.
- `npm run typecheck` → **passes** (nothing opts in yet). A one-off census
  with `checkJs: true` reports **~210** issues in `js/` (84 in `osu.js`, 32
  in `chat.js`, …) — dominated by DOM-property access on the loose
  `HTMLElement` that `getElementById` returns, **not** real bugs.
- `npm run build` → `dist/` unchanged (see above).

---

## Phase 2 — Bundler (Vite)

- Make `index.html` the Vite entry; `npm run dev` becomes Vite (HMR — kills
  the "reload the tab after every edit" loop).
- `npm run build` → Vite build → still emits to `dist/` → Netlify publish
  unchanged.
- Rework the inline `document.write('<script src="js/i18n/…">')` locale
  bootstrap in `index.html` into something Vite can process.
- **Decide the deploy pipeline here** (open question): keep building on
  Netlify vs. move the build to GitHub Actions (repo is public → unlimited
  free minutes) + `netlify deploy --prod --dir=dist` so Netlify spends **0**
  build credits. Vite's build is heavier than the current esbuild-minify, so
  staying on Netlify build costs *more* credits than today.
- Keep `scripts/build.mjs`'s two non-obvious jobs: the OpenCC
  `js/i18n/zh-Hans.js` generation, and the per-deploy `sw.js` `BUILD_ID`
  stamp.

## Phase 3 — ES modules

- Convert `js/*.js` to ES modules file by file: `export` what other files
  use, `import` what it needs, instead of leaning on `window`.
- Keep a thin `window.X = X` bridge for the 121 names still referenced by
  inline handlers, until phase 6 removes the handlers.
- i18n: load locale dicts with `import.meta.glob`; drop `document.write`.
- `types/globals.d.ts` shrinks as real imports replace ambient globals.
- Start splitting `js/osu.js` along its existing `/* ===== */` section
  banners (collections, categories, practice-gen, digest, share-link, stats,
  pp-tools, OAuth, pp-calc, cards) into modules.

## Phase 4 — TypeScript

- Rename `.js` → `.ts` from the ES-module baseline. `// @ts-check` →
  real `.ts`. `strict` already on; fix per file as you convert.
- Wrap the ~40 `/.netlify/functions/*` calls in one typed API client with
  shared response types (put them in `types/` so `netlify/functions` can
  import the same shapes if useful).

## Phase 5 — Formatter + lint tightening

- One-shot `npm run format` (its own commit) + `git add --renormalize .`.
- Turn `no-undef` back on (or drop it — modules make it redundant); add
  `eslint-plugin-import`.
- Wire `lint` + `typecheck` into CI (GitHub Actions, on PR).

## Phase 6 — Components (optional, tab by tab)

- Add Vue 3 + Pinia + vue-router.
- Migrate one `page-*` section at a time to a component; Vue can mount into a
  single tab while the rest stays vanilla.
- Move the `localStorage`-poking globals into Pinia stores.
- Stoppable at any tab with a working site.

## Phase 7 — Tailwind + tests

- Tailwind for new/migrated components only; retire slices of `css/osu.css`
  as their tab migrates.
- Vitest for the pure logic: pp math, i18n `t()`, the farm heuristic, the
  `.db` / `.osdb` parsers in `osu.js`.
- Playwright: 2–3 smoke flows (load, switch tabs, add to collection, pp
  lookup).
- CI runs lint + typecheck + tests on every PR.
