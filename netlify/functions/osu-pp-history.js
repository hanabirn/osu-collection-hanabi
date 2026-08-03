/* Proxies osu!Track's public stats_history endpoint (https://github.com/Ameobea/osutrack-api)
   so the client never talks to a third-party host directly (CORS isn't documented there,
   and this keeps the pattern consistent with the other osu-*.js functions). */
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
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

        const res = await fetch(`https://osutrack-api.ameo.dev/stats_history?${params.toString()}`);
        if (!res.ok) {
            return { statusCode: res.status, headers, body: JSON.stringify({ error: `osutrack-api returned ${res.status}` }) };
        }
        const data = await res.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
