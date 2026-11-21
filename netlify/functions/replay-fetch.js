/* A score's replay (.osr) for the replay player, by score id.
   GET ?score=ID[&mode=osu|taiko|fruits|mania]
   Looks in the replay store first (R2 osu-replays, objects expire 90 days
   after they were stored); otherwise asks osu! API v2
   (/scores/{id}/download, or /scores/{mode}/{id}/download for legacy ids)
   once, keeps the file and returns it. Only when a visitor asks for a
   score, never in bulk, as the API's terms ask. */
const { getOsuToken } = require('./_osu-auth');
const { getEnv } = require('./_cf-env');

const H = { 'Access-Control-Allow-Origin': '*' };
const MODES = ['osu', 'taiko', 'fruits', 'mania'];
const fail = (statusCode, error) => ({ statusCode, headers: { ...H, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error }) });
const ok = (bytes, source) => ({
    statusCode: 200,
    headers: { ...H, 'Content-Type': 'application/x-osu-replay', 'Cache-Control': 'public, max-age=86400', 'X-Replay-Source': source },
    body: Buffer.from(bytes).toString('base64'),
    isBase64Encoded: true,
});

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
    const qs = event.queryStringParameters || {};
    const id = String(qs.score || '');
    if (!/^\d{1,12}$/.test(id)) return fail(400, 'Missing or invalid score id');
    const mode = MODES.includes(qs.mode) ? qs.mode : null;
    const key = mode ? `score/${mode}/${id}.osr` : `score/${id}.osr`;
    const bucket = getEnv()?.R2_REPLAYS ?? null;

    if (bucket) {
        try {
            const hit = await bucket.get(key);
            if (hit) return ok(new Uint8Array(await hit.arrayBuffer()), 'store');
        } catch { /* fall through to osu! */ }
    }

    try {
        const token = await getOsuToken();
        const path = mode ? `scores/${mode}/${id}/download` : `scores/${id}/download`;
        const res = await fetch(`https://osu.ppy.sh/api/v2/${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
        if (res.status === 404) return fail(404, 'This score has no online replay');
        if (!res.ok) return fail(502, `osu! answered ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < 32 || bytes[0] > 3) return fail(502, 'Not a replay file');
        if (bucket) {
            try { await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/x-osu-replay' } }); } catch { /* serve it anyway */ }
        }
        return ok(bytes, 'osu');
    } catch (err) {
        console.error('replay-fetch failed', err);
        return fail(500, 'Could not get the replay');
    }
};
