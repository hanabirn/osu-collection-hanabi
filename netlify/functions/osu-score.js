/* One score by its osu! score id (API v2 GET /scores/{id}, or
   /scores/{ruleset}/{legacy id} with ?m=), reshaped into
   the v1 get_scores row that js/score-card.js already reads, plus the
   beatmap id and ruleset. Used by the card-only page (?scorecard=<id>),
   which the Discord bot screenshots: a score id fits in a button's
   custom_id, a whole score doesn't. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

/* v1 enabled_mods bits, for the acronyms the card decodes. */
const MOD_BITS = {
    NF: 1, EZ: 2, TD: 4, HD: 8, HR: 16, SD: 32, DT: 64, RX: 128, HT: 256, NC: 512 | 64,
    FL: 1024, SO: 4096, AP: 8192, PF: 16384 | 32,
};

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* Lazer statistics -> v1 count fields, per ruleset (0 osu, 1 taiko, 2 catch, 3 mania). */
function legacyCounts(st, mode) {
    const s = st || {};
    if (mode === 3) {
        return { countgeki: n(s.perfect), count300: n(s.great), countkatu: n(s.good), count100: n(s.ok), count50: n(s.meh), countmiss: n(s.miss) };
    }
    if (mode === 2) {
        // catch: fruits = great, drops = large ticks, droplets = small ticks;
        // a missed droplet is v1's countkatu.
        return { count300: n(s.great), count100: n(s.large_tick_hit), count50: n(s.small_tick_hit), countkatu: n(s.small_tick_miss), countmiss: n(s.miss) + n(s.large_tick_miss), countgeki: 0 };
    }
    if (mode === 1) {
        return { count300: n(s.great), count100: n(s.ok), count50: 0, countmiss: n(s.miss), countgeki: 0, countkatu: 0 };
    }
    return { count300: n(s.great), count100: n(s.ok), count50: n(s.meh), countmiss: n(s.miss), countgeki: 0, countkatu: 0 };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    const qs = event.queryStringParameters || {};
    const id = qs.id;
    // ?m=osu|taiko|fruits|mania: id is a legacy (stable) score id, which
    // /scores/{ruleset}/{id} resolves; without it, a lazer solo score id.
    const legacyMode = ['osu', 'taiko', 'fruits', 'mania'].includes(qs.m) ? qs.m : null;
    if (!id || !/^\d{1,20}$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'invalid id' }) };
    }
    try {
        const token = await getOsuToken();
        const get = (path) => fetch(`https://osu.ppy.sh/api/v2/scores/${path}`, {
            headers: { Authorization: `Bearer ${token}`, 'x-api-version': '20220705' },
        });
        let res = await get(legacyMode ? `${legacyMode}/${id}` : id);
        // A lazer-only score has no legacy id: the "legacy" id was a solo id.
        if (legacyMode && res.status === 404) res = await get(id);
        if (!res.ok) {
            return { statusCode: res.status === 404 ? 404 : 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: `osu! API ${res.status}` }) };
        }
        const s = await res.json();
        const mode = n(s.ruleset_id != null ? s.ruleset_id : s.mode_int);
        const acronyms = (s.mods || []).map((m) => (typeof m === 'string' ? m : m && m.acronym)).filter(Boolean);
        const enabledMods = acronyms.reduce((bits, a) => bits | (MOD_BITS[a] || 0), 0);
        const score = {
            score_id: String(s.id),
            score: String(s.legacy_total_score || s.total_score || s.score || 0),
            maxcombo: String(n(s.max_combo)),
            perfect: (s.legacy_perfect != null ? s.legacy_perfect : s.is_perfect_combo) ? '1' : '0',
            enabled_mods: String(enabledMods),
            user_id: String(s.user_id || (s.user && s.user.id) || ''),
            username: (s.user && s.user.username) || '',
            date: String(s.ended_at || s.created_at || '').replace('T', ' ').replace(/(\.\d+)?Z$/, ''),
            rank: s.passed === false ? 'F' : (s.rank || 'F'),
            pp: s.pp != null ? String(s.pp) : null,
            ...Object.fromEntries(Object.entries(legacyCounts(s.statistics, mode)).map(([k, v]) => [k, String(v)])),
        };
        const body = JSON.stringify({ score, beatmapId: s.beatmap_id || (s.beatmap && s.beatmap.id), mode });
        // A finished score never changes; pp can be recalculated, so a day is plenty.
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }, body };
    } catch (err) {
        return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
