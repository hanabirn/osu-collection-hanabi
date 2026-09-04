/* Manual/backfill trigger for the World Cup mappool crawler — same core
   logic as wc-mappool-crawl-cron.js (see _wc-mappools-core.js), but
   reachable over plain HTTP, so it requires a shared secret
   (WC_MAPPOOL_CRAWL_SECRET env var) via the x-wc-mappool-crawl-secret
   header. Call it a handful of times right after setup to seed the dataset
   (phase 1 finishes in one call; the beatmap-metadata backfill takes a few
   more) rather than waiting for the weekly cron. */
const { runCrawlBatch } = require('./_wc-mappools-core');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RUN_BUDGET_MS = 9000; // non-scheduled functions get a much shorter timeout than the scheduled budget

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const secret = event.headers['x-wc-mappool-crawl-secret'] || event.headers['X-Wc-Mappool-Crawl-Secret'];
    if (!process.env.WC_MAPPOOL_CRAWL_SECRET || secret !== process.env.WC_MAPPOOL_CRAWL_SECRET) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        const result = await runCrawlBatch(RUN_BUDGET_MS);
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
