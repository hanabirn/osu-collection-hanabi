# mp-bot — first-time setup

One-time. ~30–40 min. You need: a credit/debit card (Hetzner), an osu!
account for the bot, and the Netlify values you already used for the site.

At the end you'll have a tiny always-on server running the bot under
`systemd`, restarting itself on crash or reboot.

---

## 1. Rent the server (Hetzner Cloud)

1. Sign up at <https://console.hetzner.cloud> → verify email → add a
   payment method.
2. **New project** → name it e.g. `osu-bot`.
3. **Add Server**:
   - **Location**: pick the one nearest you (Nuremberg/Falkenstein/Helsinki
     for EU, Ashburn/Hillsboro for US, Singapore for Asia).
   - **Image**: **Ubuntu 24.04**.
   - **Type**: **Shared vCPU → Arm64 → CAX11** (2 vCPU / 4 GB, ~€3.79/mo).
     (The x86 CX22 is fine too; Arm is cheaper and Node runs great on it.)
   - **Networking**: leave IPv4 + IPv6 on.
   - **SSH keys**: if you have one, add it (paste your `~/.ssh/id_ed25519.pub`).
     If not, skip — Hetzner will email you a root password.
   - **Name**: `osu-bot-1`.
   - **Create & Buy now**.
4. When it's ready, note the **public IPv4** shown on the server page.

### Connect

From your machine's terminal (PowerShell, Terminal, etc.):

```sh
ssh root@YOUR_SERVER_IP
```

- With an SSH key: it just logs in.
- With a password: paste the one from Hetzner's email; it'll force you to
  set a new one on first login.

Everything below runs **on the server** (in that ssh session).

---

## 2. Prepare the server

```sh
# updates + basics
apt update && apt -y upgrade
apt -y install git curl ufw

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v        # should print v20.x

# a non-root user to run the bot
adduser --disabled-password --gecos "" bot
```

Optional but nice — a basic firewall (the bot only makes *outbound*
connections, so only SSH needs to be open):

```sh
ufw allow OpenSSH
ufw --force enable
```

---

## 3. Get the bot's osu! IRC credentials

1. Decide which osu! account the bot logs in as. It can be a **dedicated
   alt** (recommended) or your main. It does **not** need osu!supporter.
2. Log into that account on the website, go to
   **<https://osu.ppy.sh/home/account/edit>**, scroll to **Legacy API**.
3. There's an **IRC password** there (a short random string). If it's not
   shown, the page has a button to generate/reveal it. Copy it.
   - Direct link that also shows it: <https://osu.ppy.sh/p/irc>
   - This is **not** your osu! login password.
4. You now have:
   - `BANCHO_USERNAME` = that account's osu! username (spaces become `_`
     is handled for you, just type it as shown)
   - `BANCHO_PASSWORD` = the IRC password

> Rate limits: a normal account can send ~1 message every 2 s, which is
> enough for map-cycling. If you later run big/busy lobbies, ask ppy (in
> `#osu-help` on the dev server, or a forum PM to a dev) to flag the
> account as a **bot account** — then set `BANCHO_BOT_ACCOUNT=1` in `.env`.

---

## 4. Get the Netlify Blobs values

These are the **same two** the website's functions use — you can reuse them.

- `NETLIFY_BLOBS_SITE_ID` — Netlify → your site → **Project configuration →
  Project information → Project ID**.
- `NETLIFY_BLOBS_TOKEN` — Netlify → **User settings → Applications → Personal
  access tokens → New access token** (name it `mp-bot`). Copy it now; you
  can't see it again.

(If you saved these somewhere when setting up the site, just reuse them.)

`OSU_API_KEY` (optional) — <https://osu.ppy.sh/p/api>, only used to show a
live star rating in `!info`. Leave blank to skip.

---

## 5. Clone and configure

```sh
su - bot                              # become the bot user
git clone https://github.com/hanabirn/osu-collection-hanabi.git
cd osu-collection-hanabi/mp-bot
npm install                           # installs bancho.js etc.

cp .env.example .env
nano .env                             # fill in the 4 required values
```

Fill at least:

```
BANCHO_USERNAME=the_bot_osu_name
BANCHO_PASSWORD=the_irc_password
NETLIFY_BLOBS_SITE_ID=...
NETLIFY_BLOBS_TOKEN=...
```

Save (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Smoke test

```sh
npm start
```

You should see `[bot] connected to Bancho as <name>` within a few seconds.
Leave it a minute — it'll just log poll ticks with nothing to do. Then
`Ctrl+C` to stop; the next step makes it run properly in the background.

If it can't connect: double-check the IRC password (not the site password),
and that the username matches the account you took the password from.

---

## 6. Run it as a service (systemd)

Back as **root** (`exit` out of the `bot` shell, or open a second ssh):

```sh
nano /etc/systemd/system/mp-bot.service
```

Paste:

```ini
[Unit]
Description=osu! collection multiplayer bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bot
WorkingDirectory=/home/bot/osu-collection-hanabi/mp-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:

```sh
systemctl daemon-reload
systemctl enable --now mp-bot
systemctl status mp-bot          # should say "active (running)"
journalctl -u mp-bot -f         # live logs — Ctrl+C to stop watching
```

That's it. It now starts on boot and restarts within 5 s if it ever
crashes or gets disconnected.

---

## Updating later

```sh
su - bot
cd ~/osu-collection-hanabi
git pull
cd mp-bot && npm install        # in case deps changed
exit
systemctl restart mp-bot
```

## Handy commands

| | |
|---|---|
| logs | `journalctl -u mp-bot -f` |
| restart | `systemctl restart mp-bot` |
| stop | `systemctl stop mp-bot` |
| is it running | `systemctl status mp-bot` |
| edit config | `nano /home/bot/osu-collection-hanabi/mp-bot/.env` then `systemctl restart mp-bot` |

---

## What's left (website side — I'll add these)

- `mp-lobby-request.js` (login-gated): resolves your collection's sets to
  beatmap ids and appends a request to `mp-requests`.
- `mp-lobby-status.js`: what the page polls to show "lobby open — osu://mp/…".
- A **"🎮 開 multi 房打這份"** button on the collection page / gallery detail.

Until those ship you can test the bot by hand-writing a request into the
blob (ask me for a one-liner).
