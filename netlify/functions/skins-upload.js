/* Backs up one .osk file to the caller's cloud slot — strictly optional and
   size-capped, see js/skins.js. Netlify Functions (classic Lambda-compatible
   runtime, same as every other function here) hard-cap request bodies at
   ~6MB; base64-encoding a binary file into a JSON body inflates it by ~33%,
   so MAX_SKIN_BYTES is set well below that ceiling rather than right up
   against it. Real osu! skins commonly run 10-200+ MB (see js/skins.js's own
   comment on why the *local* locker uses IndexedDB instead of localStorage),
   so this only ever covers simple/small skins — the client is expected to
   check file.size before even attempting an upload and say so, but the limit
   is re-enforced here since the client can't be trusted. */
const crypto = require('crypto');
const { getSkinBackupsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const MAX_SKIN_BYTES = 4 * 1024 * 1024;
const MAX_SKINS_PER_USER = 30;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    if (!event.body || Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: 'Request too large' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    if (!name || !dataBase64) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Missing name or file data' }) };
    }

    let buffer;
    try {
        buffer = Buffer.from(dataBase64, 'base64');
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid file data' }) };
    }
    if (buffer.length === 0 || buffer.length > MAX_SKIN_BYTES) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: `Skin file exceeds the ${MAX_SKIN_BYTES / 1024 / 1024}MB cloud backup limit` }) };
    }

    try {
        const store = getSkinBackupsStore();
        const index = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        if (index.length >= MAX_SKINS_PER_USER) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: `Exceeds the ${MAX_SKINS_PER_USER}-skin backup limit` }) };
        }

        const id = crypto.randomUUID();
        await store.set(`file:${user.id}:${id}`, buffer);

        const entry = { id, name, size: buffer.length, uploadedAt: new Date().toISOString() };
        index.push(entry);
        await store.setJSON(`index:${user.id}`, index);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: entry }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
