/* Proxies o!rdr's render list/status endpoint (apis.issou.best/ordr/renders)
   so the client can poll a renderID for progress/videoUrl without hitting
   apis.issou.best's CORS wall directly. */
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
        if (!qs.renderID) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'renderID is required' }) };
        }

        const res = await fetch(`https://apis.issou.best/ordr/renders?renderID=${encodeURIComponent(qs.renderID)}`);
        const data = await res.json();
        return { statusCode: res.status, headers, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
