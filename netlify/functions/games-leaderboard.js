/* Shared high-score board for the client-run mini-games (Higher or Lower,
   Genre quiz — see js/games.js). One small array per game in the osu-games
   Blobs store under `leaderboard:<game>`, capped, sorted desc.

   GET  ?game=hilo|quiz            -> { game, entries: [{ id, username, score, at }] } (top 20)
   POST ?game=hilo|quiz  { score } -> upsert the caller's personal best (auth
                                     required — the signed osu! identity token,
                                     same as games-daily.js), returns the board.

   No per-user rate limiting: a write only lands when it beats the caller's
   own stored best, and the payload is a ~50-row array. */
const { getGamesStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const GAMES = new Set(['hilo', 'quiz']);
const MAX_ENTRIES = 50;
const TOP_N = 20;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function authUser(event) {
    const h = event.headers || {};
    const raw = h.authorization || h.Authorization || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    return token ? verifyAuthToken(token) : null;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const game = (event.queryStringParameters || {}).game;
    if (!GAMES.has(game)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'unknown game' }) };
    }

    const store = getGamesStore();
    const key = `leaderboard:${game}`;

    if (event.httpMethod === 'GET') {
        const board = (await store.get(key, { type: 'json' })) || [];
        return {
            statusCode: 200,
            headers: { ...CORS, 'Cache-Control': 'no-store' },
            body: JSON.stringify({ game, entries: board.slice(0, TOP_N) }),
        };
    }

    if (event.httpMethod === 'POST') {
        const user = authUser(event);
        if (!user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'login required' }) };

        let score = 0;
        try { score = Math.floor(Number(JSON.parse(event.body || '{}').score) || 0); } catch { score = 0; }
        score = Math.max(0, Math.min(100000, score));

        const board = (await store.get(key, { type: 'json' })) || [];
        const existing = board.find(e => String(e.id) === String(user.id));

        if (score > 0 && (!existing || score > existing.score)) {
            const next = board.filter(e => String(e.id) !== String(user.id));
            next.push({
                id: String(user.id),
                username: user.username || `#${user.id}`,
                score,
                at: new Date().toISOString(),
            });
            next.sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
            const capped = next.slice(0, MAX_ENTRIES);
            await store.setJSON(key, capped);
            return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, updated: true, entries: capped.slice(0, TOP_N) }) };
        }

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, updated: false, entries: board.slice(0, TOP_N) }) };
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
};
