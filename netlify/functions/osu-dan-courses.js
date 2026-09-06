/* ===== 段位認定 (dan course) browser — osu! API v2 =====
   Dan courses are community skill-certification marathons, one per
   beatmapset (mostly graveyard/loved). There is no official API or wiki
   list, so this drives off osu!'s own beatmapset SEARCH ("dan course" per
   mode, graveyard included) and prepends a small hand-picked set of the
   well-known ones. osu!Collector has nothing like this.

     ?mode=<osu|taiko|catch|mania4k|mania7k>[&cursor=<str>]
        -> { sets: [...lean...], cursor_string }

   Uses the shared client_credentials token (OSU_CLIENT_ID/OSU_CLIENT_SECRET),
   same as osu-news.js / osu-beatmapset.js. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// mode key -> { ruleset int, search query, pinned beatmapset ids (well-known
// dan-course sets, newest series first). Review the pins periodically — the
// scene adds/replaces series over time; search covers the rest. }
const DAN_MODES = {
    osu:      { m: 0, q: 'dan course',    pins: [2316877, 2315888, 2315697, 2319170] },
    taiko:    { m: 1, q: 'dan course',    pins: [] },
    catch:    { m: 2, q: 'dan course',    pins: [2170847, 2170864] },
    mania4k:  { m: 3, q: '4k dan course', pins: [2288888, 2243057, 1550709, 373141] },
    mania7k:  { m: 3, q: '7k dan course', pins: [450069, 451788, 930218, 1061136, 450649, 1220647] },
};

function leanSet(s, pinned) {
    const diffs = Array.isArray(s.beatmaps) ? s.beatmaps : [];
    return {
        id: s.id,
        title: s.title_unicode || s.title || '',
        artist: s.artist_unicode || s.artist || '',
        creator: s.creator || '',
        status: s.status || '',
        diff_count: diffs.length || null,
        star_min: diffs.length ? Math.min(...diffs.map(b => b.difficulty_rating || 0)) : null,
        star_max: diffs.length ? Math.max(...diffs.map(b => b.difficulty_rating || 0)) : null,
        pinned: !!pinned,
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

    const qs = event.queryStringParameters || {};
    const modeKey = (qs.mode || 'mania4k').trim();
    const cfg = DAN_MODES[modeKey];
    if (!cfg) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'invalid mode' }) };
    }

    try {
        const token = await getOsuToken();
        const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
        const firstPage = !qs.cursor;

        const params = new URLSearchParams({ q: cfg.q, m: String(cfg.m), s: 'any', sort: 'relevance_desc' });
        if (qs.cursor) params.set('cursor_string', qs.cursor);
        const searchP = fetch(`https://osu.ppy.sh/api/v2/beatmapsets/search?${params}`, { headers: auth })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`search ${r.status}`)));

        // Pinned sets only on the first page.
        const pinP = firstPage && cfg.pins.length
            ? Promise.all(cfg.pins.map(id =>
                fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, { headers: auth })
                    .then(r => r.ok ? r.json() : null).catch(() => null)))
            : Promise.resolve([]);

        const [search, pins] = await Promise.all([searchP, pinP]);

        const seen = new Set();
        const out = [];
        for (const p of pins) {
            if (p && p.id && !seen.has(p.id)) { seen.add(p.id); out.push(leanSet(p, true)); }
        }
        for (const s of (search.beatmapsets || [])) {
            if (s && s.id && !seen.has(s.id)) { seen.add(s.id); out.push(leanSet(s, false)); }
        }

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=1800' },
            body: JSON.stringify({ sets: out, cursor_string: search.cursor_string || null }),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
