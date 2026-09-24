/* Higher-or-Lower mini-game data feed. GET -> a shuffled batch of farm-map
   records with just the fields the client needs to run rounds locally
   (SR / BPM / length / farm-PP / playcount). No auth, no state — the client
   keeps the streak; a personal best is stored via games-daily's streak
   endpoint pattern only if we add a leaderboard later.

   讀的是爬蟲預先算好的精簡切片（見 _farm-views.js），不是整包
   dataset:<mode>。原本每次請求都要解壓並解析 46.8 MB、對 45,553 筆洗牌，
   只為了回傳 60 筆 —— 在 Cloudflare Workers 免費版的 10ms CPU 額度下，
   實測 8 次有 7 次回 error 1102。現在只讀一片（約 92 KB）。 */
const { getFarmMapsStore } = require('./_blobs-store');
const { hiloMetaKey, hiloShardKey } = require('./_farm-views');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const BATCH = 60;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

    try {
        const store = getFarmMapsStore();
        const mode = 'osu';

        const meta = await store.get(hiloMetaKey(mode), { type: 'json' });
        if (!meta || !meta.shardCount) {
            /* 切片還沒產生（爬蟲尚未跑過新版）。回 503 而不是 500：
               這是「暫時還沒準備好」，不是程式錯誤。 */
            return {
                statusCode: 503,
                headers: { ...CORS, 'Cache-Control': 'no-store', 'Retry-After': '600' },
                body: JSON.stringify({ error: 'hilo pool not built yet' }),
            };
        }

        /* 切片在產生時已經全域洗過牌，所以任一片都是全域隨機樣本；
           每次隨機挑一片，跨請求就有變化。 */
        const index = Math.floor(Math.random() * meta.shardCount);
        const shard = (await store.get(hiloShardKey(mode, index), { type: 'json' })) || [];

        const rounds = shard.slice();
        for (let i = rounds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rounds[i], rounds[j]] = [rounds[j], rounds[i]];
        }

        return {
            statusCode: 200,
            headers: { ...CORS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ rounds: rounds.slice(0, BATCH), poolSize: meta.poolSize }),
        };
    } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
};
