/* A beatmap's global top 50, for the replay player: its in-replay leaderboard
   shows them all, and the comparison picker the ones with an online replay
   (`replay`). GET ?b=BEATMAP_ID&mode=osu|taiko|fruits|mania. One osu! API v2
   call (/beatmaps/{id}/scores), kept for 10 minutes in KV. */
const { getOsuToken } = require('./_osu-auth');
const { getEnv } = require('./_cf-env');

const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MODES = ['osu', 'taiko', 'fruits', 'mania'];
const TTL = 600;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
    const qs = event.queryStringParameters || {};
    const b = String(qs.b || '');
    if (!/^\d{1,10}$/.test(b)) return { statusCode: 400, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Missing or invalid beatmap id' }) };
    const mode = MODES.includes(qs.mode) ? qs.mode : 'osu';
    const kv = getEnv()?.KV_RESP_CACHE ?? null;
    const cacheKey = `replay-scores:v2:${b}:${mode}`;
    if (kv) {
        try { const hit = await kv.get(cacheKey); if (hit) return { statusCode: 200, headers: { ...H, 'Cache-Control': `public, max-age=${TTL}` }, body: hit }; } catch { /* ask osu! */ }
    }
    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${b}/scores?mode=${mode}&limit=50`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': '20240529' },
        });
        if (!res.ok) return { statusCode: res.status === 404 ? 404 : 502, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: `osu! answered ${res.status}` }) };
        const data = await res.json();
        // all of the top 50: the player's in-replay leaderboard shows them all; the
        // comparison picker keeps the ones with a replay (`replay`)
        const scores = (data.scores || []).map((s) => ({
            id: s.id,
            replay: !!s.has_replay,
            legacyId: s.legacy_score_id || null,
            user: s.user ? { id: s.user.id, name: s.user.username, country: s.user.country_code, avatar: s.user.avatar_url } : null,
            acc: s.accuracy,
            pp: s.pp,
            combo: s.max_combo,
            score: s.legacy_total_score || s.total_score,
            legacy: s.legacy_total_score || 0, // stable's score (0: set on lazer only)
            total: s.total_score || 0,         // lazer's standardised score
            mods: (s.mods || []).map((m) => (typeof m === 'string' ? m : m.acronym)).filter((m) => m && m !== 'CL'),
            rank: s.rank,
            ended: s.ended_at,
        }));
        const body = JSON.stringify({ scores });
        if (kv) { try { await kv.put(cacheKey, body, { expirationTtl: TTL }); } catch { /* fine */ } }
        return { statusCode: 200, headers: { ...H, 'Cache-Control': `public, max-age=${TTL}` }, body };
    } catch (err) {
        console.error('replay-scores failed', err);
        return { statusCode: 500, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Could not list scores' }) };
    }
};
