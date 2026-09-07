/* Shared constants for the Farm Maps feature, split out from
   _farm-crawl-core.js so that farm-maps-list.js (a plain read-only Blobs
   query, no PP computation) doesn't have to pull in rosu-pp-js — and its
   WASM binary's included_files bundling requirement — just to read a couple
   of arrays. Only _farm-crawl-core.js needs the actual rosu-pp-js engine. */
// Lowest difficulty the crawler indexes. 5.5 -> 4.5 -> 3.5 (both 2026-09-07):
// 4.5 got NM down to ~150pp but HDDT still floored ~360pp; 3.5 pulls in the
// ~3.5-4.5* band so HDDT reaches ~180-200pp and NM ~70-90pp. Cost: the
// dataset roughly triples vs 5.5 and farm-maps-list / the practice generator
// parse the whole dataset:<mode> blob per request, so those read paths get
// slow until paginated/indexed. Each lowering also resets the crawl cursors
// (searchCursor -> null) for a full newest-first re-sweep.
const STAR_FLOOR = 3.5;
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
