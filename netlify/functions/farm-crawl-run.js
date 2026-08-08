/* Manual/backfill trigger for the Farm Maps crawler — same core logic as
   the scheduled farm-crawl-cron.js (see _farm-crawl-core.js), but reachable
   over plain HTTP, so it requires a shared secret (FARM_CRAWL_SECRET env
   var) via the x-farm-crawl-secret header. Two uses: (1) a fallback if
   Netlify Scheduled Functions turn out to be unavailable/too coarse on
   this project's plan — point an external cron (e.g. cron-job.org) at this
   instead; (2) calling it a few times in a row right after setup to seed
   the dataset faster than waiting on the 10-minute cron cadence. */
const { runCrawlBatch, MODE_NUM } = require('./_farm-crawl-core');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RUN_BUDGET_MS = 9000; // regular (non-scheduled) functions get a much shorter timeout than the 30s scheduled budget

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const secret = event.headers['x-farm-crawl-secret'] || event.headers['X-Farm-Crawl-Secret'];
    if (!process.env.FARM_CRAWL_SECRET || secret !== process.env.FARM_CRAWL_SECRET) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const qs = event.queryStringParameters || {};
    const mode = MODE_NUM[qs.mode] !== undefined ? qs.mode : 'osu';

    try {
        const result = await runCrawlBatch(mode, RUN_BUDGET_MS);
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
