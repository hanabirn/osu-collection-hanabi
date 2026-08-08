/* ===== Tracked-player achievement list proxy =====
   GET /api/v2/users/{id} (UserExtended) already includes user_achievements
   inline — no separate "list this user's medals" call needed, and there's
   no public osu! API endpoint for medal names/icons/descriptions (checked
   the docs; nothing like /achievements exists), so this only ever returns
   achievement ids. js/notifications.js's checkTrackedPlayers()
   diffs those ids against what's already known and notifies with a link to
   the player's own profile rather than trying to render medal details
   in-site. Needs OAuth v2 (client_credentials) unlike the legacy-v1-keyed
   osu.js proxy that already handles this site's PP tracking — see
   _osu-auth.js, same pattern as osu-news.js. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const qs = event.queryStringParameters || {};
    const id = qs.id;
    if (!id || !/^\d+$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Missing or invalid id' }) };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/users/${id}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) {
            return { statusCode: res.status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: `osu! API returned ${res.status}` }) };
        }
        const data = await res.json();
        const achievements = (data.user_achievements || []).map(a => a.achievement_id);

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
            body: JSON.stringify({ achievements }),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
