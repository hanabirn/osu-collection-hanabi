/* Streams one chat attachment's raw bytes — public, no auth (this is a
   public chat room). The id is an unguessable crypto.randomUUID() from
   chat-upload.js; a stale id (message or media deleted) just 404s.
   Reached as /chat-media/<id> via a netlify.toml rewrite. */
const { getChatMediaStore } = require('./_blobs-store');
const { ALLOWED_MEDIA_MIME, sniffImageMime } = require('./_chat-shared');

exports.handler = async (event) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: cors, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const id = (event.queryStringParameters || {}).id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad id' }) };
    }

    try {
        const store = getChatMediaStore();
        const res = await store.getWithMetadata(`media:${id}`, { type: 'arrayBuffer' });
        if (!res || !res.data) {
            return { statusCode: 404, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
        }
        const buf = Buffer.from(res.data);
        const metaMime = res.metadata && res.metadata.mime;
        const mime = ALLOWED_MEDIA_MIME.includes(metaMime) ? metaMime : (sniffImageMime(buf) || 'application/octet-stream');

        return {
            statusCode: 200,
            headers: {
                ...cors,
                'Content-Type': mime,
                // Ids are immutable and unguessable — cache hard.
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
            body: buf.toString('base64'),
            isBase64Encoded: true,
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
    }
};
