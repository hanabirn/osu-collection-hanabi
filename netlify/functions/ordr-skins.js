/* Proxies o!rdr's public skin catalog search (apis.issou.best/ordr/skins) —
   used by the replay-render skin picker. Same CORS-avoidance reasoning as
   the other ordr-*.js functions: apis.issou.best doesn't send an
   Access-Control-Allow-Origin header, so the browser can't call it directly. */
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
        const params = new URLSearchParams();
        if (qs.search) params.set('search', qs.search);
        params.set('pageSize', qs.pageSize || '8');

        const res = await fetch(`https://apis.issou.best/ordr/skins?${params.toString()}`);
        const data = await res.json();
        return { statusCode: res.status, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
