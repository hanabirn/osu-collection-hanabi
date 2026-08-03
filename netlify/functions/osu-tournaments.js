/* ===== osu! Tournaments proxy =====
   Lists recent topics from the official "Tournaments" subforum
   (osu.ppy.sh/community/forums/55) via API v2's forum topics endpoint —
   that forum page itself is server-rendered with no public JSON endpoint,
   same situation as the news listing. See _osu-auth.js for the shared
   OAuth token helper. */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const TOURNAMENTS_FORUM_ID = 55;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/forums/topics?forum_id=${TOURNAMENTS_FORUM_ID}&sort=new`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('osu! forum topics request failed');
        const data = await res.json();
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=600' }, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
