/* Scheduled: auto-fill 社群賽圖分享 pools from wyBin's own mappool data.
   Walks wyBin's tournament list a page at a time (cursor in
   `wybin-crawl-state`) and, for any tournament that has actually filled its
   pool in wyBin, creates the matching community pool(s). Never touches a
   pool that already exists, so manual edits are safe. See
   _community-mappools-shared.js crawlWybinMappools(). Schedule in
   netlify.toml. Kick a faster backfill via community-mappools-crawl-run.js. */
const { getCommunityMappoolsStore } = require('./_blobs-store');
const { crawlWybinMappools } = require('./_community-mappools-shared');

exports.handler = async () => {
    try {
        const result = await crawlWybinMappools(getCommunityMappoolsStore(), { budgetMs: 25000, perRun: 12 });
        return { statusCode: 200, body: JSON.stringify(result) };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
