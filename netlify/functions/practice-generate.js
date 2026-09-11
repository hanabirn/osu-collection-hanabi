/* Server-side practice-collection generator for the Discord bot's /practice.
   A self-contained port of the two farm-dataset-backed kinds from js/osu.js
   (generatePracticeCollection): 'push' 突破分 and 'goal' 目標圖池. The
   score-driven kinds (弱項 / 低準度 / 相似圖) stay site-only for now — they
   need recent-plays / per-map strain analysis this doesn't do.

   GET ?user=<name|id>&kind=push|goal&target=<pp>&mode=osu|taiko|fruits|mania
   -> { name, note, count, maps: [{ beatmapId, setId, artist, title, stars }] }

   Any of the four rulesets (default osu). The band math is ruleset-agnostic
   — it works off the user's best-score pp/star spread in that mode and the
   farm dataset for that mode. Coverage for taiko/catch/mania is thinner, so
   a narrow band there can come back "not enough coverage" (422). osu! API v2
   via the shared client-credentials token; farm-maps-list is hit once with a
   big `limit` so the whole thing is ~3 fetches. */
const { getOsuToken } = require('./_osu-auth');
const { MODE_INT } = require('./_osdb');

const MODES = new Set(['osu', 'taiko', 'fruits', 'mania']);
const N_MIN = 40;
const N_MAX = 60;
const GOOD_ACC = 0.95;

const median = (a) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!s.length) return 0;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (a, p) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!s.length) return 0;
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const weightedPpSum = (desc) => desc.reduce((sum, pp, i) => sum + pp * Math.pow(0.95, i), 0);
function ppNeededForTarget(desc, bonusPp, target) {
    let lo = 0, hi = 2000;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const merged = [...desc, mid].sort((a, b) => b - a).slice(0, 100);
        if (weightedPpSum(merged) + bonusPp < target) lo = mid; else hi = mid;
    }
    return hi;
}

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const fail = (code, msg) => ({ statusCode: code, headers, body: JSON.stringify({ error: msg }) });

    const qs = event.queryStringParameters || {};
    const user = (qs.user || '').trim();
    const kind = qs.kind === 'goal' ? 'goal' : 'push';
    const mode = MODES.has(qs.mode) ? qs.mode : 'osu';
    const target = parseFloat(qs.target);
    if (!user) return fail(400, 'user required');
    if (kind === 'goal' && !(Number.isFinite(target) && target > 0)) return fail(400, 'target required for goal');

    const proto = event.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${event.headers.host}`;

    try {
        const token = await getOsuToken();
        const auth = { headers: { Authorization: `Bearer ${token}` } };

        // Resolve + current total pp (for this mode) in one call.
        const uRes = await fetch(`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(user)}/${mode}?key=username`, auth);
        if (uRes.status === 404) return fail(404, 'user not found');
        if (!uRes.ok) return fail(502, 'osu! API user lookup failed');
        const u = await uRes.json();
        const currentTotal = (u.statistics && u.statistics.pp) || 0;

        const bRes = await fetch(`https://osu.ppy.sh/api/v2/users/${u.id}/scores/best?mode=${mode}&limit=100`, auth);
        if (!bRes.ok) return fail(502, 'osu! API best-scores failed');
        const best = await bRes.json();
        if (!best.length || best.length < 10) return fail(422, 'not enough top plays');

        const ppList = best.map(s => s.pp).filter(Number.isFinite).sort((a, b) => b - a);
        const stars = best.map(s => s.beatmap && s.beatmap.difficulty_rating).filter(Number.isFinite);
        const starMedian = median(stars);
        const star90 = percentile(stars, 90);
        const p100 = ppList[Math.min(99, ppList.length - 1)] || 0;
        const goodIds = new Set(best.filter(s => (s.accuracy || 0) >= GOOD_ACC).map(s => s.beatmap && s.beatmap.id));
        const haveSetIds = new Set(best.map(s => s.beatmapset && s.beatmapset.id));

        let band, note;
        if (kind === 'push') {
            band = {
                ppMin: p100, ppMax: p100 * 1.3,
                starMin: Math.max(0, starMedian - 0.7), starMax: starMedian + 0.7,
                sort: 'pp_desc',
            };
            note = `#100 ${Math.round(p100)}pp · ~${starMedian.toFixed(1)}★`;
        } else {
            if (currentTotal >= target) return fail(200, 'goal already reached');
            const bonusPp = Math.max(0, currentTotal - weightedPpSum(ppList));
            const needed = ppNeededForTarget(ppList, bonusPp, target);
            const starMax = star90 + 0.3;
            band = {
                ppMin: needed * 0.9, ppMax: needed * 1.6,
                starMin: Math.max(0, starMax - 1.5), starMax,
                sort: 'star_asc',
            };
            note = `${Math.round(currentTotal)} → ${Math.round(target)}pp · need ~${Math.round(needed)}pp/score`;
        }

        const fp = new URLSearchParams({
            mode, mods: 'NM', limit: '200', sort: band.sort,
            starMin: band.starMin.toFixed(2), starMax: band.starMax.toFixed(2),
            ppMin: band.ppMin.toFixed(1), ppMax: band.ppMax.toFixed(1),
        });
        const fRes = await fetch(`${origin}/.netlify/functions/farm-maps-list?${fp}`);
        if (!fRes.ok) return fail(502, 'farm-maps-list failed');
        const farm = await fRes.json();

        const seen = new Set();
        const maps = [];
        for (const r of farm.items || []) {
            const sid = parseInt(r.beatmapset_id, 10);
            const bid = parseInt(r.beatmap_id, 10);
            if (!sid || seen.has(sid) || haveSetIds.has(sid) || goodIds.has(bid)) continue;
            seen.add(sid);
            maps.push({ beatmapId: bid || 0, setId: sid, artist: r.artist || '', title: r.title || '', stars: r.star || 0 });
            if (maps.length >= N_MAX) break;
        }
        if (maps.length < N_MIN) return fail(422, 'not enough coverage in that band');

        const MODE_TAG = { osu: '', taiko: ' [taiko]', fruits: ' [catch]', mania: ' [mania]' };
        const name = (kind === 'goal'
            ? `Practice — goal ${Math.round(target)}pp`
            : `Practice — push (${u.username})`) + MODE_TAG[mode];
        return {
            statusCode: 200, headers,
            body: JSON.stringify({ name, note, count: maps.length, kind, mode: MODE_INT[mode], maps }),
        };
    } catch (err) {
        return fail(500, err.message);
    }
};
