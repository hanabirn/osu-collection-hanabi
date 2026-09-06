/* ===== Official osu! beatmap-pack proxy (API v2) =====
   osu! curates real beatmap packs — themed, artist, tournament, spotlight,
   loved, featured-artist — at /api/v2/beatmaps/packs. osu!Collector never
   surfaces these (it only has user-uploaded collections), so this powers a
   "官方圖包" browse tab where a whole pack can be turned into a collection
   category in one click.

   Two shapes:
     ?type=<standard|featured|tournament|loved|spotlight|theme|artist>[&cursor=<str>]
        -> { packs: [...lean...], cursor_string }   (listing, 1h CDN cache)
     ?tag=<pack tag, e.g. S1290>
        -> { pack: {...}, beatmapsets: [...lean...] } (detail, 1d CDN cache)

   Uses the shared client_credentials token (OSU_CLIENT_ID / OSU_CLIENT_SECRET),
   same as osu-news.js / osu-beatmapset.js. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const PACK_TYPES = ['standard', 'featured', 'tournament', 'loved', 'chart', 'theme', 'artist'];

function leanPack(p) {
    return {
        tag: p.tag,
        name: p.name,
        author: p.author,
        date: p.date,
        ruleset_id: p.ruleset_id ?? null,
        no_diff_reduction: !!p.no_diff_reduction,
        // count is only present on the detail response's own object
        set_count: Array.isArray(p.beatmapsets) ? p.beatmapsets.length : (p.set_count ?? null),
    };
}

function leanSet(s) {
    return {
        id: s.id,
        title: s.title_unicode || s.title || '',
        artist: s.artist_unicode || s.artist || '',
        creator: s.creator || '',
        status: s.status || '',
        nsfw: !!s.nsfw,
        spotlight: !!s.spotlight,
        // difficulty spread for a quick star badge, if the payload carries beatmaps
        star_min: Array.isArray(s.beatmaps) && s.beatmaps.length
            ? Math.min(...s.beatmaps.map(b => b.difficulty_rating || 0)) : null,
        star_max: Array.isArray(s.beatmaps) && s.beatmaps.length
            ? Math.max(...s.beatmaps.map(b => b.difficulty_rating || 0)) : null,
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const qs = event.queryStringParameters || {};
    const tag = (qs.tag || '').trim();
    const type = (qs.type || 'standard').trim();

    if (tag && !/^[A-Za-z0-9]{1,12}$/.test(tag)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'invalid tag' }) };
    }
    if (!tag && !PACK_TYPES.includes(type)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'invalid type' }) };
    }

    try {
        const token = await getOsuToken();
        const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

        if (tag) {
            const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/packs/${encodeURIComponent(tag)}`, { headers: auth });
            if (!res.ok) throw new Error(`osu! pack request failed (${res.status})`);
            const data = await res.json();
            const sets = (data.beatmapsets || []).map(leanSet);
            return {
                statusCode: 200,
                headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=86400' },
                body: JSON.stringify({ pack: leanPack(data), beatmapsets: sets }),
            };
        }

        const params = new URLSearchParams({ type });
        if (qs.cursor) params.set('cursor_string', qs.cursor);
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/packs?${params}`, { headers: auth });
        if (!res.ok) throw new Error(`osu! packs request failed (${res.status})`);
        const data = await res.json();
        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
            body: JSON.stringify({
                packs: (data.beatmap_packs || []).map(leanPack),
                cursor_string: data.cursor_string || null,
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
