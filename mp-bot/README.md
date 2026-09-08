# osu-collection-mp-bot

The osu! **multiplayer host bot** for [osu! 歌曲收藏](https://osu-collection-hanabi.netlify.app).
It opens a multi lobby and cycles through the maps from a visitor's saved
collection / favourites so a group can just play them.

It is **not** part of the Netlify site — it needs a persistent IRC
connection, so it runs as an always-on process on its own small box.
The website and the bot talk only through one Netlify Blobs store
(`osu-games`): the site appends to `mp-requests`, the bot writes
`mp-status:<id>` back.

## How it works

```
website  ──(POST /mp-lobby-request)──►  mp-requests[]  (Netlify Blobs)
                                             │  poll every 5s
                                             ▼
                                     this bot (bancho.js / IRC)
                                             │  !mp make, invite, !mp map …
                                             ▼
                                     an osu! multiplayer lobby
                                             │
website  ◄──(GET /mp-lobby-status)──   mp-status:<id>
```

In the lobby, players use:

| command | who | effect |
|---|---|---|
| `!skip` | anyone (majority) or host | skip the current map |
| `!next` | host | next map now |
| `!shuffle` | host | shuffle the remaining queue |
| `!info` | anyone | current map + link |
| `!queue` / `!list` | anyone | the next few maps |
| `!close` | host | close the lobby |

Empty lobbies close themselves after `LOBBY_IDLE_CLOSE_MS`.

## Run it

See **[SETUP.md](./SETUP.md)** for the full first-time walkthrough
(Hetzner box → osu! bot account → clone → `.env` → systemd).

Quick version once set up:

```sh
cd mp-bot
npm install
cp .env.example .env      # then edit .env
npm start
```
