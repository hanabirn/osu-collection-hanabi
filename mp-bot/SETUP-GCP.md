# mp-bot — setup on Google Cloud (free tier)

Runs the bot on a **GCP `e2-micro`** VM, which is in Google's *Always Free*
tier (1 e2-micro per month in `us-west1` / `us-central1` / `us-east1`,
30 GB standard disk, 1 GB North-America egress). The bot uses ~150 MB RAM
and a trickle of IRC text, so it stays free.

You need a Google account with **billing enabled** (a card on file — it is
not charged while you stay in the free tier). Set a $1 budget alert
(step 6) for peace of mind.

---

## 1. Project + billing

1. <https://console.cloud.google.com> → sign in.
2. Create a project (e.g. `osu-bot`). Note its **Project ID** (looks like
   `osu-bot-508007`).
3. **Billing** → link a billing account / add a card. Accepting the $300
   free-trial offer is fine; Always Free still applies afterwards.

## 2. Create the VM (the easy way — Cloud Shell)

The web form for "Create an instance" changes often and it's easy to pick a
non-free disk type. One command avoids all of that.

1. Top-right of the console → the **`>_`** icon (**Activate Cloud Shell**).
   A terminal opens, already logged in as you.
2. Enable the Compute API:
   ```sh
   gcloud services enable compute.googleapis.com --project=YOUR_PROJECT_ID
   ```
3. Create the VM:
   ```sh
   gcloud compute instances create osu-bot \
     --project=YOUR_PROJECT_ID \
     --zone=us-central1-a \
     --machine-type=e2-micro \
     --image-family=ubuntu-2404-lts-amd64 \
     --image-project=ubuntu-os-cloud \
     --boot-disk-size=30GB \
     --boot-disk-type=pd-standard
   ```
   `e2-micro` + `us-central1` + `pd-standard` + 30 GB = all inside Always
   Free. Answer `Y` if it prompts to continue.
4. SSH in:
   ```sh
   gcloud compute ssh osu-bot --zone=us-central1-a
   ```
   (First run generates an SSH key — press Enter through the passphrase
   prompts.)

> Prefer the web UI? Create Instance → Region **us-central1** → Series
> **E2** → Machine type **e2-micro** → boot disk **Change** → Ubuntu 24.04
> LTS (amd64), disk type **Standard persistent disk**, 30 GB → don't tick
> "Allow HTTP/HTTPS" → Create. The cost estimate may show the pre-discount
> price (~$7/mo); the free-tier credit is applied on the actual bill.

## 3. Prepare the VM

Inside the SSH session:

```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt -y install nodejs
node -v                              # v20.x

# 1 GB RAM — add 1 GB swap so npm install / node don't get OOM-killed
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# a user to run the bot
sudo adduser --disabled-password --gecos "" bot
```

(No `ufw` step — GCP's firewall already blocks inbound except SSH.)

## 4. Get the credentials

- `BANCHO_USERNAME` / `BANCHO_PASSWORD` — the bot's osu! username, and its
  **IRC password** from <https://osu.ppy.sh/home/account/edit> → Legacy API
  (NOT the site login password; also at <https://osu.ppy.sh/p/irc>).
- `NETLIFY_BLOBS_SITE_ID` — Netlify → Project configuration → **Project ID**.
- `NETLIFY_BLOBS_TOKEN` — Netlify → User settings → Applications → **new
  personal access token**. (Reuse the ones from the website setup.)
- `OSU_API_KEY` (optional) — <https://osu.ppy.sh/p/api>.

## 5. Clone + configure

```sh
sudo -u bot -i
git clone https://github.com/hanabirn/osu-collection-hanabi.git
cd osu-collection-hanabi/mp-bot
npm install

cp .env.example .env
nano .env                            # fill the 4 required values; Ctrl+O, Enter, Ctrl+X
npm start                            # expect "[bot] connected to Bancho as <name>" — then Ctrl+C
exit
```

## 6. Run as a service + budget alert

```sh
sudo nano /etc/systemd/system/mp-bot.service
```

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

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now mp-bot
sudo systemctl status mp-bot         # active (running)
sudo journalctl -u mp-bot -f         # live logs
```

**Budget alert** — Billing → **Budgets & alerts** → Create budget → amount
**$1** → email at 50/90/100 %. If anything ever leaves the free tier you'll
know immediately.

## Updating

```sh
sudo -u bot -i
cd ~/osu-collection-hanabi && git pull && cd mp-bot && npm install
exit
sudo systemctl restart mp-bot
```

## Handy commands

| | |
|---|---|
| logs | `sudo journalctl -u mp-bot -f` |
| restart | `sudo systemctl restart mp-bot` |
| stop | `sudo systemctl stop mp-bot` |
| status | `sudo systemctl status mp-bot` |
| SSH back in | `gcloud compute ssh osu-bot --zone=us-central1-a` (from Cloud Shell) |
| edit config | `sudo nano /home/bot/osu-collection-hanabi/mp-bot/.env` then restart |
