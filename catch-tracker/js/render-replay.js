/* Watch Replay — canvas playback.

   Verified live against a real replay: has_replay/download only lights up
   for scores that are notable enough on their beatmap for osu! to retain
   the replay server-side (confirmed by comparing a top mania player, whose
   profile shows a real 重播被觀看的次數/replay-watch-count stat and a
   distinct download icon on score rows, against catch players — including
   the #1 global catch player's own personal-best list — where that icon
   and stat are absent). A #1-world-rank catch score (Story — "Double
   Helix" [Polymerized Nucleotide], score 6141982961) DID have one, and the
   full pipeline was confirmed end-to-end against it: download → 106KB real
   .osr → BeatmapDecoder/ScoreDecoder → CatchRuleset/CatchReplayConverter
   (26239 replay frames in, 26239 out, no errors) → this canvas renderer,
   rendering a correct falling-fruit cascade with the catcher tracking real
   positions. getObjectX()/getFrameX()'s candidate field names were correct
   on the first try — no fixes needed after this test.

   Loaded as a <script type="module"> — this site has no CSP (unlike the
   main site, whose CSP blocks CDN libs), so esm.sh imports work directly,
   no build step needed. common.js/api.js are loaded first as classic
   scripts and expose their top-level functions as globals. */

const PARSERS_URL = 'https://esm.sh/osu-parsers@4.1.7';
const CATCH_STABLE_URL = 'https://esm.sh/osu-catch-stable@4.0.1';
const FFLATE_URL = 'https://esm.sh/fflate@0.8.2';
const PLAYFIELD_X = 512; // osu! catch coordinate space width, in osu!pixels

// Same mirror this project already trusts for bulk beatmap downloads (see
// the main site's js/osu.js downloadBeatmapset()) — this is its separate,
// dedicated, no-auth, CORS-open Music API, built to drop straight into an
// <audio> element (supports HTTP Range for scrubbing).
const AUDIO_URL = beatmapsetId => `https://mirror.hinamizawa.ai/v3/osu/music/audio/${beatmapsetId}`;

// osu!catch skin element filenames (per osu!'s own skinning wiki) — the
// four fruit "visual types" cycle by combo index in real gameplay, not by
// hit-object identity, so getFruitType() below falls back to a simple
// index-based cycle when the decoded hit object doesn't expose its own
// visual-type field.
const SKIN_FILES = {
    catcher: 'fruit-catcher-idle',
    banana: 'fruit-bananas',
    droplet: 'fruit-drop',
    fruit_apple: 'fruit-apple',
    fruit_grapes: 'fruit-grapes',
    fruit_orange: 'fruit-orange',
    fruit_pear: 'fruit-pear',
};
const FRUIT_TYPE_CYCLE = ['apple', 'grapes', 'orange', 'pear'];

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

/* ---------- data-shape helpers ----------
   Both confirmed correct on a real replay (see file header) — kept as a
   candidate list rather than collapsed to a single property access since
   it costs nothing and hedges against a future osu-catch-stable/osu-
   parsers version renaming a field. */

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

// Real catch skins draw one of 4 fruit sprites (apple/grapes/orange/pear)
// per object, cycling by combo index rather than being tied to hit-object
// identity. Tries a couple of plausible field names osu-catch-stable might
// expose before falling back to a deterministic index-based cycle — same
// "candidate list, never a hard failure" approach as getObjectX/getFrameX.
function getFruitType(h, index) {
    const candidates = [h.visualRepresentation, h.VisualRepresentation, h.fruitVisualRepresentation];
    for (const c of candidates) if (typeof c === 'string') return c.toLowerCase();
    return FRUIT_TYPE_CYCLE[index % FRUIT_TYPE_CYCLE.length];
}

function buildDropItem(h, classes, index) {
    const x = getObjectX(h);
    const preempt = (typeof h.timePreempt === 'number' && h.timePreempt > 0) ? h.timePreempt : 800;
    const kind = classifyObject(h, classes);
    return {
        time: h.startTime, spawnTime: h.startTime - preempt, x, kind,
        fruitType: kind === 'fruit' ? getFruitType(h, index) : null,
    };
}

// Flattens juice-stream/banana-shower "holdable" objects into their
// individual falling pieces (nestedHitObjects), matching real catch
// gameplay — a JuiceStream is a container, not something the catcher
// catches directly.
function flattenHitObjects(hitObjects, classes) {
    const out = [];
    let i = 0;
    for (const h of hitObjects) {
        if (Array.isArray(h.nestedHitObjects) && h.nestedHitObjects.length) {
            for (const n of h.nestedHitObjects) out.push(buildDropItem(n, classes, i++));
        } else {
            out.push(buildDropItem(h, classes, i++));
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

/* ---------- skin import (opt-in, client-side only) ----------
   Mirrors the main site's js/skins.js extractSkinAssets() technique: unzip
   with a filter so only the handful of files this needs are decompressed,
   never the whole .osk. Nothing is uploaded anywhere — this stays in the
   visitor's own browser for the current page view (a deliberate v1
   simplification: no IndexedDB persistence across reloads yet, since
   re-picking the file is a single click and this avoids building out a
   whole cache-invalidation scheme for a nice-to-have). */
async function loadSkinSprites(file) {
    const { unzipSync } = await import(FFLATE_URL);
    const buf = new Uint8Array(await file.arrayBuffer());

    const wanted = new Set(Object.values(SKIN_FILES));
    const matchesWanted = name => {
        const base = name.split('/').pop().replace(/@2x/i, '').replace(/\.png$/i, '');
        return wanted.has(base.toLowerCase());
    };

    const unzipped = unzipSync(buf, { filter: f => !f.dir && matchesWanted(f.name) });

    // Prefer @2x (higher-res) over the plain file when a skin ships both.
    const byBase = {};
    for (const [name, bytes] of Object.entries(unzipped)) {
        const base = name.split('/').pop().replace(/@2x/i, '').replace(/\.png$/i, '').toLowerCase();
        const isHiRes = /@2x/i.test(name);
        if (!byBase[base] || (isHiRes && !byBase[base].isHiRes)) byBase[base] = { bytes, isHiRes };
    }

    const sprites = {};
    await Promise.all(Object.entries(SKIN_FILES).map(async ([key, base]) => {
        const entry = byBase[base];
        if (!entry) return;
        const blob = new Blob([entry.bytes], { type: 'image/png' });
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        try {
            await img.decode();
            sprites[key] = img;
        } catch {
            // A corrupt/unreadable sprite just means that one kind keeps
            // the procedural fallback — never blocks the rest of the skin.
        }
    }));
    return sprites;
}

/* ---------- canvas player ---------- */

class ReplayPlayer {
    constructor(canvas, items, frames, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.items = items;
        this.frames = frames;
        this.clockRate = opts.clockRate;
        this.catcherWidth = opts.catcherWidth;
        this.sprites = {};
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

        // Optional full-song audio (see AUDIO_URL) — driven purely as an
        // additional playback clock source when it loads successfully;
        // never required. audioReady flips true only once the browser
        // confirms it can actually play the track, and flips back false on
        // any error so tick() falls back to the manual RAF clock — a
        // missing/failed audio track must never block the visual replay.
        this.audio = opts.audio || null;
        this.audioReady = false;
        if (this.audio) {
            this.audio.addEventListener('canplay', () => {
                this.audioReady = true;
                // Playback may already have been started on the manual
                // clock before the audio finished loading — hand it the
                // baton mid-flight rather than waiting for the next
                // play() call.
                if (this.playing) {
                    this.audio.currentTime = Math.max(0, this.mapTime / 1000);
                    this.audio.playbackRate = this.speed * this.clockRate;
                    this.audio.play().catch(() => { this.audioReady = false; });
                }
            }, { once: true });
            this.audio.addEventListener('error', () => { this.audioReady = false; });
            this.audio.addEventListener('ended', () => { this.playing = false; });
        }
    }

    setSprites(sprites) { this.sprites = sprites || {}; }

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

            const spriteKey = it.kind === 'fruit' ? `fruit_${it.fruitType}` : it.kind === 'tiny' ? 'droplet' : it.kind;
            const sprite = this.sprites[spriteKey];
            if (sprite) {
                const d = size * 2.4;
                ctx.drawImage(sprite, px - d / 2, y - d / 2, d, d);
            } else {
                ctx.fillStyle = COLORS[it.kind] || COLORS.fruit;
                ctx.beginPath();
                ctx.arc(px, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        const catcherX = toPx(this.catcherXAt(this.mapTime));
        const cw = (this.catcherWidth / PLAYFIELD_X) * w;
        const ch = 18;
        const catcherSprite = this.sprites.catcher;
        if (catcherSprite) {
            const spriteH = cw * (catcherSprite.naturalHeight / catcherSprite.naturalWidth || 0.5);
            ctx.drawImage(catcherSprite, catcherX - cw / 2, catchLineY - spriteH / 2, cw, spriteH);
        } else {
            ctx.fillStyle = '#e2e2f0';
            ctx.beginPath();
            ctx.moveTo(catcherX - cw / 2, catchLineY + ch / 2);
            ctx.lineTo(catcherX - cw / 3, catchLineY - ch / 2);
            ctx.lineTo(catcherX + cw / 3, catchLineY - ch / 2);
            ctx.lineTo(catcherX + cw / 2, catchLineY + ch / 2);
            ctx.closePath();
            ctx.fill();
        }
    }

    tick(wallNow) {
        if (this.playing) {
            if (this.audioReady) {
                // Audio is the clock while it's available — tighter sync
                // than the manual RAF delta, and it's what actually makes
                // DT/HT (playbackRate) audible.
                this.mapTime = this.audio.currentTime * 1000;
            } else {
                const dt = wallNow - this.lastWall;
                this.mapTime += dt * this.speed * this.clockRate;
            }
            if (this.mapTime >= this.maxTime) {
                this.mapTime = this.maxTime;
                this.playing = false;
                if (this.audioReady) this.audio.pause();
            }
        }
        this.lastWall = wallNow;
        this.draw();
        this.onTick(this.mapTime, this.minTime, this.maxTime, this.playing);
        this.rafId = requestAnimationFrame(t => this.tick(t));
    }

    start() { this.lastWall = performance.now(); this.rafId = requestAnimationFrame(t => this.tick(t)); }
    stop() { if (this.rafId) cancelAnimationFrame(this.rafId); }

    play() {
        if (this.mapTime >= this.maxTime) this.mapTime = this.minTime;
        this.playing = true;
        if (this.audioReady) {
            this.audio.currentTime = Math.max(0, this.mapTime / 1000);
            this.audio.playbackRate = this.speed * this.clockRate;
            // Autoplay policies are a non-issue here (play() only ever
            // runs from a user click on the play button), but a rejected
            // promise must still never break the visual replay.
            this.audio.play().catch(() => { this.audioReady = false; });
        }
    }

    pause() {
        this.playing = false;
        if (this.audioReady) this.audio.pause();
    }

    seek(t) {
        this.mapTime = Math.min(this.maxTime, Math.max(this.minTime, t));
        if (this.audioReady) this.audio.currentTime = Math.max(0, this.mapTime / 1000);
        this.draw();
    }

    setSpeed(speed) {
        this.speed = speed;
        if (this.audioReady) this.audio.playbackRate = this.speed * this.clockRate;
    }
}

function playerHtml() {
    return `
        <div class="card replay-card" style="max-width:720px;margin:24px auto;padding:20px">
            <canvas id="replay-canvas" class="replay-canvas" width="640" height="420"></canvas>
            <audio id="replay-audio" preload="auto"></audio>
            <div class="replay-controls">
                <button type="button" id="replay-playpause" class="pill toggle">▶</button>
                <input type="range" id="replay-scrub" class="replay-scrub" min="0" max="1000" value="0">
                <select id="replay-speed">
                    <option value="0.5">0.5x</option>
                    <option value="1" selected>1x</option>
                    <option value="2">2x</option>
                </select>
            </div>
            <div class="replay-skin-row">
                <label class="pill" for="replay-skin-input" style="cursor:pointer">${escapeHtml(t('replay_use_skin'))}</label>
                <input type="file" id="replay-skin-input" accept=".osk" hidden>
                <button type="button" id="replay-skin-clear" class="pill" hidden>${escapeHtml(t('replay_clear_skin'))}</button>
                <span id="replay-skin-status" class="coverage-note"></span>
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
    const beatmapsetId = params.get('beatmapset_id');
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
        console.log('[replay] parsed score:', parsedScore);

        let frames = [];
        try {
            const converter = new CatchReplayConverter(catchBeatmap);
            const convertedReplay = converter.convertReplay(parsedScore.replay, { mods });
            const rawFrames = convertedReplay.frames || convertedReplay.replay?.frames || convertedReplay;
            if (Array.isArray(rawFrames) && rawFrames.length) {
                console.log('[replay] first converted frame:', rawFrames[0]);
            }
            frames = (Array.isArray(rawFrames) ? rawFrames : [])
                .map(f => ({ time: f.startTime, x: getFrameX(f) }))
                .filter(f => typeof f.time === 'number' && f.x !== null)
                .sort((a, b) => a.time - b.time);
        } catch (convErr) {
            console.warn('[replay] replay frame conversion failed — catcher will render static:', convErr);
        }

        if (!items.length) {
            setStatus(errorHtml(t('replay_not_found')));
            return;
        }

        setStatus(playerHtml());
        const canvas = document.getElementById('replay-canvas');
        const audioEl = document.getElementById('replay-audio');
        const playBtn = document.getElementById('replay-playpause');
        const scrub = document.getElementById('replay-scrub');
        const speedSel = document.getElementById('replay-speed');
        const skinInput = document.getElementById('replay-skin-input');
        const skinClearBtn = document.getElementById('replay-skin-clear');
        const skinStatus = document.getElementById('replay-skin-status');

        // Full song audio is best-effort only — a missing beatmapset_id
        // (older links) or a failed load must never block the visual
        // replay, so no error is surfaced to the user either way.
        if (beatmapsetId) audioEl.src = AUDIO_URL(beatmapsetId);

        const player = new ReplayPlayer(canvas, items, frames, {
            clockRate: clockRateForMods(mods),
            catcherWidth: catcherWidthFor(cs),
            audio: beatmapsetId ? audioEl : null,
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
        speedSel.addEventListener('change', () => { player.setSpeed(Number(speedSel.value)); });

        skinInput.addEventListener('change', async () => {
            const file = skinInput.files && skinInput.files[0];
            if (!file) return;
            skinStatus.textContent = t('replay_skin_loading');
            try {
                const sprites = await loadSkinSprites(file);
                player.setSprites(sprites);
                skinStatus.textContent = t('replay_skin_loaded', { n: Object.keys(sprites).length });
                skinClearBtn.hidden = false;
            } catch (skinErr) {
                console.warn('[replay] skin load failed:', skinErr);
                skinStatus.textContent = t('replay_skin_invalid');
            }
        });
        skinClearBtn.addEventListener('click', () => {
            player.setSprites({});
            skinInput.value = '';
            skinStatus.textContent = '';
            skinClearBtn.hidden = true;
        });

        player.start();
    } catch (err) {
        console.error('[replay] failed:', err);
        setStatus(errorHtml(err.message));
    }
}

run();
