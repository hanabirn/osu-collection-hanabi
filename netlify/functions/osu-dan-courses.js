/* ===== 段位認定 (dan course) browser — osu! API v2 =====
   Dan courses are community skill-certification marathons — one beatmapset
   per dan, mostly graveyard/loved. No official API/wiki list, and osu!'s
   raw beatmapset search for "dan course" pulls in a lot of noise (samples,
   betas, practice packs, droid ports, joke sets), so this is CURATED:

     ?mode=<osu|taiko|catch|mania4k|mania7k>
        -> { groups: [{ group, sets: [...lean...] }], search: [...lean...],
             cursor_string }              (curated list + a tight search page)
     ?mode=<...>&more=1&cursor=<str>
        -> { search: [...lean...], cursor_string }   (more of the search)

   Curated ids come from each keymode's current project (Dan ~ REFORM ~ /
   JinJin's 7K / Dan-i Dojo / Tapping Dan Course / …) — review ~yearly, the
   scene shifts. Uses the shared client_credentials token. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const DAN_MODES = {
    osu:      { m: 0, q: 'dan course' },
    taiko:    { m: 1, q: 'dan-i dojo' },
    catch:    { m: 2, q: 'dan course' },
    mania4k:  { m: 3, q: '4k dan course' },
    mania7k:  { m: 3, q: '7k dan course' },
};

// Authoritative dan courses, grouped by project. REVIEW ~YEARLY.
const DAN_CURATED = {
    osu: [
        { group: 'Osu!std Tapping Dan Course', ids: [2316877, 2315888, 2315697, 2319170] },
    ],
    taiko: [
        { group: 'osu!Taiko 段位道場 (Dan-i Dojo)', ids: [695759, 703200, 912120, 1098825] },
    ],
    catch: [
        { group: 'osu!catch Dan Course', ids: [2170847, 2170864] },
    ],
    mania4k: [
        { group: 'Dan ~ REFORM ~', ids: [1079991, 1079998, 2297014, 2316976, 2316993, 2320002, 2317095] },
        { group: "Signicial's Courses", ids: [1575457, 1575458, 1622471, 2341590] },
        { group: '4K LN Dan Courses', ids: [2243057, 2340696] },
    ],
    mania7k: [
        { group: 'Regular Dan Phase', ids: [450069, 451788, 930218, 1061136] },
        { group: 'LN Dan Phase', ids: [450649, 1220647] },
    ],
};

const JUNK_RE = /\b(sample|beta|outdated|preview|demo|wip|placeholder|template)\b|appeared!|deadly sins|droid/i;

function looksLikeDanPack(s) {
    const diffs = Array.isArray(s.beatmaps) ? s.beatmaps.length : 0;
    if (diffs < 2) return false;
    const title = (s.title_unicode || s.title || '') + '';
    const artist = (s.artist_unicode || s.artist || '') + '';
    if (JUNK_RE.test(title) || JUNK_RE.test(artist)) return false;
    const titleStrong = /\bdan[\s~._-]*(course|phase|dojo)|dan-?i\s*dojo|段位道場/i.test(title);
    // Belongs to a dan-course "series" artist (e.g. "osu!mania 7K Dan Course",
    // "osu!catch Dan Course") — then a looser title (a phase/level/dan name) counts.
    const artistSeries = /dan[\s~._-]*course|dan-?i\s*dojo|段位/i.test(artist);
    const titleLoose = /\b(dan|phase|kyu|level)\b|[段級]/i.test(title);
    const artistGeneric = /various artist/i.test(artist);
    return (titleStrong && (artistSeries || artistGeneric)) || (artistSeries && titleLoose);
}

function leanSet(s, extra) {
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
        ...(extra || {}),
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
    const more = qs.more === '1';

    try {
        const token = await getOsuToken();
        const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

        const searchParams = new URLSearchParams({ q: cfg.q, m: String(cfg.m), s: 'any', sort: 'relevance_desc' });
        if (qs.cursor) searchParams.set('cursor_string', qs.cursor);
        const searchP = fetch(`https://osu.ppy.sh/api/v2/beatmapsets/search?${searchParams}`, { headers: auth })
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`search ${r.status}`)));

        // Curated groups only on the first (non-`more`) request.
        const curatedCfg = (!more && DAN_CURATED[modeKey]) || [];
        const curatedIds = curatedCfg.flatMap(g => g.ids);
        const curatedP = curatedIds.length
            ? Promise.all(curatedIds.map(id =>
                fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, { headers: auth })
                    .then(r => r.ok ? r.json() : null).catch(() => null)))
            : Promise.resolve([]);

        const [search, curatedRaw] = await Promise.all([searchP, curatedP]);

        const byId = new Map();
        curatedRaw.forEach(s => { if (s && s.id) byId.set(s.id, s); });
        const curatedSet = new Set(curatedIds);

        const groups = curatedCfg.map(g => ({
            group: g.group,
            sets: g.ids.map(id => byId.get(id)).filter(Boolean).map(s => leanSet(s, { pinned: true })),
        })).filter(g => g.sets.length);

        const seen = new Set(curatedIds);
        const searchOut = [];
        for (const s of (search.beatmapsets || [])) {
            if (s && s.id && !seen.has(s.id) && !curatedSet.has(s.id) && looksLikeDanPack(s)) {
                seen.add(s.id);
                searchOut.push(leanSet(s, { pinned: false }));
            }
        }

        const body = more
            ? { search: searchOut, cursor_string: search.cursor_string || null }
            : { groups, search: searchOut, cursor_string: search.cursor_string || null };

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=1800' },
            body: JSON.stringify(body),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
