/* ===== Replay (.osr) analyzer =====
   Client uploads a .osr file (base64 JSON body, same convention as
   skins-upload.js); this parses it entirely server-side and returns a score
   summary plus an *approximate* hit-timing chart — no video is rendered and
   no third-party render service is involved, unlike the o!rdr-based Replay
   錄影 tab that was removed (see that commit message: rendered videos there
   expired and weren't worth hosting permanently ourselves). This only ever
   reads the file the visitor uploaded and returns numbers/text about it.

   Parsing uses osu-parsers (kionell/osu-parsers, based on the lazer source):
   - ScoreDecoder reads the .osr header (player, mods, accuracy, hit counts,
     beatmap MD5) and, when present, the LZMA-compressed replay frames.
   - The beatmap itself is looked up from its MD5 via osu! API's
     /beatmaps/lookup (the only thing a .osr tells you about which beatmap
     it's for), then re-fetched as a raw .osu file the same way osu-pp.js
     does, decoded with BeatmapDecoder for hit object timings, and fed to
     rosu-pp-js (same engine as osu-pp.js/_farm-crawl-core.js) to recompute
     stars/PP for this exact play's mods+accuracy+combo+misses.

   Hit-timing chart is a deliberately simplified heuristic, not a full
   judgement replica (that would mean reimplementing hit-circle collision,
   slider ticks, spinner rotation, etc. — a whole gameplay engine): for each
   osu!std hit circle/slider head, it finds the nearest not-yet-used
   *keypress* (button-state rising edge) within a fixed window and reports
   the time delta. No cursor-position/hit-radius check is performed, so a
   press near a note counts even if the cursor wasn't on it — good enough
   for an "am I early/late" timing trend, not a substitute for the game's
   own judgement. Replay frame times run on the replay's own clock (real
   elapsed time during the recorded play), so they're divided by the mods'
   clock rate (1.5x for DT/NC, 0.75x for HT) to line back up with the
   beatmap's original, unscaled hit object times. Only osu!std (rulesetId 0)
   is supported — taiko/catch/mania judge hits too differently for this same
   keypress-matching approach to mean anything.

   The same pass (computeReplayAnalysis) also buckets every cursor position
   into a fixed-resolution grid over osu!std's 512x384 playfield, for the
   client to render as a blurred heatmap over the beatmap's cover art, and
   records an approximate cursor position (nearest cursor frame in time) for
   every note the keypress matcher couldn't pair — the client shows these as
   miss markers on the same overlay. */
const rosu = require('rosu-pp-js');
const { ScoreDecoder, BeatmapDecoder } = require('osu-parsers');
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_REPLAY_BYTES = 3 * 1024 * 1024;
const HIT_MATCH_WINDOW_MS = 200;
const MAX_MATCH_OPS = 5_000_000; // circles * candidate presses, safety bound on the O(n*m) matcher below

// osu!std's playfield is a fixed 512x384 osu!pixels regardless of the
// player's actual screen resolution (the game itself letterboxes/scales to
// it), so a density grid over that fixed box lines up with any replay.
// 96x72 keeps the same 4:3 aspect at a resolution fine enough for a
// legible heatmap once blurred client-side, while keeping the flattened
// grid small enough (6,912 numbers) to ship as plain JSON.
const PLAYFIELD_W = 512, PLAYFIELD_H = 384;
const GRID_W = 96, GRID_H = 72;

// Classic (stable) replay mod bitflags — the .osr header stores mods this
// way regardless of ruleset. NC's bit already implies DT's, and PF's bit
// already implies SD's, so those pairs are deduped rather than shown twice.
const MOD_BITS = [
    [2, 'EZ'], [1, 'NF'], [256, 'HT'], [8, 'HD'], [16, 'HR'], [64, 'DT'], [512, 'NC'],
    [1024, 'FL'], [32, 'SD'], [16384, 'PF'], [4, 'TD'],
    [4096, 'SO'], [128, 'RX'], [8192, 'AP'], [1073741824, 'MR'],
];
function modsToAcronyms(raw) {
    if (!raw) return [];
    const hasNC = (raw & 512) !== 0;
    const hasPF = (raw & 16384) !== 0;
    const out = [];
    for (const [bit, name] of MOD_BITS) {
        if (!(raw & bit)) continue;
        if (name === 'DT' && hasNC) continue;
        if (name === 'SD' && hasPF) continue;
        out.push(name);
    }
    return out;
}
function clockRateFor(raw) {
    if (raw & 64 || raw & 512) return 1.5; // DT or NC
    if (raw & 256) return 0.75; // HT
    return 1;
}

// Binary search for the cursor frame whose timestamp is closest to `t`
// (cursorFrames is chronological, same order the replay records them in) —
// used to approximate where the cursor was sitting at a missed note's
// expected hit time, since the keypress-matching pass below only tells us
// *that* no press paired with it, not *where* the cursor was.
function nearestCursorFrame(cursorFrames, t) {
    let lo = 0, hi = cursorFrames.length - 1;
    if (t <= cursorFrames[0].t) return cursorFrames[0];
    if (t >= cursorFrames[hi].t) return cursorFrames[hi];
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cursorFrames[mid].t < t) lo = mid + 1; else hi = mid;
    }
    const a = cursorFrames[Math.max(0, lo - 1)], b = cursorFrames[lo];
    return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

/* One pass over the replay's frames builds three things at once: the same
   hit-timing deltas computeHitErrors used to compute (kept as its own
   heuristic, see the file header comment), a density grid of every cursor
   position for the heatmap, and — for notes the keypress matcher couldn't
   pair with a press — an approximate miss location from the nearest cursor
   frame in time. Returns null fields where there isn't enough data rather
   than throwing, same as the original always did for hitErrors alone. */
function computeReplayAnalysis(beatmap, replay, clockRate) {
    const circles = (beatmap.hitObjects || [])
        .filter(o => (o.hitType & 1) !== 0 || (o.hitType & 2) !== 0) // Normal or Slider (head only)
        .map(o => o.startTime)
        .sort((a, b) => a - b);

    const cursorFrames = [];
    const grid = new Array(GRID_W * GRID_H).fill(0);
    const presses = [];
    let wasPressed = false;
    for (const f of replay.frames || []) {
        if (!Number.isFinite(f.startTime)) continue;
        const t = f.startTime / clockRate;
        const pos = f.position;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            cursorFrames.push({ t, x: pos.x, y: pos.y });
            const gx = Math.min(GRID_W - 1, Math.max(0, Math.floor(pos.x / PLAYFIELD_W * GRID_W)));
            const gy = Math.min(GRID_H - 1, Math.max(0, Math.floor(pos.y / PLAYFIELD_H * GRID_H)));
            grid[gy * GRID_W + gx]++;
        }
        const isPressed = (f.buttonState || 0) !== 0;
        if (isPressed && !wasPressed) presses.push(t);
        wasPressed = isPressed;
    }

    const cursorHeatmap = cursorFrames.length ? { w: GRID_W, h: GRID_H, grid } : null;
    if (!circles.length || !presses.length || circles.length * presses.length > MAX_MATCH_OPS) {
        return { hitErrors: null, missPositions: [], cursorHeatmap };
    }

    const used = new Array(presses.length).fill(false);
    const errors = [];
    const missPositions = [];
    for (const objTime of circles) {
        let bestIdx = -1, bestDelta = Infinity;
        for (let i = 0; i < presses.length; i++) {
            if (used[i]) continue;
            const delta = presses[i] - objTime;
            if (Math.abs(delta) > HIT_MATCH_WINDOW_MS) continue;
            if (Math.abs(delta) < Math.abs(bestDelta)) { bestDelta = delta; bestIdx = i; }
        }
        if (bestIdx >= 0) {
            used[bestIdx] = true;
            errors.push(Math.round(bestDelta));
        } else if (cursorFrames.length) {
            const near = nearestCursorFrame(cursorFrames, objTime);
            missPositions.push({ x: Math.round(near.x), y: Math.round(near.y) });
        }
    }
    return { hitErrors: errors, missPositions, cursorHeatmap };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    if (!event.body || Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
        return { statusCode: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Request too large' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    if (!dataBase64) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing file data' }) };
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, 'base64');
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid file data' }) };
    }
    if (buffer.length === 0 || buffer.length > MAX_REPLAY_BYTES) {
        return { statusCode: 413, headers: CORS_HEADERS, body: JSON.stringify({ error: `Replay exceeds the ${MAX_REPLAY_BYTES / 1024 / 1024}MB limit` }) };
    }

    try {
        const decoder = new ScoreDecoder();
        const score = await decoder.decodeFromBuffer(buffer, true);
        const info = score.info;

        // The legacy .osr binary format has no magic number/signature, so
        // the underlying reader happily "succeeds" on non-replay input by
        // reading garbage byte sequences as if they were valid fields
        // (confirmed against a junk file locally: it came back with
        // rulesetId 110 and an empty beatmap hash instead of throwing) —
        // these two fields are cheap, reliable tells that the parse
        // produced nonsense, checked before doing any further work.
        if (!Number.isInteger(info.rulesetId) || info.rulesetId < 0 || info.rulesetId > 3 || !/^[a-f0-9]{32}$/i.test(info.beatmapHashMD5 || '')) {
            return { statusCode: 422, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Not a valid .osr replay file' }) };
        }

        const rawMods = typeof info.rawMods === 'number' ? info.rawMods : 0;
        const mods = modsToAcronyms(rawMods);
        const clockRate = clockRateFor(rawMods);

        const token = await getOsuToken();
        const lookupRes = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/lookup?checksum=${encodeURIComponent(info.beatmapHashMD5)}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });

        // osu-parsers' ScoreInfo.accuracy is 0-1 (confirmed against real replay
        // fixtures); this site displays and calculates accuracy on a 0-100
        // scale everywhere else (see osu-pp.js's acc query param), so it's
        // converted once here rather than at every call site.
        const accuracyPct = info.accuracy * 100;

        const result = {
            player: info.username || null,
            mods,
            rank: info.passed ? info.rank : 'F',
            accuracy: accuracyPct,
            maxCombo: info.maxCombo,
            counts: {
                great: info.count300, ok: info.count100, meh: info.count50,
                miss: info.countMiss, perfect: info.countGeki, good: info.countKatu,
            },
            rulesetId: info.rulesetId,
            beatmap: null,
            hitErrors: null,
            missPositions: [],
            cursorHeatmap: null,
        };

        if (lookupRes.ok) {
            const beatmapInfo = await lookupRes.json();
            const osuRes = await fetch(`https://osu.ppy.sh/osu/${beatmapInfo.id}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu-collection-hanabi.netlify.app/)' },
            });
            const osuText = await osuRes.text();

            if (osuRes.ok && osuText) {
                const map = new rosu.Beatmap(osuText);
                const modsStr = mods.filter(m => m !== 'NF' && m !== 'SO').join('');
                const diffAttrs = new rosu.Difficulty({ mods: modsStr }).calculate(map);
                const perfOpts = { mods: modsStr, accuracy: accuracyPct, combo: Math.min(info.maxCombo, diffAttrs.maxCombo), misses: info.countMiss };
                const perf = new rosu.Performance(perfOpts).calculate(diffAttrs);

                result.beatmap = {
                    id: beatmapInfo.id,
                    beatmapsetId: beatmapInfo.beatmapset ? beatmapInfo.beatmapset.id : null,
                    title: beatmapInfo.beatmapset ? beatmapInfo.beatmapset.title : null,
                    artist: beatmapInfo.beatmapset ? beatmapInfo.beatmapset.artist : null,
                    version: beatmapInfo.version,
                    star: diffAttrs.stars,
                    pp: perf.pp,
                };

                if (info.rulesetId === 0 && score.replay) {
                    try {
                        const beatmapDecoder = new BeatmapDecoder();
                        const parsedBeatmap = beatmapDecoder.decodeFromString(osuText, false);
                        const analysis = computeReplayAnalysis(parsedBeatmap, score.replay, clockRate);
                        result.hitErrors = analysis.hitErrors;
                        result.missPositions = analysis.missPositions;
                        result.cursorHeatmap = analysis.cursorHeatmap;
                    } catch (err) {
                        result.hitErrors = null;
                    }
                }
            }
        }

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message || 'Failed to parse replay' }) };
    }
};
