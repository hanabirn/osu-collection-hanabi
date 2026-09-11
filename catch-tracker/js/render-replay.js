/* Watch Replay — canvas playback.

   *** UNVERIFIED AGAINST REAL REPLAY DATA ***
   As of this commit, no score with an actual downloadable online replay has
   been found anywhere this was checked: every one of a real logged-in
   user's own 100 best plays (including one submitted 3 minutes earlier,
   confirmed via a direct osu! API call with that user's own bearer token —
   a real 404 from osu! itself, not from our code), the top 15 TW players'
   best+recent plays, and even the #1 GLOBAL catch player's best plays all
   report has_replay:false / 404 on download. This looks like a genuine,
   widespread characteristic of current catch replay availability, not a
   bug — see the implementation plan's session log for the full
   investigation. Net effect: the actual SHAPE of a successfully decoded
   .osr (ScoreDecoder().decodeFromBuffer()) and a successfully converted
   replay (CatchReplayConverter().convertReplay()) has never been observed.
   Method NAMES are confirmed to exist (didn't throw on garbage bytes), but
   field names on their return values are informed guesses — see
   getObjectX()/getFrameX() below, which try several plausible names
   defensively and log the raw objects on first use. Treat the first real
   successful replay view (whenever one becomes available) as a required
   verification pass, not a formality — it will very likely need small
   fixes to these two functions.

   Loaded as a <script type="module"> — this site has no CSP (unlike the
   main site, whose CSP blocks CDN libs), so esm.sh imports work directly,
   no build step needed. common.js/api.js are loaded first as classic
   scripts and expose their top-level functions as globals. */

const PARSERS_URL = 'https://esm.sh/osu-parsers@4.1.7';
const CATCH_STABLE_URL = 'https://esm.sh/osu-catch-stable@4.0.1';
const PLAYFIELD_X = 512; // osu! catch coordinate space width, in osu!pixels

const main = document.getElementById('replay-main');

function setStatus(html) {
    main.innerHTML = html;
}

function loginGateHtml() {
    return `
        <div class="card" style="max-width:480px;margin:60px auto;text-align:center;padding:32px">
            <p style="margin-top:0">${escapeHtml(t('replay_login_prompt'))}</p>
            <a class="ct-login-btn" href="${ctLoginUrl()}" style="display:inline-flex">${escapeHtml(t('login_with_osu'))}</a>
        </div>
    `;
}

function errorHtml(msg) {
    return `<p class="coverage-note">${escapeHtml(msg)}</p>`;
}

async function fetchBeatmapFile(beatmapId) {
    const res = await fetch(`${API_BASE}/beatmap-file?beatmap_id=${encodeURIComponent(beatmapId)}`);
    if (!res.ok) throw new Error(`beatmap-file: ${res.status}`);
    const { content } = await res.json();
    return content;
}

async function fetchReplayBytes(scoreId) {
    const res = await fetch(`${API_BASE}/replay-download?score_id=${encodeURIComponent(scoreId)}`, {
        headers: { Authorization: `Bearer ${getCtAuthToken()}` },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) throw new Error(t('replay_owner_only'));
        if (res.status === 404) throw new Error(t('replay_not_found'));
        if (res.status === 401) throw new Error(t('replay_login_prompt'));
        throw new Error(t('replay_fetch_failed', { msg: body.error || res.status }));
    }
    return res.arrayBuffer();
}

/* ---------- unverified data-shape helpers (see file header) ---------- */

function getObjectX(h) {
    const candidates = [h.effectiveX, h.originalX, h.x, h._originalX];
    for (const c of candidates) if (typeof c === 'number' && Number.isFinite(c)) return c;
    return 0;
}

function getFrameX(frame) {
    const candidates = [
        frame.position && frame.position.x,
        frame.x,
        frame.catcherPosition,
    ];
    for (const c of candidates) if (typeof c === 'number' && Number.isFinite(c)) return c;
    return null;
}

function classifyObject(h, classes) {
    const { Fruit, Banana, JuiceDroplet, JuiceTinyDroplet } = classes;
    if (Banana && h instanceof Banana) return 'banana';
    if (JuiceTinyDroplet && h instanceof JuiceTinyDroplet) return 'tiny';
    if (JuiceDroplet && h instanceof JuiceDroplet) return 'droplet';
    if (Fruit && h instanceof Fruit) return 'fruit';
    return 'fruit';
}

function buildDropItem(h, classes) {
    const x = getObjectX(h);
    const preempt = (typeof h.timePreempt === 'number' && h.timePreempt > 0) ? h.timePreempt : 800;
    return { time: h.startTime, spawnTime: h.startTime - preempt, x, kind: classifyObject(h, classes) };
}

// Flattens juice-stream/banana-shower "holdable" objects into their
// individual falling pieces (nestedHitObjects), matching real catch
// gameplay — a JuiceStream is a container, not something the catcher
// catches directly.
function flattenHitObjects(hitObjects, classes) {
    const out = [];
    for (const h of hitObjects) {
        if (Array.isArray(h.nestedHitObjects) && h.nestedHitObjects.length) {
            for (const n of h.nestedHitObjects) out.push(buildDropItem(n, classes));
        } else {
            out.push(buildDropItem(h, classes));
        }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
}

// Cheap manual mod handling instead of the library's own mod-combination
// API (never verified against real usage) — HR mirrors X, DT/HT scale the
// playback clock. Good enough for a v1 visual approximation; not meant to
// be judgement-accurate.
function applyHrMirror(items, mods) {
    if (!mods.includes('HR')) return items;
    return items.map(it => ({ ...it, x: PLAYFIELD_X - it.x }));
}
function clockRateForMods(mods) {
    if (mods.includes('DT') || mods.includes('NC')) return 1.5;
    if (mods.includes('HT') || mods.includes('DC')) return 0.75;
    return 1;
}

// Approximate osu!catch catcher width from CS, ported from the general
// shape of osu!lazer's Catcher sizing — for visual scale only, not used
// for any judgement/scoring logic here.
function catcherWidthFor(cs) {
    const scale = 1 - 0.7 * ((cs ?? 5) - 5) / 5;
    return Math.max(40, 106.75 * scale);
}

const COLORS = { fruit: '#fb5a8c', droplet: '#60a5fa', tiny: '#93c5fd', banana: '#facc15' };

/* ---------- canvas player ---------- */

class ReplayPlayer {
    constructor(canvas, items, frames, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.items = items;
        this.frames = frames;
        this.clockRate = opts.clockRate;
        this.catcherWidth = opts.catcherWidth;
        const itemMin = items.length ? items[0].spawnTime : 0;
        const itemMax = items.length ? items[items.length - 1].time : 0;
        const frameMin = frames.length ? frames[0].time : itemMin;
        const frameMax = frames.length ? frames[frames.length - 1].time : itemMax;
        this.minTime = Math.min(itemMin, frameMin);
        this.maxTime = Math.max(itemMax, frameMax) + 500;
        this.mapTime = this.minTime;
        this.playing = false;
        this.speed = 1;
        this.rafId = null;
        this.lastWall = 0;
        this.onTick = opts.onTick || (() => {});
    }

    catcherXAt(t) {
        const frames = this.frames;
        if (!frames.length) return PLAYFIELD_X / 2;
        if (t <= frames[0].time) return frames[0].x;
        if (t >= frames[frames.length - 1].time) return frames[frames.length - 1].x;
        let lo = 0, hi = frames.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (frames[mid].time <= t) lo = mid; else hi = mid;
        }
        const a = frames[lo], b = frames[hi];
        const span = b.time - a.time;
        const frac = span > 0 ? (t - a.time) / span : 0;
        return a.x + (b.x - a.x) * frac;
    }

    draw() {
        const { ctx, canvas } = this;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const catchLineY = h * 0.88;
        const toPx = x => (x / PLAYFIELD_X) * w;

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(0, catchLineY); ctx.lineTo(w, catchLineY); ctx.stroke();

        for (const it of this.items) {
            if (this.mapTime < it.spawnTime - 50 || this.mapTime > it.time + 150) continue;
            const span = it.time - it.spawnTime || 1;
            const progress = Math.min(1, Math.max(0, (this.mapTime - it.spawnTime) / span));
            const y = progress * catchLineY;
            const px = toPx(it.x);
            const size = it.kind === 'tiny' ? 4 : it.kind === 'droplet' ? 7 : it.kind === 'banana' ? 9 : 10;
            ctx.globalAlpha = this.mapTime > it.time ? Math.max(0, 1 - (this.mapTime - it.time) / 150) : 1;
            ctx.fillStyle = COLORS[it.kind] || COLORS.fruit;
            ctx.beginPath();
            ctx.arc(px, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        const catcherX = toPx(this.catcherXAt(this.mapTime));
        const cw = (this.catcherWidth / PLAYFIELD_X) * w;
        const ch = 18;
        ctx.fillStyle = '#e2e2f0';
        ctx.beginPath();
        ctx.moveTo(catcherX - cw / 2, catchLineY + ch / 2);
        ctx.lineTo(catcherX - cw / 3, catchLineY - ch / 2);
        ctx.lineTo(catcherX + cw / 3, catchLineY - ch / 2);
        ctx.lineTo(catcherX + cw / 2, catchLineY + ch / 2);
        ctx.closePath();
        ctx.fill();
    }

    tick(wallNow) {
        if (this.playing) {
            const dt = wallNow - this.lastWall;
            this.mapTime += dt * this.speed * this.clockRate;
            if (this.mapTime >= this.maxTime) {
                this.mapTime = this.maxTime;
                this.playing = false;
            }
        }
        this.lastWall = wallNow;
        this.draw();
        this.onTick(this.mapTime, this.minTime, this.maxTime, this.playing);
        this.rafId = requestAnimationFrame(t => this.tick(t));
    }

    start() { this.lastWall = performance.now(); this.rafId = requestAnimationFrame(t => this.tick(t)); }
    stop() { if (this.rafId) cancelAnimationFrame(this.rafId); }
    play() { if (this.mapTime >= this.maxTime) this.mapTime = this.minTime; this.playing = true; }
    pause() { this.playing = false; }
    seek(t) { this.mapTime = Math.min(this.maxTime, Math.max(this.minTime, t)); this.draw(); }
}

function playerHtml() {
    return `
        <div class="card replay-card" style="max-width:720px;margin:24px auto;padding:20px">
            <canvas id="replay-canvas" class="replay-canvas" width="640" height="420"></canvas>
            <div class="replay-controls">
                <button type="button" id="replay-playpause" class="pill toggle">▶</button>
                <input type="range" id="replay-scrub" class="replay-scrub" min="0" max="1000" value="0">
                <select id="replay-speed">
                    <option value="0.5">0.5x</option>
                    <option value="1" selected>1x</option>
                    <option value="2">2x</option>
                </select>
            </div>
            <p class="coverage-note" style="margin-top:10px">
                這是依據回放資料與圖譜物件重建的簡化動畫，非官方畫面；接到/落空僅為視覺估算，非官方判定。
            </p>
        </div>
    `;
}

async function run() {
    const params = new URLSearchParams(location.search);
    const scoreId = params.get('score_id');
    const beatmapId = params.get('beatmap_id');
    const mods = (params.get('mods') || '').split(',').filter(Boolean);

    if (!scoreId || !beatmapId) {
        setStatus(errorHtml(t('replay_not_found')));
        return;
    }
    if (!getCtLoggedInUser()) {
        setStatus(loginGateHtml());
        return;
    }

    setStatus(errorHtml(t('replay_loading')));

    try {
        const [osuText, replayBuffer] = await Promise.all([
            fetchBeatmapFile(beatmapId),
            fetchReplayBytes(scoreId),
        ]);

        const { BeatmapDecoder, ScoreDecoder } = await import(PARSERS_URL);
        const catchStable = await import(CATCH_STABLE_URL);
        const { CatchRuleset, CatchReplayConverter, Fruit, Banana, JuiceDroplet, JuiceTinyDroplet } = catchStable;

        const ruleset = new CatchRuleset();
        const parsedBeatmap = new BeatmapDecoder().decodeFromString(osuText);
        const catchBeatmap = ruleset.applyToBeatmap(parsedBeatmap);
        const cs = (catchBeatmap.difficulty && catchBeatmap.difficulty.circleSize)
            ?? (parsedBeatmap.difficulty && parsedBeatmap.difficulty.circleSize) ?? 5;

        let items = flattenHitObjects(catchBeatmap.hitObjects, { Fruit, Banana, JuiceDroplet, JuiceTinyDroplet });
        items = applyHrMirror(items, mods);

        const parsedScore = await new ScoreDecoder().decodeFromBuffer(new Uint8Array(replayBuffer));
        console.log('[replay] parsed score (first look at real data — verify field names here):', parsedScore);

        let frames = [];
        try {
            const converter = new CatchReplayConverter(catchBeatmap);
            const convertedReplay = converter.convertReplay(parsedScore.replay, { mods });
            const rawFrames = convertedReplay.frames || convertedReplay.replay?.frames || convertedReplay;
            if (Array.isArray(rawFrames) && rawFrames.length) {
                console.log('[replay] first converted frame (verify getFrameX() matches this shape):', rawFrames[0]);
            }
            frames = (Array.isArray(rawFrames) ? rawFrames : [])
                .map(f => ({ time: f.startTime, x: getFrameX(f) }))
                .filter(f => typeof f.time === 'number' && f.x !== null)
                .sort((a, b) => a.time - b.time);
        } catch (convErr) {
            console.warn('[replay] replay frame conversion failed — catcher will render static (unverified pipeline, see file header):', convErr);
        }

        if (!items.length) {
            setStatus(errorHtml(t('replay_not_found')));
            return;
        }

        setStatus(playerHtml());
        const canvas = document.getElementById('replay-canvas');
        const playBtn = document.getElementById('replay-playpause');
        const scrub = document.getElementById('replay-scrub');
        const speedSel = document.getElementById('replay-speed');

        const player = new ReplayPlayer(canvas, items, frames, {
            clockRate: clockRateForMods(mods),
            catcherWidth: catcherWidthFor(cs),
            onTick: (mapTime, minTime, maxTime, playing) => {
                const pct = maxTime > minTime ? ((mapTime - minTime) / (maxTime - minTime)) * 1000 : 0;
                scrub.value = String(pct);
                playBtn.textContent = playing ? '⏸' : '▶';
            },
        });

        playBtn.addEventListener('click', () => {
            if (player.playing) player.pause(); else player.play();
        });
        scrub.addEventListener('input', () => {
            player.pause();
            const frac = Number(scrub.value) / 1000;
            player.seek(player.minTime + frac * (player.maxTime - player.minTime));
        });
        speedSel.addEventListener('change', () => { player.speed = Number(speedSel.value); });

        player.start();
    } catch (err) {
        console.error('[replay] failed:', err);
        setStatus(errorHtml(err.message));
    }
}

run();
