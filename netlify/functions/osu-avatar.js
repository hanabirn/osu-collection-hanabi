const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const id = (event.queryStringParameters || {}).id;
    if (!id || !/^\d+$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: 'Missing or invalid id' };
    }

    try {
        const res = await fetch(`https://a.ppy.sh/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu-hanabi.netlify.app/)' },
        });
        if (!res.ok) {
            // Don't cache failures for long — osu recovering shouldn't stay masked by a stale error.
            return { statusCode: res.status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: 'Failed to fetch avatar' };
        }
        const contentType = res.headers.get('content-type') || 'image/png';
        const buffer = Buffer.from(await res.arrayBuffer());
        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
