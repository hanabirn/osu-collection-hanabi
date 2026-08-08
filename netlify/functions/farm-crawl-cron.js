/* Scheduled entry point for the Farm Maps crawler — see netlify.toml for
   the cron declaration (every 10 minutes). Netlify does not
   expose scheduled functions over a public URL at all (only cron or the
   Netlify UI/CLI can invoke them), so this file needs no auth gating of
   its own; see farm-crawl-run.js for the manual/backfill counterpart that
   IS reachable over HTTP and therefore is secret-gated.

   One mode per invocation (not all 4) to stay comfortably inside the 30s
   scheduled-function execution budget — round-robins via a `nextMode`
   pointer stored alongside the per-mode crawl state. */
const { runCrawlBatch, MODES } = require('./_farm-crawl-core');
const { getFarmMapsStore } = require('./_blobs-store');

const RUN_BUDGET_MS = 25000;

exports.handler = async () => {
    const store = getFarmMapsStore();
    const modeIndex = (await store.get('crawl-next-mode', { type: 'json' })) || 0;
    const mode = MODES[modeIndex % MODES.length];

    let result;
    try {
        result = await runCrawlBatch(mode, RUN_BUDGET_MS);
    } catch (err) {
        result = { mode, error: err.message };
    }

    await store.setJSON('crawl-next-mode', (modeIndex + 1) % MODES.length);

    return { statusCode: 200, body: JSON.stringify(result) };
};
