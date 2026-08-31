/* ===== osu! beatmapset metadata proxy (API v2) =====
   The legacy API v1 (netlify/functions/osu.js) only exposes a coarse
   `language_id` — Russian, Polish, Thai, Portuguese etc. all collapse into
   "Other". API v2's /beatmapsets/{id} returns a proper `language: {id, name}`
   (and `genre`), so the collection cards' language badge goes through here.
   Uses the shared client_credentials token helper (OSU_CLIENT_ID /
   OSU_CLIENT_SECRET), same as osu-news.js / osu-tournaments.js.

   Only language, genre and source are echoed back — the full v2 beatmapset
   object is large and the rest is already covered by the v1 proxy. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const id = (event.queryStringParameters || {}).id;
    if (!id || !/^\d+$/.test(String(id))) {
        return {
            statusCode: 400,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ error: 'missing or invalid id' }),
        };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`osu! beatmapset request failed (${res.status})`);
        const data = await res.json();
        return {
            statusCode: 200,
            // Language/genre are essentially immutable once a set is ranked,
            // so let the CDN + browser hold onto this for a day.
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=86400' },
            body: JSON.stringify({
                id: Number(id),
                language: data.language || null,
                genre: data.genre || null,
                // Free-text field ("SOUND VOLTEX III GRAVITY WARS", "東方Project",
                // an anime title…), often empty. Normalized to "" when absent.
                source: (data.source || '').trim(),
            }),
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ error: err.message }),
        };
    }
};
