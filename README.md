# osu! 歌曲收藏 · osu! Collection (Hanabi)

A fan-made companion site for [osu!](https://osu.ppy.sh) built around **song
collections** — browse and assemble `.db` / `.osdb` collections, look up pp,
generate practice pools from your own scores, browse the ranked catalogue and
every World Cup mappool, and chat with other players.

**Live:** <https://osu-collection-hanabi.netlify.app>

This is a personal project by [HANABI_RN](https://osu.ppy.sh/users/26696007),
not affiliated with or endorsed by ppy. "osu!" is a trademark of ppy Pty Ltd.

---

## What's in it

- **Collections** — build osu! collections in the browser, import/export
  `collection.db` and Collection Manager `.osdb`, publish to a public gallery
  with comments, RSS and a shareable `/c/<id>` page.
- **PP tools** — pp lookup, score history, recommended-SR "breakthrough"
  targets, replay analysis.
- **Farm Maps** — a self-computed pp database (rosu-pp) with a per-mode
  "is this actually a farm map" heuristic, filterable by pp / stars / BPM / mods.
- **Practice collections** — turn your top plays into a playable collection
  (weak-spot / goal / low-accuracy / similar-maps kinds).
- **Catalogue & World Cup mappools** — the whole ranked catalogue indexed by
  artist / language / genre / source; every official OWC/TWC/MWC/CWC pool
  parsed from the osu-wiki.
- **Chat & DMs**, mapper tracking with Web Push, an in-site user manual,
  8 UI languages.
- **Discord bot** — HTTP-interactions endpoint (`netlify/functions/discord-interactions.js`)
  with ~17 slash commands that reuse the same backends; `.osdb` exports.

## Tech

Plain static HTML/CSS/JS — **no framework, no client bundler**. `index.html`
plus `js/*.js` (~26 files) and `css/*.css` loaded as regular `<script>` /
`<link>` tags. State lives in `localStorage`; anything shared or server-side is
a **Netlify Function** (`netlify/functions/*.js`, ~15 features + shared `_*.js`
helpers) backed by **Netlify Blobs**. pp/star math uses `rosu-pp-js` (WASM) in
the functions. i18n is one dict file per locale; Simplified Chinese is
generated from the Traditional source at build time (OpenCC).

The only build step (`npm run build` → `scripts/build.mjs`) copies the site
into `dist/` and minifies it with esbuild — **no bundling, no hashing**, every
file keeps its path and global names. Local dev serves the source directly.

## Running locally

```bash
npm install
npm run build          # optional — generates js/i18n/zh-Hans.js + dist/
npx netlify dev        # serves the site + functions on localhost
```

Static-only browsing works from any file server (`python -m http.server`,
etc.); the Functions-backed features (login, gallery, chat, farm DB, Discord
bot) need `netlify dev` and the environment below.

## Environment

Set in the Netlify project (or a local `.env`, git-ignored). Features degrade
gracefully when their vars are missing.

| Purpose | Vars |
| --- | --- |
| osu! OAuth + API | `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`, `OSU_REDIRECT_URI`, `OSU_API_KEY`, `OSU_AUTH_SECRET` |
| Netlify Blobs (when not auto-injected) | `NETLIFY_BLOBS_SITE_ID`, `NETLIFY_BLOBS_TOKEN` |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Discord bot | `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GALLERY_CHANNEL_ID`, `DISCORD_ANNOUNCE_LOCALE` |
| Chat moderation | `CHAT_OWNER_OSU_ID` |
| Crawler trigger secrets | `FARM_CRAWL_SECRET`, `CATALOG_CRAWL_SECRET`, `WC_MAPPOOL_CRAWL_SECRET` |

Scheduled crawlers (farm DB, ranked catalogue, WC mappools) and the Web Push
check run as Netlify cron functions — see `netlify.toml`.

## Deploy

Push to `main`; Netlify runs `npm run build` and publishes `dist/`. `sw.js`
gets a fresh build id per deploy so the PWA prompts to update.

## Status & contributing

Actively developed, single maintainer, shipped in small commits. Issues and
PRs are welcome but may not get a fast response. There is currently **no
license** — the code is public to read; ask before reusing a chunk of it.
