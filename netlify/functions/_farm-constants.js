/* Shared constants for the Farm Maps feature, split out from
   _farm-crawl-core.js so that farm-maps-list.js (a plain read-only Blobs
   query, no PP computation) doesn't have to pull in rosu-pp-js — and its
   WASM binary's included_files bundling requirement — just to read a couple
   of arrays. Only _farm-crawl-core.js needs the actual rosu-pp-js engine. */
const STAR_FLOOR = 5.5;
const MOD_COMBOS = ['', 'DT', 'HD', 'HDDT', 'HR', 'HDHR'];
const COMPUTE_ACCURACY = 100;
const MODE_NUM = { osu: 0, taiko: 1, fruits: 2, mania: 3 };
const MODES = Object.keys(MODE_NUM);

/* "Is this actually a farm map" heuristic (as opposed to just any ranked
   map >= STAR_FLOOR, which is all the crawler filters on above): a map
   whose top-50 leaderboard skews heavily DT/HDDT is one the community is
   actively abusing for pp rather than playing at its "true" difficulty,
   and playcount guards against a small sample size (a handful of DT scores
   on an obscure, barely-played map isn't a real signal). Both thresholds
   are a judgment call the site owner made, not derived from anything. */
const FARM_DT_RATIO_THRESHOLD = 0.7;
const FARM_PLAYCOUNT_THRESHOLD = 500;

module.exports = {
    STAR_FLOOR, MOD_COMBOS, COMPUTE_ACCURACY, MODE_NUM, MODES,
    FARM_DT_RATIO_THRESHOLD, FARM_PLAYCOUNT_THRESHOLD,
};
