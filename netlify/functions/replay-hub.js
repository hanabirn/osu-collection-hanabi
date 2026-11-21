/* The replay page's lists (js/replay/hub.js), fetched when a visitor asks:
   GET ?rankings=1&mode=osu|taiko|fruits|mania[&country=TW]
       the world's (or a country's) top 50 players (one osu! API v2 call, kept 6 hours)
   GET ?user=NAME_OR_ID&mode=…[&type=recent]
       the player and their best 100 scores (or their passes of the last 24
       hours), marked with whether osu! keeps a replay for each (two calls,
       kept 30 minutes; recent ones 2 minutes)
   Answers are kept in KV and the edge cache, so repeated looks don't reach
   osu! again (the API terms: on request, cached, no bulk harvesting). */
const { getOsuToken } = require('./_osu-auth');
const { getEnv } = require('./_cf-env');

const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MODES = ['osu', 'taiko', 'fruits', 'mania'];

const fail = (code, msg) => ({ statusCode: code, headers: { ...H, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: msg }) });

async function api(path) {
    const token = await getOsuToken();
    const res = await fetch(`https://osu.ppy.sh/api/v2/${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': '20240529' },
    });
    if (!res.ok) { const e = new Error(`osu! answered ${res.status}`); e.status = res.status; throw e; }
    return res.json();
}

const userOut = (u, stats) => ({
    id: u.id,
    name: u.username,
    country: u.country_code,
    avatar: u.avatar_url,
    cover: (u.cover && (u.cover.custom_url || u.cover.url)) || u.cover_url || null,
    rank: stats ? stats.global_rank : null,
    pp: stats ? stats.pp : null,
});

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
    const qs = event.queryStringParameters || {};
    const mode = MODES.includes(qs.mode) ? qs.mode : 'osu';
    const kv = getEnv()?.KV_RESP_CACHE ?? null;

    let key, ttl, build;
    if (qs.rankings) {
        const country = /^[A-Z]{2}$/.test(String(qs.country || '').toUpperCase()) ? String(qs.country).toUpperCase() : '';
        key = `replay-hub:v1:rank:${mode}:${country || 'ALL'}`;
        ttl = 6 * 3600;
        build = async () => {
            const data = await api(`rankings/${mode}/performance${country ? `?country=${country}` : ''}`);
            return { country: country || null, players: (data.ranking || []).slice(0, 50).map((r) => userOut(r.user, r)) };
        };
    } else if (qs.user) {
        const u = String(qs.user).trim();
        if (!u || u.length > 32) return fail(400, 'Missing or invalid user');
        const ref = /^\d{1,10}$/.test(u) ? u : `@${encodeURIComponent(u)}`;
        const recent = qs.type === 'recent';
        key = `replay-hub:v1:user:${recent ? 'recent' : 'best'}:${mode}:${u.toLowerCase()}`;
        ttl = recent ? 120 : 1800;
        build = async () => {
            const user = await api(`users/${ref}/${mode}`);
            const scores = await api(recent ? `users/${user.id}/scores/recent?mode=${mode}&limit=50` : `users/${user.id}/scores/best?mode=${mode}&limit=100`);
            return {
                user: userOut(user, user.statistics),
                scores: (scores || []).map((s) => ({
                    id: s.id,
                    replay: !!s.has_replay,
                    pp: s.pp,
                    acc: s.accuracy,
                    rank: s.rank,
                    combo: s.max_combo,
                    mods: (s.mods || []).map((m) => (typeof m === 'string' ? m : m.acronym)).filter((m) => m && m !== 'CL'),
                    ended: s.ended_at,
                    beatmap: s.beatmap ? { id: s.beatmap.id, version: s.beatmap.version, stars: s.beatmap.difficulty_rating } : null,
                    set: s.beatmapset ? { id: s.beatmapset.id, title: s.beatmapset.title, artist: s.beatmapset.artist } : null,
                })),
            };
        };
    } else return fail(400, 'Ask for rankings or a user');

    if (kv) {
        try { const hit = await kv.get(key); if (hit) return { statusCode: 200, headers: { ...H, 'Cache-Control': `public, max-age=${ttl}` }, body: hit }; } catch { /* ask osu! */ }
    }
    try {
        const body = JSON.stringify(await build());
        if (kv) { try { await kv.put(key, body, { expirationTtl: ttl }); } catch { /* fine */ } }
        return { statusCode: 200, headers: { ...H, 'Cache-Control': `public, max-age=${ttl}` }, body };
    } catch (err) {
        if (err.status === 404) return fail(404, 'No such player');
        console.error('replay-hub failed', err);
        return fail(502, 'Could not reach osu!');
    }
};
