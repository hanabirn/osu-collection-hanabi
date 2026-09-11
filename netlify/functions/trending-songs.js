/* 全站熱門新曲: site-wide "trending new songs" widget, distinct from the
   personal 今日推薦 banner (renderFeaturedBeatmap() in js/osu.js, which only
   ever picks from sets already in the visitor's own collection) — this pulls
   from the WHOLE ranked catalog so it surfaces things a visitor hasn't found
   yet.

   GET -> { date, items: [{ setId, artist, title, creator, coverUrl,
            favouriteCount, starMax, genreId, languageId }] }

   catalog:all (built by _catalog-crawl-core.js) doesn't store favourite_count
   — the crawler never needed it, and adding the field would mean waiting on
   a full re-sweep to backfill 55k+ existing records. Same shortcut
   games-daily.js's buildPuzzle() already takes instead: filter candidates
   locally, then do live per-candidate osu! API lookups. Result is cached
   once per UTC day in the osu-games store (same "<feature>:<date>" shape as
   games-daily's `daily:<date>`) — only the first visitor of the day pays for
   the live lookups. */
const { getGamesStore, getCatalogStore } = require('./_blobs-store');
const { getJSONGz } = require('./_blob-json');
const { getOsuToken } = require('./_osu-auth');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const WANT = 8;
const CANDIDATE_TRIES = 15;
const WINDOWS_DAYS = [30, 60, 90]; // widen if the young/still-growing dataset is thin

function today() { return new Date().toISOString().slice(0, 10); }

async function resolveSet(id, token) {
    try {
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function candidatesWithin(dataset, days) {
    const cutoff = Date.now() - days * 86400000;
    return dataset.filter(r =>
        r.id && !r.nsfw && Array.isArray(r.modes) && r.modes.includes(0) &&
        (r.primary_artist || r.artist) && (r.title_unicode || r.title) &&
        r.ranked_date && new Date(r.ranked_date).getTime() >= cutoff);
}

async function buildTrending() {
    const dataset = (await getJSONGz(getCatalogStore(), 'catalog:all')) || [];

    let cands = [];
    for (const days of WINDOWS_DAYS) {
        cands = candidatesWithin(dataset, days);
        if (cands.length >= 10) break;
    }
    if (!cands.length) return { date: today(), items: [] };

    // Fisher-Yates, then take a bounded number of live-lookup tries.
    for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cands[i], cands[j]] = [cands[j], cands[i]];
    }

    const token = await getOsuToken();
    const resolved = [];
    const seen = new Set();
    for (const rec of cands.slice(0, CANDIDATE_TRIES)) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        const set = await resolveSet(rec.id, token);
        if (!set || !set.covers) continue;
        resolved.push({
            setId: set.id,
            artist: set.artist_unicode || set.artist || '',
            title: set.title_unicode || set.title || '',
            creator: set.creator || '',
            coverUrl: set.covers.card || set.covers['card@2x'] || set.covers.cover || '',
            favouriteCount: set.favourite_count || 0,
            starMax: Math.max(0, ...(set.beatmaps || []).map(b => b.difficulty_rating || 0)),
            genreId: (set.genre && set.genre.id) || set.genre_id || null,
            languageId: (set.language && set.language.id) || set.language_id || null,
        });
    }

    resolved.sort((a, b) => b.favouriteCount - a.favouriteCount);
    return { date: today(), items: resolved.slice(0, WANT) };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'GET only' }) };

    try {
        const store = getGamesStore();
        const key = `trending:${today()}`;
        let data = await store.get(key, { type: 'json' });
        if (!data || !Array.isArray(data.items)) {
            data = await buildTrending();
            await store.setJSON(key, data);
        }
        return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=1800' }, body: JSON.stringify(data) };
    } catch (err) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
};
