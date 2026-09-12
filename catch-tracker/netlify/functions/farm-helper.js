/* Farm helper (刷圖助手): recommends specific maps by estimated pp gain,
   using a peer's own real achieved score as the recommendation target
   (mirrors mania-tracker.com's farm helper) rather than any difficulty/pp
   estimation — no rosu-pp-js or similar needed.

   Peer data comes from peer-bestplays:{user_id} (see _peer-crawl-core.js),
   a lean cache of each tracked player's own top-100 best plays, built up
   over time by peer-crawl-cron.js. This endpoint itself only makes ONE
   osu! API call (the target's own best plays, same call player-get.js
   already makes) — everything else is reads from our own cached data.

   PP-gain formula ported from netlify/functions/practice-generate.js (the
   main site's practice-collection generator, already implements osu!'s
   real weighted-pp-total math: weightedPpSum(topPpDesc) + bonusPp). bonusPp
   is constant per player and cancels out in a before/after delta, so the
   gain from inserting one candidate score is just the weighted-sum delta
   with no need to know the player's real total pp at all. */
const { getOsuToken } = require('./_osu-auth');
const { getRankingsStore, getPeerStore, getMapsStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');
const { MODE } = require('./_catch-constants');

const PEER_WINDOW_EACH_SIDE = 50; // ~100 peers total, per the approved plan
const MAX_RESULTS = 50;
// A peer median needs to beat the target's own pp on a map by more than
// this to count as "可提升" — filters out noise-level differences that
// aren't a meaningful recommendation.
const IMPROVE_MARGIN_PP = 3;

const weightedPpSum = (desc) => desc.reduce((sum, pp, i) => sum + pp * Math.pow(0.95, i), 0);

function median(nums) {
    const s = nums.slice().sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    const mid = n >> 1;
    return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function modAcronyms(mods) {
    return Array.isArray(mods) ? mods.map(m => (typeof m === 'string' ? m : m.acronym)) : [];
}

async function fetchTargetBestPlays(userId, token) {
    const res = await fetch(
        `https://osu.ppy.sh/api/v2/users/${userId}/scores/best?${new URLSearchParams({ mode: MODE, limit: '100' })}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`scores/best failed: ${res.status}`);
    const scores = await res.json();
    return Array.isArray(scores) ? scores : [];
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
        const peerStore = getPeerStore();
        const mapsStore = getMapsStore();

        const [rankings, maps, token] = await Promise.all([
            getJSONGz(rankingsStore, 'rankings:global').then(r => r || []),
            getJSONGz(mapsStore, 'maps:catch').then(m => m || []),
            getOsuToken(),
        ]);
        const mapIndex = new Map(maps.map(m => [m.beatmap_id, m]));

        const sortedRankings = [...rankings].sort((a, b) => (b.pp || 0) - (a.pp || 0));
        const myIndex = sortedRankings.findIndex(r => r.user_id === userId);

        const targetRaw = await fetchTargetBestPlays(userId, token);
        if (!targetRaw.length) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'no best plays found for this player' }) };
        }

        // Target's own best pp per beatmap_id (their max across mods, if a
        // beatmap appears more than once in their own top 100).
        const targetPpList = [];
        const targetBestByMap = new Map();
        for (const s of targetRaw) {
            const bm = s.beatmap || {};
            const beatmapId = bm.id ?? s.beatmap_id ?? null;
            const pp = s.pp ?? null;
            if (pp == null) continue;
            targetPpList.push(pp);
            if (beatmapId != null) {
                const prev = targetBestByMap.get(beatmapId);
                if (prev == null || pp > prev) targetBestByMap.set(beatmapId, pp);
            }
        }
        targetPpList.sort((a, b) => b - a);
        const baseWeighted = weightedPpSum(targetPpList);

        let peerWindow = [];
        let coveragePeers = 0;
        if (myIndex !== -1) {
            const lo = Math.max(0, myIndex - PEER_WINDOW_EACH_SIDE);
            const hi = Math.min(sortedRankings.length, myIndex + PEER_WINDOW_EACH_SIDE + 1);
            peerWindow = sortedRankings.slice(lo, hi).filter((_, i) => lo + i !== myIndex);
        }

        const peerRecords = await Promise.all(
            peerWindow.map(p => peerStore.get(`peer-bestplays:${p.user_id}`, { type: 'json' }).catch(() => null))
        );

        // beatmap_id -> array of peer pp values on it (best plays we've
        // cached for peers in the window).
        const perMapPeerPp = new Map();
        for (const record of peerRecords) {
            if (!record || !Array.isArray(record.bestPlays)) continue;
            coveragePeers++;
            for (const s of record.bestPlays) {
                if (s.beatmap_id == null || s.pp == null) continue;
                if (!perMapPeerPp.has(s.beatmap_id)) perMapPeerPp.set(s.beatmap_id, []);
                perMapPeerPp.get(s.beatmap_id).push(s);
            }
        }

        const candidates = [];
        for (const [beatmapId, peerScores] of perMapPeerPp) {
            const peerPpMedian = median(peerScores.map(s => s.pp));
            const ownPp = targetBestByMap.get(beatmapId);
            let category = null;
            if (ownPp == null) {
                category = 'new';
            } else if (peerPpMedian - ownPp > IMPROVE_MARGIN_PP) {
                category = 'improve';
            } else {
                continue;
            }

            // A new score for a beatmap you've already set a PB on
            // REPLACES that old entry in your top 100 (osu! only keeps
            // your best score per beatmap) — for "improve" candidates,
            // remove the one old ownPp entry before inserting the
            // hypothetical new one, rather than simulating both existing
            // at once.
            let base = targetPpList;
            if (category === 'improve') {
                const cut = targetPpList.indexOf(ownPp);
                base = cut === -1 ? targetPpList : [...targetPpList.slice(0, cut), ...targetPpList.slice(cut + 1)];
            }
            const merged = [...base, peerPpMedian].sort((a, b) => b - a).slice(0, 100);
            const gain = weightedPpSum(merged) - baseWeighted;
            if (gain <= 0) continue;

            // Reference row: the peer closest to the median (most
            // representative single example to show, rather than an
            // aggregate stat with no concrete score behind it).
            const ref = peerScores.slice().sort((a, b) => Math.abs(a.pp - peerPpMedian) - Math.abs(b.pp - peerPpMedian))[0];
            const mapMeta = mapIndex.get(beatmapId) || {};

            candidates.push({
                beatmap_id: beatmapId,
                category,
                gain: Math.round(gain * 10) / 10,
                peer_pp: Math.round(peerPpMedian * 10) / 10,
                own_pp: ownPp != null ? Math.round(ownPp * 10) / 10 : null,
                ref_mods: modAcronyms(ref.mods),
                ref_accuracy: ref.accuracy ?? null,
                ref_rank: ref.rank ?? null,
                title: mapMeta.title || null,
                artist: mapMeta.artist || null,
                version: mapMeta.version || null,
                difficulty_rating: mapMeta.difficulty_rating ?? null,
                beatmapset_id: mapMeta.beatmapset_id ?? null,
            });
        }

        candidates.sort((a, b) => b.gain - a.gain);

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=60' },
            body: JSON.stringify({
                items: candidates.slice(0, MAX_RESULTS),
                coverage: {
                    peerWindowSize: peerWindow.length,
                    peersCovered: coveragePeers,
                    inRankings: myIndex !== -1,
                },
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
