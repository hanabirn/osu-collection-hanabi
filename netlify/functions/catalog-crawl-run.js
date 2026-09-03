/* Manual/backfill trigger for the ranked-catalog crawler — same core logic
   as catalog-crawl-cron.js (see _catalog-crawl-core.js), but reachable over
   plain HTTP, so it requires a shared secret (CATALOG_CRAWL_SECRET env var)
   via the x-catalog-crawl-secret header. Call it a few times in a row right
   after setup to seed the dataset faster than the 15-minute cron cadence. */
const { runCrawlBatch } = require('./_catalog-crawl-core');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RUN_BUDGET_MS = 9000; // non-scheduled functions get a much shorter timeout than the scheduled budget

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const secret = event.headers['x-catalog-crawl-secret'] || event.headers['X-Catalog-Crawl-Secret'];
    if (!process.env.CATALOG_CRAWL_SECRET || secret !== process.env.CATALOG_CRAWL_SECRET) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        const result = await runCrawlBatch(RUN_BUDGET_MS);
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
