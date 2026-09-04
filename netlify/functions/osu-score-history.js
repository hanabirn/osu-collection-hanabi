/* Proxies osu!Track's public hiscores endpoint (https://github.com/Ameobea/osutrack-api)
   so the client never talks to a third-party host directly — same pattern as
   osu-pp-history.js's stats_history proxy, just a different osu!Track endpoint.

   Unlike osu! API v1/v2 (which only ever expose a user's current best-100-by-pp
   and last-50-recent plays, never a full history), osu!Track has been polling
   most active players' hiscores for years and keeps every recorded score, so
   this is the only source that can answer "list every SS/S/A/... I've ever
   gotten" with any real coverage. It is still not complete — osu!Track only
   records a score if it happened to poll that player before the score got
   overwritten by a better one, and it can't see anything osu! itself never
   durably saved (e.g. the lazer/stable score-sync gaps some players hit). */
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const qs = event.queryStringParameters || {};
        if (!qs.user || qs.mode === undefined) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'user and mode are required' }) };
        }

        const params = new URLSearchParams({ user: qs.user, mode: qs.mode });
        if (qs.from) params.set('from', qs.from);
        if (qs.to) params.set('to', qs.to);

        const res = await fetch(`https://osutrack-api.ameo.dev/hiscores?${params.toString()}`);
        if (!res.ok) {
            return { statusCode: res.status, headers, body: JSON.stringify({ error: `osutrack-api returned ${res.status}` }) };
        }
        const data = await res.json();
        return { statusCode: 200, headers, body: JSON.stringify(Array.isArray(data) ? data : []) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
