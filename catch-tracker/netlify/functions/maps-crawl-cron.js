/* Scheduled entry point for the map catalog sweep — see netlify.toml for
   the cron declaration (every 30 min, matching the main site's Catalog
   crawler's cadence — this dataset only needs to keep pace with newly
   ranked/loved maps, nothing time-sensitive). No auth needed — Netlify
   doesn't expose scheduled functions over a public URL. See
   maps-crawl-run.js for the manual/backfill counterpart. */
const { runMapsCrawl } = require('./_maps-crawl-core');

const RUN_BUDGET_MS = 25000;

exports.handler = async () => {
    let result;
    try {
        result = await runMapsCrawl(RUN_BUDGET_MS);
    } catch (err) {
        result = { error: err.message };
    }
    return { statusCode: 200, body: JSON.stringify(result) };
};
