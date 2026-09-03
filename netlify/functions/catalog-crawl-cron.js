/* Scheduled entry point for the ranked-catalog metadata crawler — see
   netlify.toml for the cron declaration (every 15 minutes) and
   _catalog-crawl-core.js for the logic. Netlify does not expose scheduled
   functions over a public URL, so this needs no auth of its own; the
   HTTP-reachable counterpart (catalog-crawl-run.js) is secret-gated.

   One pass covers all four rulesets, so unlike farm-crawl-cron.js there's no
   per-mode round-robin here. */
const { runCrawlBatch } = require('./_catalog-crawl-core');

const RUN_BUDGET_MS = 25000;

exports.handler = async () => {
    let result;
    try {
        result = await runCrawlBatch(RUN_BUDGET_MS);
    } catch (err) {
        result = { error: err.message };
    }
    return { statusCode: 200, body: JSON.stringify(result) };
};
