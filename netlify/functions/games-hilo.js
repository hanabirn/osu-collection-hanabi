/* Higher-or-Lower mini-game data feed. GET -> a shuffled batch of farm-map
   records with just the fields the client needs to run rounds locally
   (SR / BPM / length / farm-PP / playcount). No auth, no state — the client
   keeps the streak; a personal best is stored via games-daily's streak
   endpoint pattern only if we add a leaderboard later. Reads the whole
   `dataset:osu` blob once per call (same as farm-maps-list). */
const { getFarmMapsStore } = require('./_blobs-store');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const BATCH = 60;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

    try {
        const store = getFarmMapsStore();
        const dataset = (await store.get('dataset:osu', { type: 'json' })) || [];

        const pool = [];
        for (const r of dataset) {
            const sr = r.stars && Number.isFinite(r.stars.NM) ? r.stars.NM : null;
            const pp = r.pp && Number.isFinite(r.pp.NM) ? r.pp.NM : null;
            const plays = (r.farmSignal && r.farmSignal.playcount) || 0;
            if (!r.beatmapset_id || !r.title || !r.bpm || !r.total_length || sr == null || pp == null || plays <= 0) continue;
            pool.push({
                setId: r.beatmapset_id,
                bid: r.beatmap_id || null,
                artist: r.artist || '',
                title: r.title || '',
                creator: r.creator || '',
                version: r.version || '',
                sr: Math.round(sr * 100) / 100,
                bpm: Math.round(r.bpm),
                len: r.total_length,
                pp: Math.round(pp),
                plays,
            });
        }

        // Fisher–Yates, take a batch.
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        return {
            statusCode: 200,
            headers: { ...CORS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ rounds: pool.slice(0, BATCH), poolSize: pool.length }),
        };
    } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
};
