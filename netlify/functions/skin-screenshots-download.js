/* Streams a hosted .osk's raw bytes — public, no auth (same reasoning as
   skin-screenshots-image.js: this is a public gallery, the id is an
   unguessable crypto.randomUUID(), and there's nothing sensitive gated
   behind knowing it). Only ever serves files skin-screenshots-upload.js
   itself accepted (capped, zip-magic-byte-checked) — not every entry has
   one, since a screenshot can point at an external downloadUrl instead. */
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
        const index = (await store.get('index', { type: 'json' })) || [];
        const entry = index.find(e => e.id === id);
        // ?link=n: one of the entry's download links (Google Drive, MEGA…), counted, then off there
        const linkN = (event.queryStringParameters || {}).link;
        if (entry && linkN != null) {
            const links = Array.isArray(entry.links) ? entry.links : (entry.downloadUrl ? [entry.downloadUrl] : []);
            const url = links[Number(linkN)];
            if (!url || !/^https?:\/\//i.test(url)) return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
            entry.downloads = (entry.downloads || 0) + 1;
            await store.setJSON('index', index);
            return { statusCode: 302, headers: { ...corsHeaders, Location: url, 'Cache-Control': 'no-store' }, body: '' };
        }
        if (!entry || !entry.oskFilename) {
            return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }

        const data = await store.get(`osk:${id}`, { type: 'arrayBuffer' });
        if (data) { entry.downloads = (entry.downloads || 0) + 1; await store.setJSON('index', index); }
        if (!data) {
            return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${entry.oskFilename.replace(/["\\]/g, '')}"`,
                'Cache-Control': 'public, max-age=86400',
            },
            body: Buffer.from(data).toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
};
