/* ===== osu! News proxy =====
   osu!'s news listing has no public unauthenticated JSON endpoint (the
   /home/news page is server-rendered), so this goes through API v2 with a
   client_credentials OAuth app (OSU_CLIENT_ID / OSU_CLIENT_SECRET env vars),
   unlike the legacy-API-v1-keyed osu.js proxy. Token is cached in-module so
   a warm function container doesn't re-auth on every request. */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getOsuToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

    const res = await fetch('https://osu.ppy.sh/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: process.env.OSU_CLIENT_ID,
            client_secret: process.env.OSU_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'public',
        }),
    });
    if (!res.ok) throw new Error('osu! token request failed');
    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return cachedToken;
}

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
