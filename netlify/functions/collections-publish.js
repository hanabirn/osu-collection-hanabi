/* Publishes (or republishes, overwriting) the caller's Beatmap collection to
   the public gallery — see js/public-collections.js. One entry per osu! user
   id; id/username always come from the verified auth token (_auth-token.js),
   never from the request body, so a caller can't publish under someone
   else's name no matter what they put in the body. */
const { getCollectionsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const OSU_MODES = ['standard', 'taiko', 'catch', 'mania'];
const MAX_SETS = 3000;
const MAX_CATEGORIES = 100;
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
// The full index array is read/written on every publish and every gallery
// list request, so each entry's `tags` is capped well below MAX_CATEGORIES
// to keep that array cheap regardless of how many categories a publisher has.
const MAX_INDEX_TAGS = 12;

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

    /* Categories are optional and browse/filter-only on the gallery side —
       never merged into a downloader's own categories (see
       js/public-collections.js's importPublicCollectionData, which only
       ever touches `collection`). Validated loosely and cross-checked
       against `seen` so a publisher can't smuggle arbitrary junk into
       categoryMembers under the guise of beatmapset ids. */
    let categories = [];
    let categoryMembers = {};
    if (body.categories !== undefined || body.categoryMembers !== undefined) {
        if (!Array.isArray(body.categories) || typeof body.categoryMembers !== 'object' || body.categoryMembers === null || Array.isArray(body.categoryMembers)) {
            return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid categories format' }) };
        }
        if (body.categories.length > MAX_CATEGORIES) {
            return { statusCode: 413, headers, body: JSON.stringify({ error: `Exceeds the ${MAX_CATEGORIES}-category limit` }) };
        }
        for (const cat of body.categories) {
            if (typeof cat.id !== 'string' || typeof cat.name !== 'string' || !cat.id || !cat.name) {
                return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid categories format' }) };
            }
        }
        categories = body.categories.map(c => ({ id: c.id, name: c.name }));
        const validIds = new Set(categories.map(c => c.id));
        for (const [categoryId, memberIds] of Object.entries(body.categoryMembers)) {
            if (!validIds.has(categoryId) || !Array.isArray(memberIds)) continue;
            categoryMembers[categoryId] = memberIds.filter(id => seen.has(id));
        }
    }

    try {
        const store = getCollectionsStore();
        const updatedAt = new Date().toISOString();

        await store.setJSON(`full:${user.id}`, {
            id: user.id,
            username: user.username,
            collection,
            categories,
            categoryMembers,
            updatedAt,
        });

        const index = (await store.get('index', { type: 'json' })) || [];
        const existing = index.find(entry => entry.id === user.id);
        const filtered = index.filter(entry => entry.id !== user.id);
        // Tags are just the publisher's own category names, filtered to ones
        // that actually have beatmaps in them (an empty category tells a
        // gallery visitor nothing) and capped/deduped for the index's sake.
        const tags = [...new Set(
            categories
                .filter(c => (categoryMembers[c.id] || []).length > 0)
                .map(c => c.name.trim())
                .filter(Boolean)
        )].slice(0, MAX_INDEX_TAGS);
        filtered.push({
            id: user.id,
            username: user.username,
            totalSets: seen.size,
            maxRating,
            updatedAt,
            tags,
            // Likes belong to the collection slot, not any one publish —
            // carry the count forward across republishes instead of
            // resetting it, since collections-like.js maintains it separately.
            likeCount: (existing && existing.likeCount) || 0,
        });
        await store.setJSON('index', filtered);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, updatedAt }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
