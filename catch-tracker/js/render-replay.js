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

   Also verified: full-song audio (mirror.hinamizawa.ai) and client-side
   .osk skin sprites (fflate) both work — see the git history for that pass.

   This pass adds a catch-NATIVE stat panel (combo/accuracy/caught/miss/HP)
   instead of copying mania-tracker's MAX/300/200/100/50/MISS/UR columns —
   those are timing-judgement terms that don't exist in catch (catch is a
   purely positional catch-or-miss result). Judgement is a simple
   position-at-catch-time check against the catcher — see computeJudgements()
   — labeled everywhere as a simulation/estimate, not an official verdict.

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

// Judgement-simulation tuning — all approximations, see file header.
const CATCH_LENIENCY = 10; // osu!pixels, roughly matches catch's small edge-catch allowance
const HP_GAIN = 0.5;
const HP_LOSS = 4;
const POPUP_DURATION_MS = 600;
const SETTINGS_KEY = 'ct_replay_settings';
const DEFAULT_SETTINGS = { blur: 0, brightness: 100, popups: true, bananaRain: false };

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
        caught: false,
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

// Interpolated catcher X at time t — a plain function (not a class method)
// so computeJudgements() can use it before a ReplayPlayer exists yet;
// ReplayPlayer.catcherXAt() below just delegates to this.
function catcherXAt(frames, t) {
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

// One-time pass: was the catcher under each object at the moment it
// reached the catch line? A positional approximation of the real hitbox
// (real osu!catch's catcher plate is trapezoidal and hyperdash extends the
// catchable range) — see file header for the full honesty caveat.
function computeJudgements(items, frames, catcherWidth) {
    const halfWidth = catcherWidth / 2 + CATCH_LENIENCY;
    for (const it of items) {
        it.caught = Math.abs(catcherXAt(frames, it.time) - it.x) <= halfWidth;
    }
    return items;
}

// Pure function of mapTime — recomputed from scratch each call rather than
// tracked incrementally, so it stays correct across seeks/scrubbing without
// separate forward/backward bookkeeping. items.length is at most a few
// thousand, so a full scan per call (even at 60fps) is not worth optimizing
// away for v1. tiny droplets don't affect combo/HP in real catch, so
// they're excluded here the same way.
function computeStats(items, mapTime) {
    let combo = 0, maxCombo = 0, caught = 0, miss = 0, hp = 100;
    for (const it of items) {
        if (it.time > mapTime) break; // items are sorted by time
        if (it.kind === 'tiny') continue;
        if (it.caught) {
            combo++;
            caught++;
            hp = Math.min(100, hp + HP_GAIN);
        } else {
            combo = 0;
            miss++;
            hp = Math.max(0, hp - HP_LOSS);
        }
        if (combo > maxCombo) maxCombo = combo;
    }
    const total = caught + miss;
    return { combo, maxCombo, caught, miss, accuracy: total > 0 ? caught / total : 1, hp };
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* per-viewer convenience only */ }
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
        this.showPopups = true;
        this.popups = [];
        this.lastPoppedTime = null;
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
            // The audio mirror sometimes only has a ~10s PREVIEW cached
            // for a given beatmapset rather than the full track (falls
            // back silently server-side) — if the track ends well before
            // the map itself does, hand playback back to the manual clock
            // instead of stopping the visual replay early.
            this.audio.addEventListener('ended', () => {
                if (this.mapTime < this.maxTime - 250) {
                    this.audioReady = false;
                    this.lastWall = performance.now();
                } else {
                    this.playing = false;
                }
            });
        }
    }

    setSprites(sprites) { this.sprites = sprites || {}; }
    setVisualSettings(s) {
        this.canvas.style.filter = `blur(${s.blur}px) brightness(${s.brightness}%)`;
        this.showPopups = s.popups;
    }

    catcherXAt(t) { return catcherXAt(this.frames, t); }

    currentStats() { return computeStats(this.items, this.mapTime); }

    // Spawns judgement popups for items whose time falls within the range
    // just crossed since the last call. Skipped entirely on a large jump
    // (a seek/scrub) so dragging the scrub bar doesn't dump hundreds of
    // popups on screen at once.
    updatePopups(prevTime) {
        if (this.lastPoppedTime === null) { this.lastPoppedTime = prevTime; }
        const jumped = Math.abs(prevTime - this.lastPoppedTime) > 50 || this.mapTime < this.lastPoppedTime;
        if (this.showPopups && !jumped && this.mapTime > this.lastPoppedTime) {
            for (const it of this.items) {
                if (it.kind === 'tiny') continue;
                if (it.time > this.lastPoppedTime && it.time <= this.mapTime) {
                    this.popups.push({ time: it.time, x: it.x, caught: it.caught });
                }
            }
        }
        this.lastPoppedTime = this.mapTime;
        if (this.popups.length) {
            this.popups = this.popups.filter(p => this.mapTime - p.time < POPUP_DURATION_MS);
        }
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

        if (this.showPopups) {
            for (const p of this.popups) {
                const age = this.mapTime - p.time;
                if (age < 0 || age > POPUP_DURATION_MS) continue;
                const alpha = 1 - age / POPUP_DURATION_MS;
                const py = catchLineY - 20 - age * 0.06;
                ctx.globalAlpha = Math.max(0, alpha);
                ctx.fillStyle = p.caught ? '#4ade80' : '#f87171';
                ctx.font = '700 13px "Chakra Petch", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(p.caught ? t('replay_stat_caught') : t('replay_stat_miss'), toPx(p.x), py);
            }
            ctx.globalAlpha = 1;
            ctx.textAlign = 'start';
        }
    }

    tick(wallNow) {
        const prevTime = this.mapTime;
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
        this.updatePopups(prevTime);
        this.draw();
        this.onTick(this.mapTime, this.minTime, this.maxTime, this.playing, this.currentStats());
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
        this.lastPoppedTime = this.mapTime;
        this.popups = [];
        this.draw();
        this.onTick(this.mapTime, this.minTime, this.maxTime, this.playing, this.currentStats());
    }

    setSpeed(speed) {
        this.speed = speed;
        if (this.audioReady) this.audio.playbackRate = this.speed * this.clockRate;
    }
}

function infoPanelHtml(meta) {
    const title = [meta.artist, meta.title].filter(Boolean).join(' - ');
    return `
        <aside class="replay-side-panel card">
            <h2 style="margin-top:0;font-size:1rem">${escapeHtml(title || t('replay_loading'))}</h2>
            ${meta.version ? `<p class="coverage-note" style="margin:0 0 10px">[${escapeHtml(meta.version)}]</p>` : ''}
            ${meta.username ? `<p style="margin:0 0 8px">${escapeHtml(t('replay_info_by', { name: meta.username }))}</p>` : ''}
            <div class="replay-info-tags">
                ${meta.rank ? gradeBadge(meta.rank) : ''}
                ${meta.mods.length ? modsTag(meta.mods) : ''}
            </div>
        </aside>
    `;
}

function statsPanelHtml() {
    return `
        <aside class="replay-side-panel card replay-stats-panel">
            <div class="replay-hp-bar"><div class="replay-hp-fill" id="replay-hp-fill"></div></div>
            <div class="replay-stat-row"><span>${escapeHtml(t('replay_stat_combo'))}</span><strong id="replay-stat-combo">0</strong></div>
            <div class="replay-stat-row"><span>${escapeHtml(t('replay_stat_maxcombo'))}</span><strong id="replay-stat-maxcombo">0</strong></div>
            <div class="replay-stat-row"><span>${escapeHtml(t('replay_stat_accuracy'))}</span><strong id="replay-stat-accuracy">100%</strong></div>
            <div class="replay-stat-row"><span>${escapeHtml(t('replay_stat_caught'))}</span><strong id="replay-stat-caught">0</strong></div>
            <div class="replay-stat-row"><span>${escapeHtml(t('replay_stat_miss'))}</span><strong id="replay-stat-miss">0</strong></div>
        </aside>
    `;
}

function settingsPanelHtml(s) {
    return `
        <details class="replay-settings">
            <summary class="pill">${escapeHtml(t('replay_settings'))}</summary>
            <div class="replay-settings-body">
                <label>${escapeHtml(t('replay_settings_blur'))}
                    <input type="range" id="replay-set-blur" min="0" max="8" step="0.5" value="${s.blur}">
                </label>
                <label>${escapeHtml(t('replay_settings_brightness'))}
                    <input type="range" id="replay-set-brightness" min="40" max="140" step="5" value="${s.brightness}">
                </label>
                <label><input type="checkbox" id="replay-set-popups" ${s.popups ? 'checked' : ''}> ${escapeHtml(t('replay_settings_judgements'))}</label>
                <label><input type="checkbox" id="replay-set-banana" ${s.bananaRain ? 'checked' : ''}> ${escapeHtml(t('replay_settings_banana_rain'))}</label>
            </div>
        </details>
    `;
}

function playerHtml(meta, settings) {
    return `
        <div class="replay-layout">
            ${infoPanelHtml(meta)}
            <div class="replay-main-col">
                <div class="card replay-card">
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
                        <span id="replay-skin-status" class="replay-skin-status"></span>
                    </div>
                    ${settingsPanelHtml(settings)}
                    <p class="coverage-note" style="margin-top:10px">${escapeHtml(t('replay_disclaimer'))}</p>
                </div>
            </div>
            ${statsPanelHtml()}
        </div>
    `;
}

async function run() {
    const params = new URLSearchParams(location.search);
    const scoreId = params.get('score_id');
    const beatmapId = params.get('beatmap_id');
    const beatmapsetId = params.get('beatmapset_id');
    const mods = (params.get('mods') || '').split(',').filter(Boolean);
    const meta = {
        title: params.get('title') || '',
        artist: params.get('artist') || '',
        version: params.get('version') || '',
        username: params.get('username') || '',
        rank: params.get('rank') || '',
        mods,
    };

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

        const catcherWidth = catcherWidthFor(cs);
        computeJudgements(items, frames, catcherWidth);

        const settings = loadSettings();
        setStatus(playerHtml(meta, settings));
        const canvas = document.getElementById('replay-canvas');
        const audioEl = document.getElementById('replay-audio');
        const playBtn = document.getElementById('replay-playpause');
        const scrub = document.getElementById('replay-scrub');
        const speedSel = document.getElementById('replay-speed');
        const skinInput = document.getElementById('replay-skin-input');
        const skinClearBtn = document.getElementById('replay-skin-clear');
        const skinStatus = document.getElementById('replay-skin-status');
        const hpFill = document.getElementById('replay-hp-fill');
        const statCombo = document.getElementById('replay-stat-combo');
        const statMaxCombo = document.getElementById('replay-stat-maxcombo');
        const statAccuracy = document.getElementById('replay-stat-accuracy');
        const statCaught = document.getElementById('replay-stat-caught');
        const statMiss = document.getElementById('replay-stat-miss');

        // Full song audio is best-effort only — a missing beatmapset_id
        // (older links) or a failed load must never block the visual
        // replay, so no error is surfaced to the user either way. Setting
        // .src on a <audio> that was just injected via innerHTML doesn't
        // reliably auto-start loading in every browser — call load()
        // explicitly rather than relying on preload="auto" alone.
        if (beatmapsetId) {
            audioEl.src = AUDIO_URL(beatmapsetId);
            audioEl.load();
        }

        const player = new ReplayPlayer(canvas, items, frames, {
            clockRate: clockRateForMods(mods),
            catcherWidth,
            audio: beatmapsetId ? audioEl : null,
            onTick: (mapTime, minTime, maxTime, playing, stats) => {
                const pct = maxTime > minTime ? ((mapTime - minTime) / (maxTime - minTime)) * 1000 : 0;
                scrub.value = String(pct);
                playBtn.textContent = playing ? '⏸' : '▶';
                hpFill.style.width = `${stats.hp}%`;
                statCombo.textContent = stats.combo;
                statMaxCombo.textContent = stats.maxCombo;
                statAccuracy.textContent = `${(stats.accuracy * 100).toFixed(1)}%`;
                statCaught.textContent = stats.caught;
                statMiss.textContent = stats.miss;
            },
        });
        player.setVisualSettings(settings);
        document.body.classList.toggle('show-banana-rain', settings.bananaRain);

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

        const blurInput = document.getElementById('replay-set-blur');
        const brightnessInput = document.getElementById('replay-set-brightness');
        const popupsInput = document.getElementById('replay-set-popups');
        const bananaInput = document.getElementById('replay-set-banana');
        const onSettingsChange = () => {
            settings.blur = Number(blurInput.value);
            settings.brightness = Number(brightnessInput.value);
            settings.popups = popupsInput.checked;
            settings.bananaRain = bananaInput.checked;
            player.setVisualSettings(settings);
            document.body.classList.toggle('show-banana-rain', settings.bananaRain);
            saveSettings(settings);
        };
        [blurInput, brightnessInput, popupsInput, bananaInput].forEach(el => {
            el.addEventListener('input', onSettingsChange);
        });

        player.start();
    } catch (err) {
        console.error('[replay] failed:', err);
        setStatus(errorHtml(err.message));
    }
}

run();
