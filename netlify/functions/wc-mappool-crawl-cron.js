/* Scheduled entry point for the World Cup mappool crawler — see netlify.toml
   for the cron declaration (weekly; the data is ~annual). Netlify does not
   expose scheduled functions over a public URL, so this needs no auth of its
   own; wc-mappool-crawl-run.js is the HTTP-reachable, secret-gated
   counterpart used to force the initial fill. See _wc-mappools-core.js. */
const { runCrawlBatch } = require('./_wc-mappools-core');

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
