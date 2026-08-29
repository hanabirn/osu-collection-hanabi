/* ===== osu! profile beatmapsets proxy (API v2) =====
   Lists a user's own favourite beatmapsets or their most-played sets, used to
   seed a freshly-logged-in visitor's collection from their osu! profile
   (js/osu.js importFromOsuProfile). Both endpoints are public, so this goes
   through the shared client_credentials token (OSU_CLIENT_ID / _SECRET) like
   osu-beatmapset.js / osu-news.js — the login flow only keeps the visitor's
   id, never an access token.

     ?id=<userId>&type=favourite|most_played&limit=<1-100>&offset=<n>
     -> [{ beatmapset_id, count? }]   (count only for most_played)

   Response is normalised to just the set id (+ playcount) — the client
   re-fetches each full set through the v1 proxy to build its cards. */
const { getOsuToken } = require('./_osu-auth');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS, body: '' };
    }

    const q = event.queryStringParameters || {};
    const id = q.id;
    const type = q.type === 'most_played' ? 'most_played' : 'favourite';
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 100);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);

    if (!id || !/^\d+$/.test(String(id))) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing or invalid id' }) };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch(
            `https://osu.ppy.sh/api/v2/users/${id}/beatmapsets/${type}?limit=${limit}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        );
        if (!res.ok) throw new Error(`osu! user beatmapsets request failed (${res.status})`);
        const data = await res.json();
        const arr = Array.isArray(data) ? data : [];

        const out = arr.map(x => {
            if (!x) return null;
            if (type === 'most_played') {
                const sid = x.beatmapset_id
                    || (x.beatmapset && x.beatmapset.id)
                    || (x.beatmap && x.beatmap.beatmapset_id);
                return sid ? { beatmapset_id: Number(sid), count: x.count || 0 } : null;
            }
            return x.id ? { beatmapset_id: Number(x.id) } : null;
        }).filter(Boolean);

        return { statusCode: 200, headers: CORS, body: JSON.stringify(out) };
    } catch (err) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
};
