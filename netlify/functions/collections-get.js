/* Full published-collection payload for one user, fed straight into
   mergeIncomingCollection() (js/osu.js) by the gallery's download/import
   action — no auth required, this is public data by definition. */
const { getCollectionsStore } = require('./_blobs-store');
const { normalizeCategoryIds } = require('./_category-id');

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

    const id = (event.queryStringParameters || {}).id;
    if (!id || !/^\d+$/.test(id)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid id' }) };
    }

    try {
        const store = getCollectionsStore();
        const data = await store.get(`full:${id}`, { type: 'json' });
        if (!data) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
        }
        /* Collections published before ids were validated may still hold
           arbitrary strings; normalize on the way out too. */
        if (Array.isArray(data.categories)) {
            const normalized = normalizeCategoryIds(data.categories, data.categoryMembers);
            data.categories = normalized.categories;
            data.categoryMembers = normalized.categoryMembers;
        }
        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=30' },
            body: JSON.stringify(data),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
