/* Lean, columnar copy of the ranked/loved catalog for the browser.
 *
 * Why it exists: catalog-list.js gunzips and JSON.parses the whole
 * catalog:all dataset (~26 MB of JSON, 59k sets) on every request — about
 * 150-230 ms of CPU. The free Workers plan allows 10 ms per request, so
 * most catalog requests died with Error 1102 ("載入曲庫失敗"). Instead the
 * crawler (a cron, which gets a far larger CPU allowance) writes this lean
 * copy after every run, the Worker streams it to the browser untouched
 * (worker/catalog-data.js), and js/catalog.js does the filtering, sorting
 * and facet counts client-side.
 *
 * Format: one array per field, index i across all arrays = one set.
 * Only the fields the catalog / global search / smart categories read are
 * kept, and values that usually repeat another field are stored as 0:
 *   au  artist_unicode   0 = same as artist
 *   tu  title_unicode    0 = same as title
 *   pa  primary_artist   0 = same as artist
 *   ak  artist_keys      0 = [primary artist], null = none
 *   rd  ranked_date      unix seconds, 0 = missing
 *   m   modes            bitmask, bit n = ruleset n
 *   st  status           1 = loved, 0 = ranked (or crawled before loved existed)
 * Stars stay at full precision: rounding them moved sets across the star
 * slider's bounds and changed what toFixed(2) showed (1.575 -> "1.58"
 * instead of "1.57"), and costs only ~0.2 MB gzipped to avoid.
 * decodeCatalogLean() in js/catalog.js is the inverse; bump `v` if the
 * layout changes. */
const { gzipSync } = require('node:zlib');

const LEAN_KEY = 'catalog:lean';
const META_KEY = 'catalog:meta';
const LEAN_VERSION = 1;

function buildLeanCatalog(dataset, coverage) {
    const cols = {
        v: LEAN_VERSION,
        coverage: coverage || null,
        id: [], a: [], au: [], t: [], tu: [], c: [], s: [], g: [], l: [], x: [],
        rd: [], m: [], s0: [], s1: [], d: [], st: [], pa: [], ak: [],
    };
    for (const r of dataset) {
        const artist = r.artist || '';
        const title = r.title || '';
        const primary = r.primary_artist || artist;
        const keys = r.artist_keys;
        cols.id.push(r.id);
        cols.a.push(artist);
        cols.au.push(r.artist_unicode && r.artist_unicode !== artist ? r.artist_unicode : 0);
        cols.t.push(title);
        cols.tu.push(r.title_unicode && r.title_unicode !== title ? r.title_unicode : 0);
        cols.c.push(r.creator || '');
        cols.s.push(r.source || '');
        cols.g.push(r.genre_id ?? null);
        cols.l.push(r.language_id ?? null);
        cols.x.push(r.nsfw ? 1 : 0);
        const ranked = r.ranked_date ? Date.parse(r.ranked_date) : NaN;
        cols.rd.push(Number.isFinite(ranked) ? Math.round(ranked / 1000) : 0);
        cols.m.push(Array.isArray(r.modes) ? r.modes.reduce((mask, mode) => mask | (1 << mode), 0) : 0);
        cols.s0.push(r.star_min ?? null);
        cols.s1.push(r.star_max ?? null);
        cols.d.push(r.diff_count ?? null);
        cols.st.push(r.status === 'loved' ? 1 : 0);
        cols.pa.push(r.primary_artist && r.primary_artist !== artist ? r.primary_artist : 0);
        cols.ak.push(!Array.isArray(keys) ? null : keys.length === 1 && keys[0] === primary ? 0 : keys);
    }
    return cols;
}

/* The count the home page hero shows: what an unfiltered catalog query
   returns (ranked + loved, 18+ excluded by default). */
function sfwCount(dataset) {
    let n = 0;
    for (const r of dataset) if (!r.nsfw) n++;
    return n;
}

/* The headline numbers, as their own tiny object so `?meta=1` (the home
   page count) never touches the ~2.7 MB index. A separate object rather
   than R2 customMetadata because `wrangler r2 object put` can't set
   metadata, and that is how an out-of-Worker crawler would upload. */
function buildCatalogMeta(dataset, coverage) {
    return { total: sfwCount(dataset), datasetSize: dataset.length, coverage: coverage || null };
}

/* Lean index written gzipped: the Worker serves the bytes as-is with
   Content-Encoding: gzip. */
function gzipLeanCatalog(dataset, coverage) {
    return gzipSync(Buffer.from(JSON.stringify(buildLeanCatalog(dataset, coverage))));
}

async function writeLeanCatalog(store, dataset, coverage) {
    const gz = gzipLeanCatalog(dataset, coverage);
    await store.set(LEAN_KEY, new Blob([gz]));
    await store.setJSON(META_KEY, buildCatalogMeta(dataset, coverage));
    return gz.length;
}

/* The coverage block catalog-list.js used to return, from crawler state. */
function coverageFromState(state, datasetSize) {
    return {
        datasetSize,
        discoveredCount: state.discoveredCount || 0,
        sweepCount: state.sweepCount || 0,
        lastRunAt: state.lastRunAt || null,
        lastOkAt: state.lastOkAt || null,
        lastError: state.lastError || null,
        consecutiveWriteFails: state.consecutiveWriteFails || 0,
    };
}

module.exports = {
    LEAN_KEY,
    META_KEY,
    LEAN_VERSION,
    buildLeanCatalog,
    buildCatalogMeta,
    gzipLeanCatalog,
    writeLeanCatalog,
    coverageFromState,
    sfwCount,
};
