/* 收藏收件匣: maps queued from Discord (the bot's ➕ 加入收藏 button, see
   discord-interactions.js addToCollectionInbox) for an osu! account. The
   site's collection lives in the visitor's browser, so the bot can't
   write to it; it leaves the beatmapset ids here, under the account the
   Discord user linked with /link, and the site takes them on sign-in.

   GET  -> { items: [beatmapsetId, ...] } for the signed-in account
   POST { done: [beatmapsetId, ...] } -> removes those (after the site has
        added them), { left: n }

   Identity comes from the signed login token (_auth-token.js), sent as
   Authorization: Bearer, so nobody can read or clear someone else's. */
const { getDiscordBotStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
    const h = event.headers || {};
    const auth = h.authorization || h.Authorization || '';
    const user = verifyAuthToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!user) return reply(401, { error: 'sign in required' });

    const store = getDiscordBotStore();
    const key = `inbox:${user.id}`;
    let list = [];
    try { list = (await store.get(key, { type: 'json' })) || []; } catch { list = []; }

    if (event.httpMethod === 'GET') {
        return reply(200, { items: list.map((x) => x.s).filter((n) => Number.isInteger(n) && n > 0) });
    }
    if (event.httpMethod === 'POST') {
        let done = [];
        try { done = (JSON.parse(event.body || '{}').done || []).map(Number); } catch { done = []; }
        const doneSet = new Set(done);
        const left = list.filter((x) => !doneSet.has(x.s));
        if (left.length) await store.setJSON(key, left);
        else await store.delete(key);
        return reply(200, { left: left.length });
    }
    return reply(405, { error: 'method not allowed' });
};
