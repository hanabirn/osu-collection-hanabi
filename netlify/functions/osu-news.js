/* ===== osu! News proxy =====
   osu!'s news listing has no public unauthenticated JSON endpoint (the
   /home/news page is server-rendered), so this goes through API v2 with a
   client_credentials OAuth app (OSU_CLIENT_ID / OSU_CLIENT_SECRET env vars),
   unlike the legacy-API-v1-keyed osu.js proxy. See _osu-auth.js for the
   shared token-caching helper (also used by osu-tournaments.js). */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch('https://osu.ppy.sh/api/v2/news', {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('osu! news request failed');
        const data = await res.json();
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=900' }, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
