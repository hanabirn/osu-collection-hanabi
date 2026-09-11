/* Streams one skin's raw .osk bytes and bumps its download counter. Public,
   no auth — the id is an unguessable crypto.randomUUID(), same trust model
   as the main site's skin-screenshots-image.js. */
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
        const data = await store.get(`file:${id}`, { type: 'arrayBuffer' });
        if (!data) {
            return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }

        // Best-effort counter bump — not transactional, but a lost +1 under
        // rare concurrent downloads isn't worth locking for on a display
        // counter (same pragmatism as this project's other counters).
        let filename = `${id}.osk`;
        try {
            const index = (await store.get('index', { type: 'json' })) || [];
            const idx = index.findIndex(r => r.id === id);
            if (idx !== -1) {
                index[idx].downloadCount = (index[idx].downloadCount || 0) + 1;
                filename = `${index[idx].name || id}.osk`.replace(/[\\/:*?"<>|]/g, '_');
                await store.setJSON('index', index);
            }
        } catch {
            // counter bump is a nice-to-have; never block the actual download on it
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'public, max-age=3600',
            },
            body: Buffer.from(data).toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
};
