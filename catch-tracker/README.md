# Catch Tracker

A live score tracker for osu!catch (the "fruits" ruleset), scoped to Taiwan
players, modeled on [mania-tracker.com](https://mania-tracker.com/). Both
mania and std already have dedicated third-party tracker/analysis sites —
taiko and catch don't. This fills the gap for catch.

Standalone Netlify site, sibling to the main
[osu-collection-hanabi](https://osu-collection-hanabi.netlify.app/) site —
lives in the same git repo (`catch-tracker/`) but deploys separately, with
its own Netlify site, own Blobs storage, own cron schedule. Linked from the
main site's 資源 (Resources) tab. See `SETUP.md` for first-time deployment.

## What it does

- **Rankings** (`index.html`) — TW catch players ranked by pp.
- **Live Feed** (`feed.html`) — a rolling feed of recently-detected scores
  from tracked TW players, filterable by grade / FC / choke.
- **Player** (`player.html?id=`) — one player's best + recent plays.
- **Map** (`map.html?id=`) — grade/mod distribution for one beatmap, among
  the tracked cohort's observed scores.

## How the data gets there

Two independent crons (see `netlify.toml`):

1. **`rankings-crawl-cron`** (hourly) — walks
   `GET /rankings/fruits/performance?country=TW`, keeps `rankings:TW`
   fresh, and rebuilds the score-poller's player queue (`players:index`)
   whenever a full sweep completes.
2. **`scores-poll-cron`** (every 5 min) — round-robins over `players:index`,
   polling each player's `GET /users/{id}/scores/recent?mode=fruits` and
   detecting new scores by diffing against last poll's snapshot. New scores
   get prepended to the `feed:recent` ring buffer.

Both are time-boxed (`budgetMs`) AND item-capped (`perRun`) per invocation,
so a tick that can't finish the whole player pool just does a partial sweep
and picks up where it left off next tick — see the `coverage` blocks on
`feed-list.js` / `rankings-list.js` for the actual freshness/coverage state.

Full design rationale, blob shapes, and open API-shape risks are in the
implementation plan this was built from (ask the person who built it, or
see git history around the `catch-tracker/` folder's initial commit).

## Local development

No build step — it's plain HTML/CSS/JS. Netlify Functions need real env
vars to hit Netlify Blobs / the osu! API (see `SETUP.md`), so local testing
without `netlify dev` is limited to frontend logic against a stubbed
`fetch`. Full end-to-end testing happens on the live deploy, same pattern
the main site uses.
