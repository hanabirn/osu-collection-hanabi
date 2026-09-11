/* Single-player profile: combines the cached rankings:TW record (avatar,
   rank, pp, accuracy) with a filtered slice of feed:recent (recent plays
   this tracker has already seen) and a LIVE, uncached call to
   GET /users/{id}/scores/best?mode=fruits&limit=100 for "best plays" — best
   lists change rarely enough per player that a second cache/de-dup layer
   isn't worth it for v1 (see catch-tracker's implementation plan). If the
   player isn't in the cached rankings (e.g. queried by id directly, not yet
   swept), falls back to a live GET /users/{id}/fruits call for basic
   profile info instead of failing outright. */
const { getOsuToken } = require('./_osu-auth');
const { getFeedStore, getRankingsStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');
const { MODE } = require('./_catch-constants');

// The live /scores/best response is shaped like a raw osu! API v2 Score
// object (nested beatmap/beatmapset, mods possibly as {acronym} objects) —
// normalize it to the same flat shape feed:recent records use, so
// render-player.js can render both lists with one function.
function isFC(s) {
    if (s.perfect === true || s.perfect === 1) return true;
    const st = s.statistics || {};
    const miss = st.count_miss ?? st.miss ?? null;
    return miss === 0;
}
function normalizeScore(score) {
    const bm = score.beatmap || {};
    const bms = score.beatmapset || bm.beatmapset || {};
    return {
        score_id: score.id,
        beatmap_id: bm.id ?? score.beatmap_id ?? null,
        beatmapset_id: bms.id ?? null,
        artist: bms.artist || null,
        title: bms.title || null,
        version: bm.version || null,
        creator: bms.creator || null,
        difficulty_rating: bm.difficulty_rating ?? null,
        mods: Array.isArray(score.mods) ? score.mods.map(m => (typeof m === 'string' ? m : m.acronym)) : [],
        rank: score.rank || null,
        accuracy: score.accuracy ?? null,
        max_combo: score.max_combo ?? null,
        pp: score.pp ?? null,
        is_fc: isFC(score),
        passed: score.passed !== false,
        created_at: score.created_at || null,
    };
}

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const userId = parseInt(qs.user_id, 10);
    if (!Number.isFinite(userId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id is required' }) };
    }

    try {
        const rankingsStore = getRankingsStore();
        const feedStore = getFeedStore();
        const token = await getOsuToken();

        const rankings = (await getJSONGz(rankingsStore, 'rankings:TW')) || [];
        let profile = rankings.find(r => r.user_id === userId) || null;

        if (!profile) {
            const res = await fetch(`https://osu.ppy.sh/api/v2/users/${userId}/${MODE}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            });
            if (res.ok) {
                const u = await res.json();
                const stats = u.statistics || {};
                profile = {
                    user_id: u.id, username: u.username,
                    country_code: u.country_code || (u.country && u.country.code) || null,
                    avatar_url: u.avatar_url || `https://a.ppy.sh/${u.id}`,
                    cover_url: (u.cover && u.cover.url) || null,
                    global_rank: stats.global_rank ?? null,
                    country_rank: stats.country_rank ?? null,
                    pp: stats.pp ?? null,
                    accuracy: stats.hit_accuracy ?? null,
                    play_count: stats.play_count ?? null,
                    level: (stats.level && stats.level.current) ?? null,
                    is_online: !!u.is_online, last_visit: u.last_visit || null,
                    updatedAt: new Date().toISOString(),
                };
            }
        }

        if (!profile) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'player not found' }) };
        }

        const feed = (await getJSONGz(feedStore, 'feed:recent')) || [];
        const recentPlays = feed.filter(r => r.user_id === userId).slice(0, 50);

        let bestPlays = [];
        try {
            const bestRes = await fetch(
                `https://osu.ppy.sh/api/v2/users/${userId}/scores/best?${new URLSearchParams({ mode: MODE, limit: '100' })}`,
                { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
            );
            if (bestRes.ok) bestPlays = (await bestRes.json()).map(normalizeScore);
        } catch {
            // best-plays is a live nice-to-have; profile still renders without it
        }

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=30' },
            body: JSON.stringify({ profile, recentPlays, bestPlays }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
