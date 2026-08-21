/* Streams one screenshot's raw bytes — public, no auth (this is a public
   gallery, unlike skins-download.js's private per-user backups). The id is
   an unguessable crypto.randomUUID() from skin-screenshots-upload.js, and
   nothing sensitive hangs off knowing it (worst case: someone loads an
   image whose gallery entry was already deleted, which just 404s), so
   there's no need to cross-check it against the index like
   skins-download.js does against the caller's own list. Always JPEG — see
   skin-screenshots-upload.js's magic-byte check. */
const { getSkinScreenshotsStore } = require('./_blobs-store');

exports.handler = async (event) => {
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const id = (event.queryStringParameters || {}).id;
    if (!id) {
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing id' }) };
    }

    try {
        const store = getSkinScreenshotsStore();
        const data = await store.get(`image:${id}`, { type: 'arrayBuffer' });
        if (!data) {
            return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=86400',
            },
            body: Buffer.from(data).toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
};
