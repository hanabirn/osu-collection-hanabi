/* Extra numbers for one osu! API score, worked out with rosu-pp from the
   beatmap file: pp (for scores the API leaves without pp: fails, loved,
   unranked), pp if it had been a full combo, pp if a failed play had been
   passed, how far a failed play got, and the map's CS / AR / OD / HP / BPM /
   length with the score's mods. Used by the Discord bot's single-score
   embeds (/recent, /rs, /top index).

   Reads both the legacy score format (statistics.count_300...) and the
   lazer one (statistics.great...). Stable scoring, like replay-pp.js. */
const rosu = require('rosu-pp-js');

const MODE_INT = { osu: 0, taiko: 1, fruits: 2, mania: 3 };
const UA = 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu.hanabirn.xyz/)';

async function fetchOsuFile(beatmapId) {
    const res = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const text = await res.text();
    return text && text.includes('[HitObjects]') ? text : null;
}

// -> { nGeki, n300, nKatu, n100, n50, misses } in rosu's terms for `mode`.
function hitCounts(score, mode) {
    const s = score.statistics || {};
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    if ('count_300' in s || 'count_miss' in s) {
        return { nGeki: n(s.count_geki), n300: n(s.count_300), nKatu: n(s.count_katu), n100: n(s.count_100), n50: n(s.count_50), misses: n(s.count_miss) };
    }
    if (mode === MODE_INT.fruits) {
        return { nGeki: 0, n300: n(s.great), nKatu: n(s.small_tick_miss), n100: n(s.large_tick_hit), n50: n(s.small_tick_hit), misses: n(s.miss) + n(s.large_tick_miss) };
    }
    return { nGeki: n(s.perfect), n300: n(s.great), nKatu: n(s.good), n100: n(s.ok), n50: n(s.meh), misses: n(s.miss) };
}

// The hit counts to show, per ruleset, as [label, value] pairs.
function hitLine(score, apiMode) {
    const c = hitCounts(score, MODE_INT[apiMode] ?? 0);
    if (apiMode === 'mania') return [['MAX', c.nGeki], ['300', c.n300], ['200', c.nKatu], ['100', c.n100], ['50', c.n50], ['miss', c.misses]];
    if (apiMode === 'taiko') return [['300', c.n300], ['100', c.n100], ['miss', c.misses]];
    if (apiMode === 'fruits') return [['300', c.n300], ['100', c.n100], ['50', c.n50], ['miss', c.misses]];
    return [['300', c.n300], ['100', c.n100], ['50', c.n50], ['miss', c.misses]];
}

const modsString = (list) => list.filter((m) => m !== 'CL').join('');

/* score: an osu! API v2 score. apiMode: the ruleset it was set in.
   modList: its mods as acronyms. Returns null when the map file can't be
   had; never throws. */
async function scoreExtras(score, apiMode, modList) {
    const bm = score.beatmap || {};
    if (!bm.id) return null;
    let text;
    try { text = await fetchOsuFile(bm.id); } catch { text = null; }
    if (!text) return null;

    const mode = MODE_INT[apiMode] ?? 0;
    const mods = modsString(modList);
    const toFree = [];
    const keep = (o) => { toFree.push(o); return o; };
    try {
        const map = keep(new rosu.Beatmap(text));
        if (map.mode !== mode) map.convert(mode, mods);
        const diff = keep(new rosu.Difficulty({ mods, lazer: false }).calculate(map));
        const perf = (args) => {
            const p = keep(new rosu.Performance({ mods, lazer: false, ...args }).calculate(diff));
            return p.pp;
        };
        const c = hitCounts(score, mode);
        const passed = score.passed !== false;

        // How many objects the play got through, and how many the map has,
        // in the units each ruleset judges.
        let judged; let total;
        if (mode === MODE_INT.mania) {
            judged = c.nGeki + c.n300 + c.nKatu + c.n100 + c.n50 + c.misses;
            total = map.nObjects;
        } else if (mode === MODE_INT.taiko) {
            judged = c.n300 + c.n100 + c.misses;
            total = diff.maxCombo;
        } else if (mode === MODE_INT.fruits) {
            judged = c.n300 + c.n100 + c.misses;
            total = (diff.nFruits || 0) + (diff.nDroplets || 0);
        } else {
            judged = c.n300 + c.n100 + c.n50 + c.misses;
            total = map.nObjects;
        }
        const progress = total > 0 ? Math.min(1, judged / total) : null;

        const combo = Number(score.max_combo) || 0;
        let pp = score.pp != null ? Number(score.pp) : null;
        let ppIfPassed = null;
        if (pp == null && passed) pp = perf({ ...c, combo });
        if (!passed) {
            // Same accuracy and misses over the whole map.
            ppIfPassed = perf({ accuracy: (Number(score.accuracy) || 0) * 100, misses: c.misses });
        }
        // Misses turned into the best judgement, the rest filled in by rosu
        // (best case), combo maxed.
        const fc = { ...c, misses: 0 };
        if (mode === MODE_INT.mania) fc.nGeki += c.misses; else fc.n300 += c.misses;
        const ppFc = perf({ ...fc, combo: diff.maxCombo });

        const ba = keep(new rosu.BeatmapAttributesBuilder({ map, mods, isConvert: map.isConvert }).build());
        const rate = ba.clockRate || 1;
        const baseBpm = Number(bm.bpm) || map.bpm || 0;
        const length = Number(bm.total_length) || 0;

        return {
            pp, ppFc, ppIfPassed, progress,
            stars: diff.stars,
            maxCombo: diff.maxCombo,
            cs: ba.cs, ar: ba.ar, od: ba.od, hp: ba.hp,
            keys: mode === MODE_INT.mania ? Math.round(map.cs) : null,
            bpm: baseBpm * rate,
            length: length / rate,
        };
    } catch (err) {
        console.error('scoreExtras failed', err && (err.stack || err));
        return null;
    } finally {
        for (const o of toFree) { try { o.free(); } catch { /* already freed */ } }
    }
}

module.exports = { scoreExtras, hitLine, hitCounts };
