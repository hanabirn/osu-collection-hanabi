/* A beatmapset's cover image, served from this site's own origin.
   assets.ppy.sh sends no CORS headers, so the score card's "下載圖片"
   (html-to-image, js/score-card.js) can't read covers from there and saved
   cards came out with a black background. Same shape as osu-avatar.js. */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const id = (event.queryStringParameters || {}).id;
    if (!id || !/^\d{1,10}$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: 'Missing or invalid id' };
    }

    try {
        const ua = { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu.hanabirn.xyz/)' };
        let res = await fetch(`https://assets.ppy.sh/beatmaps/${id}/covers/cover@2x.jpg`, { headers: ua });
        if (!res.ok) res = await fetch(`https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg`, { headers: ua });
        if (!res.ok) {
            return { statusCode: res.status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: 'Failed to fetch cover' };
        }
        const contentType = res.headers.get('content-type') || 'image/jpeg';
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
