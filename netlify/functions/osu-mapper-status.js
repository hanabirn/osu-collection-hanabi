/* ===== Tracked-mapper graveyard/loved beatmap proxy =====
   Tracked mappers (js/updates.js) are stored by username only, but
   GET /api/v2/users/{user}/beatmapsets/{type} takes a numeric user id (not
   the @username-prefixed lookup the single-user endpoint supports) — so
   this resolves the username to an id via GET /users/@{username} first,
   then fetches the graveyard and loved beatmapset lists for that id.
   Resolution isn't cached anywhere (client keeps tracking by username only,
   no schema change needed there) — an extra ~1 request per tracked mapper
   per 15-minute notification check is negligible at this scale. Needs OAuth
   v2 (client_credentials), same as osu-user-achievements.js/osu-news.js. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function trimSets(sets) {
    return (Array.isArray(sets) ? sets : []).map(s => ({ id: s.id, title: s.title, artist: s.artist }));
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const qs = event.queryStringParameters || {};
    const username = (qs.username || '').trim();
    if (!username) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Missing username' }) };
    }

    try {
        const token = await getOsuToken();
        const authHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

        const userRes = await fetch(`https://osu.ppy.sh/api/v2/users/@${encodeURIComponent(username)}`, { headers: authHeaders });
        if (!userRes.ok) {
            return { statusCode: 404, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Mapper not found' }) };
        }
        const user = await userRes.json();
        const userId = user.id;

        const [graveyardRes, lovedRes] = await Promise.all([
            fetch(`https://osu.ppy.sh/api/v2/users/${userId}/beatmapsets/graveyard?limit=20`, { headers: authHeaders }),
            fetch(`https://osu.ppy.sh/api/v2/users/${userId}/beatmapsets/loved?limit=20`, { headers: authHeaders }),
        ]);
        if (!graveyardRes.ok || !lovedRes.ok) {
            return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'osu! API request failed' }) };
        }

        const graveyard = trimSets(await graveyardRes.json());
        const loved = trimSets(await lovedRes.json());

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
            body: JSON.stringify({ userId, graveyard, loved }),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
