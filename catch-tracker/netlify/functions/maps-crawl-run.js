/* Manual/backfill trigger for the map catalog sweep — same core logic as
   maps-crawl-cron.js (see _maps-crawl-core.js), but reachable over plain
   HTTP, so it requires a shared secret (CATCH_TRACKER_CRAWL_SECRET env
   var) via the x-catch-tracker-secret header. Used to seed maps:catch
   right after this feature ships, rather than waiting on the 30-min cron. */
const { runMapsCrawl } = require('./_maps-crawl-core');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RUN_BUDGET_MS = 9000; // regular (non-scheduled) functions get a much shorter timeout than the 30s scheduled budget

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const secret = event.headers['x-catch-tracker-secret'] || event.headers['X-Catch-Tracker-Secret'];
    if (!process.env.CATCH_TRACKER_CRAWL_SECRET || secret !== process.env.CATCH_TRACKER_CRAWL_SECRET) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        const result = await runMapsCrawl(RUN_BUDGET_MS);
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
