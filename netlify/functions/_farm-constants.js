/* Shared constants for the Farm Maps feature, split out from
   _farm-crawl-core.js so that farm-maps-list.js (a plain read-only Blobs
   query, no PP computation) doesn't have to pull in rosu-pp-js — and its
   WASM binary's included_files bundling requirement — just to read a couple
   of arrays. Only _farm-crawl-core.js needs the actual rosu-pp-js engine. */
// Lowest difficulty the crawler indexes. Dropped 5.5 -> 4.5 (2026-09-07) so
// the dataset covers lower-pp "farm" territory (~100-150pp NM) that beginners
// actually play, not just the intermediate+ band. Widening this means a
// bigger dataset and a full re-sweep of the search cursor (reset to null on
// the same change) before coverage is complete.
const STAR_FLOOR = 4.5;
const MOD_COMBOS = ['', 'DT', 'HD', 'HDDT', 'HR', 'HDHR'];
const COMPUTE_ACCURACY = 100;
const MODE_NUM = { osu: 0, taiko: 1, fruits: 2, mania: 3 };
const MODES = Object.keys(MODE_NUM);

/* "Is this actually a farm map" heuristic (as opposed to just any ranked
   map >= STAR_FLOOR, which is all the crawler filters on above). The signal
   is mode-specific, because what "the community is farming this for pp"
   looks like differs by ruleset:
     - osu! / taiko: >= 70% of the top-50 leaderboard set with DT/NC (incl.
       HDDT) — the classic pp-cheese pattern.
     - catch / mania: >= 70% of the top-50 got 100% accuracy — these
       rulesets have no score-multiplying difficulty mod, so a farm map is
       one that's trivially SS-able for easy pp.
   All modes are still gated by playcount so a handful of scores on an
   obscure map isn't a real signal. The thresholds are the site owner's
   judgment call, not derived from anything. */
const FARM_DT_RATIO_THRESHOLD = 0.7;    // osu! / taiko
const FARM_ACC_RATIO_THRESHOLD = 0.7;   // catch / mania
const FARM_PLAYCOUNT_THRESHOLD = 500;

module.exports = {
    STAR_FLOOR, MOD_COMBOS, COMPUTE_ACCURACY, MODE_NUM, MODES,
    FARM_DT_RATIO_THRESHOLD, FARM_ACC_RATIO_THRESHOLD, FARM_PLAYCOUNT_THRESHOLD,
};
