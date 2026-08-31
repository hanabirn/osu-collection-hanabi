/* Scheduled: for every stored push subscription, re-check each tracked
   player's total PP against the stored baseline and send a Web Push when it
   moved. This is the server-side twin of js/notifications.js's
   checkTrackedPlayers() — it runs even when nobody has the tab open, which
   is the whole point of push.

   Time-budgeted like farm-crawl-cron: it processes what it can in ~20s and
   picks up where it left off next run (state = which subs it has visited
   this cycle, kept on a `cursor` blob). osu! API v1 (get_user) via
   OSU_API_KEY — same as netlify/functions/osu.js.

   Only tracked-player PP for now. Mapper / tournament pushes would add
   their own check blocks here against fields on the same sub entry. */
const webpush = require('web-push');
const { getPushStore } = require('./_push-store');

const RUN_BUDGET_MS = 20000;
const PP_DELTA_THRESHOLD = 1;      // pp, matches the client
const CHUNK = 5;

function configured() {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function fetchTotalPp(id, apiKey) {
    let total = 0;
    for (const m of [0, 1, 2, 3]) {
        try {
            const r = await fetch(`https://osu.ppy.sh/api/get_user?k=${apiKey}&u=${id}&m=${m}&type=id`);
            if (!r.ok) continue;
            const arr = await r.json();
            if (arr && arr[0] && arr[0].pp_raw != null) total += parseFloat(arr[0].pp_raw);
        } catch { /* skip */ }
    }
    return total;
}

async function processSub(store, key, apiKey) {
    const entry = await store.get(key, { type: 'json' });
    if (!entry || !entry.subscription || !Array.isArray(entry.players) || !entry.players.length) return;

    let changed = false;
    const notes = [];
    for (const p of entry.players) {
        const now = await fetchTotalPp(p.id, apiKey);
        if (!now) continue;                                  // fetch failed — don't move the baseline
        const prev = p.lastPp || 0;
        const delta = Math.round(now) - Math.round(prev);
        if (Math.abs(delta) >= PP_DELTA_THRESHOLD && prev > 0) {
            notes.push({
                title: `${p.username || ('#' + p.id)} ${delta > 0 ? '+' : ''}${delta.toLocaleString()}pp`,
                body: `${Math.round(now).toLocaleString()}pp`,
                url: `https://osu-collection-hanabi.netlify.app/?osu_lookup=${p.id}`,
            });
        }
        p.lastPp = now;
        changed = true;
    }

    for (const n of notes) {
        try {
            await webpush.sendNotification(entry.subscription, JSON.stringify(n));
        } catch (err) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                await store.delete(key);                     // subscription expired
                return;
            }
        }
    }
    if (changed) {
        entry.updatedAt = new Date().toISOString();
        await store.setJSON(key, entry);
    }
}

exports.handler = async () => {
    if (!configured()) return { statusCode: 200, body: 'push not configured' };
    const apiKey = process.env.OSU_API_KEY;
    if (!apiKey) return { statusCode: 200, body: 'no OSU_API_KEY' };

    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
    );

    const store = getPushStore();
    const start = Date.now();

    // Round-robin cursor so a big subscriber list still gets full coverage
    // across successive runs instead of always starting from the top.
    const state = (await store.get('cursor', { type: 'json' })) || { i: 0 };
    let listing;
    try { listing = await store.list(); } catch { return { statusCode: 200, body: 'list failed' }; }
    const keys = (listing.blobs || []).map(b => b.key).filter(k => k !== 'cursor');
    if (!keys.length) return { statusCode: 200, body: 'no subscriptions' };

    let i = state.i % keys.length;
    let done = 0;
    while (Date.now() - start < RUN_BUDGET_MS && done < keys.length) {
        const batch = [];
        for (let n = 0; n < CHUNK && done < keys.length; n++, done++) {
            batch.push(processSub(store, keys[i % keys.length], apiKey).catch(() => {}));
            i++;
        }
        await Promise.all(batch);
    }
    await store.setJSON('cursor', { i: i % keys.length });
    return { statusCode: 200, body: `checked ${done}/${keys.length}` };
};
