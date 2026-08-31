/* Store / refresh / delete a Web Push subscription.

   POST { subscription, osuUserId, players:[{id,username?}] }
     -> upsert the entry (keyed by the subscription endpoint hash). The
        client re-POSTs whenever the tracked-players list changes so the
        cron always has a current list. `lastPp` is baselined here from a
        live fetch so the first cron run never fires a flood.
   DELETE { endpoint }
     -> remove the entry (client called unsubscribe()).

   Only tracked-player PP is checked for now — mapper / tournament pushes
   would extend the players array + push-cron with the same shape. */
const { getPushStore, subKey } = require('./_push-store');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_PLAYERS = 30;

async function fetchTotalPp(id) {
    const key = process.env.OSU_API_KEY;
    if (!key || !/^\d+$/.test(String(id))) return 0;
    let total = 0;
    for (const m of [0, 1, 2, 3]) {
        try {
            const r = await fetch(`https://osu.ppy.sh/api/get_user?k=${key}&u=${id}&m=${m}&type=id`);
            if (!r.ok) continue;
            const arr = await r.json();
            if (arr && arr[0] && arr[0].pp_raw != null) total += parseFloat(arr[0].pp_raw);
        } catch { /* skip this mode */ }
    }
    return total;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: '{"error":"bad json"}' }; }
    const store = getPushStore();

    if (event.httpMethod === 'DELETE') {
        if (!body.endpoint) return { statusCode: 400, headers: CORS, body: '{"error":"no endpoint"}' };
        try { await store.delete(subKey(body.endpoint)); } catch { /* already gone */ }
        return { statusCode: 200, headers: CORS, body: '{"ok":true}' };
    }

    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{"error":"method"}' };

    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return { statusCode: 400, headers: CORS, body: '{"error":"no subscription"}' };
    const osuUserId = /^\d+$/.test(String(body.osuUserId)) ? String(body.osuUserId) : null;
    if (!osuUserId) return { statusCode: 400, headers: CORS, body: '{"error":"no osu user"}' };

    const key = subKey(sub.endpoint);
    const prev = (await store.get(key, { type: 'json' })) || {};
    const prevPp = new Map((prev.players || []).map(p => [String(p.id), p.lastPp]));

    const incoming = Array.isArray(body.players) ? body.players.slice(0, MAX_PLAYERS) : [];
    const players = [];
    for (const p of incoming) {
        if (!/^\d+$/.test(String(p.id))) continue;
        let lastPp = prevPp.get(String(p.id));
        if (lastPp == null) lastPp = await fetchTotalPp(p.id);   // baseline a newly-added player
        players.push({ id: String(p.id), username: p.username || null, lastPp });
    }

    await store.setJSON(key, {
        subscription: sub,
        osuUserId,
        players,
        createdAt: prev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, tracked: players.length }) };
};
