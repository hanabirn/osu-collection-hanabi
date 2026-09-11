/* Shared knobs for the catch (osu!fruits) tracker. v1 is deliberately scoped
   to a single country to keep the score-poll crawl small — see
   docs in _scores-poll-core.js / _rankings-crawl-core.js for how the
   design degrades gracefully if COUNTRY's ranked player pool turns out
   bigger than expected. */
const MODE = 'fruits';
const MODE_NUM = 2; // osu! API v2 ruleset id for fruits/catch
const COUNTRY = 'TW';

// Statuses swept by the maps catalog crawler, in order — see
// _maps-crawl-core.js. osu! API v2's /beatmapsets/search `s` param takes
// one status per request, so these are crawled as separate passes.
const MAP_STATUSES = ['ranked', 'loved'];

// Ring-buffer cap for feed:recent — old entries just fall off the end.
const FEED_CAP = 2000;

// Per-player de-dup cache: how many recent score ids to remember so a
// re-poll doesn't re-emit the same score into the feed.
const LAST_SEEN_CAP = 100;

// Score-poll round-robin: item-count cap per invocation, on top of the
// wall-clock budgetMs cap (two independent levers, same as
// crawlWybinMappools's {budgetMs, perRun} in the main site's
// _community-mappools-shared.js). Sized generously above the assumed TW
// catch pool (well under a few hundred players) so a normal tick sweeps the
// whole pool; if the real pool is bigger, coverage just spans more ticks
// instead of breaking — see scores-poll-state's playersPolledThisSweep/
// totalPlayers fields.
const SCORE_POLL_PER_RUN_CRON = 300;
const SCORE_POLL_PER_RUN_MANUAL = 30;

const VALID_GRADES = new Set(['XH', 'X', 'SH', 'S', 'A', 'B', 'C', 'D', 'F']);

module.exports = {
    MODE, MODE_NUM, COUNTRY, MAP_STATUSES, FEED_CAP, LAST_SEEN_CAP,
    SCORE_POLL_PER_RUN_CRON, SCORE_POLL_PER_RUN_MANUAL,
    VALID_GRADES,
};
