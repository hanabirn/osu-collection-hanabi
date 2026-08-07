/* Publishes (or republishes, overwriting) the caller's Beatmap collection to
   the public gallery — see js/public-collections.js. One entry per osu! user
   id; id/username always come from the verified auth token (_auth-token.js),
   never from the request body, so a caller can't publish under someone
   else's name no matter what they put in the body. */
const { getStore } = require('@netlify/blobs');
const { verifyAuthToken } = require('./_auth-token');

const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const MAX_SETS = 3000;
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;

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
        return { statusCode: 413, headers, body: JSON.stringify({ error: 'Collection too large' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const collection = body && body.collection;
    if (!collection || !OSU_MODES.every(m => Array.isArray(collection[m]))) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid collection format' }) };
    }

    const seen = new Set();
    let maxRating = 0;
    for (const mode of OSU_MODES) {
        for (const set of collection[mode]) {
            if (typeof set.beatmapset_id !== 'number' || !Array.isArray(set.beatmaps)) {
                return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid collection format' }) };
            }
            seen.add(set.beatmapset_id);
            for (const bm of set.beatmaps) {
                if (typeof bm.difficulty_rating === 'number' && bm.difficulty_rating > maxRating) maxRating = bm.difficulty_rating;
            }
        }
    }
    if (seen.size === 0) {
        return { statusCode: 422, headers, body: JSON.stringify({ error: 'Collection is empty' }) };
    }
    if (seen.size > MAX_SETS) {
        return { statusCode: 413, headers, body: JSON.stringify({ error: `Collection exceeds the ${MAX_SETS}-beatmap limit` }) };
    }

    try {
        const store = getStore('osu-public-collections');
        const updatedAt = new Date().toISOString();

        await store.setJSON(`full:${user.id}`, {
            id: user.id,
            username: user.username,
            collection,
            updatedAt,
        });

        const index = (await store.get('index', { type: 'json' })) || [];
        const filtered = index.filter(entry => entry.id !== user.id);
        filtered.push({ id: user.id, username: user.username, totalSets: seen.size, maxRating, updatedAt });
        await store.setJSON('index', filtered);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, updatedAt }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
