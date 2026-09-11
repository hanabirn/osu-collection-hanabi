/* Streams one skin's optional preview image. Public, no auth — same trust
   model as skins-download.js / the main site's skin-screenshots-image.js. */
const { getSkinsStore } = require('./_blobs-store');

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
        const store = getSkinsStore();
        const data = await store.get(`preview:${id}`, { type: 'arrayBuffer' });
        if (!data) {
            return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }

        const index = (await store.get('index', { type: 'json' })) || [];
        const entry = index.find(r => r.id === id);
        const contentType = (entry && entry.previewType) || 'image/jpeg';

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
            body: Buffer.from(data).toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
};
