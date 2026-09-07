/* Manual trigger for the wyBin mappool crawler (same core as
   community-mappools-crawl-cron.js). Requires the WYBIN_MAPPOOL_CRAWL_SECRET
   env var via the x-crawl-secret header. Call it a few times in a row to
   sweep the whole wyBin list faster than waiting on the cron. */
const { getCommunityMappoolsStore } = require('./_blobs-store');
const { crawlWybinMappools } = require('./_community-mappools-shared');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const RUN_BUDGET_MS = 8500;

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const secret = event.headers['x-crawl-secret'] || event.headers['X-Crawl-Secret'];
    if (!process.env.WYBIN_MAPPOOL_CRAWL_SECRET || secret !== process.env.WYBIN_MAPPOOL_CRAWL_SECRET) {
        return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
        const result = await crawlWybinMappools(getCommunityMappoolsStore(), { budgetMs: RUN_BUDGET_MS, perRun: 3 });
        return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
