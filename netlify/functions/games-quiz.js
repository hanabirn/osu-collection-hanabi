/* 分類快問快答 data feed — a 60-second genre quick-fire. GET returns a
   shuffled batch of ranked sets that have a definite genre (one of the
   common buckets), plus the bucket list for the answer buttons. The client
   runs the timer and scoring locally. Reads `catalog:all` once per call. */
const { getCatalogStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const BATCH = 50;

// The genre ids worth quizzing on (skips 1 Unspecified / 6 Other so a wrong
// answer is never "well it could be Other").
const GENRES = {
    2: 'Video Game', 3: 'Anime', 4: 'Rock', 5: 'Pop',
    7: 'Novelty', 9: 'Hip Hop', 10: 'Electronic', 11: 'Metal', 12: 'Classical',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

    try {
        const store = getCatalogStore();
        const dataset = (await getJSONGz(store, 'catalog:all')) || [];

        const pool = [];
        for (const r of dataset) {
            if (!r.id || r.nsfw || !GENRES[r.genre_id]) continue;
            if (!Array.isArray(r.modes) || !r.modes.includes(0)) continue;
            if (!(r.title_unicode || r.title)) continue;
            pool.push({
                setId: r.id,
                artist: r.artist || '',
                title: r.title || '',
                genreId: r.genre_id,
            });
        }
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        return {
            statusCode: 200,
            headers: { ...CORS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({
                rounds: pool.slice(0, BATCH),
                genres: Object.entries(GENRES).map(([id, name]) => ({ id: Number(id), name })),
                poolSize: pool.length,
            }),
        };
    } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
};
