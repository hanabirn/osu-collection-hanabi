/* CORS-enabled proxy for osu!'s beatmap preview mp3s. Same shape as
   osu-avatar.js (fetch upstream, re-serve with Access-Control-Allow-Origin),
   but for audio instead of images.

   Why this exists: b.ppy.sh/preview/<id>.mp3 sends no
   Access-Control-Allow-Origin header, so an <audio crossorigin="anonymous">
   pointed straight at it either fails to load (crossOrigin set) or taints
   the Web Audio graph so AnalyserNode reads back silence (crossOrigin unset)
   — either way there's no way to drive a real audio-reactive visualizer
   (see js/osu.js playOsuPreview()) off the raw upstream URL. Routing through
   our own origin first fixes that; playback behaviour is otherwise
   identical to hitting b.ppy.sh directly. */
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
        const res = await fetch(`https://b.ppy.sh/preview/${id}.mp3`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu-collection-hanabi.netlify.app/)' },
        });
        if (!res.ok) {
            return { statusCode: res.status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: 'Failed to fetch preview' };
        }
        const contentType = res.headers.get('content-type') || 'audio/mpeg';
        const buffer = Buffer.from(await res.arrayBuffer());
        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=604800' },
            body: buffer.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
