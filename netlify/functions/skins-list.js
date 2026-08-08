/* Lists the caller's cloud-backed-up skins (metadata only — see
   skins-download.js for the actual file bytes). See skins-upload.js for the
   size/count limits and why this exists as an *optional* companion to the
   local-only skin locker (js/skins.js) rather than a replacement for it. */
const { getSkinBackupsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    try {
        const store = getSkinBackupsStore();
        const index = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'private, no-store' },
            body: JSON.stringify({ items: index }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
