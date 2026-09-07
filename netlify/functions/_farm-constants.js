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

/* ---------------------------------------------------------------------------
   "Is this actually a farm map" heuristic  (v4, 2026-09-07)

   Replaces the old flat rule (osu!/taiko: >=70% of the top-50 board on DT;
   catch/mania: >=70% of the top-50 SS'd). Friends who main catch/mania
   pointed out that the SS-ratio rule is nearly backwards for those modes —
   a genuine farm map (e.g. catch's "sidetracked day") often has *few* SS on
   the board because people rate it up with DT/HR, not because it's hard.
   And for every mode the bar should loosen as star rating rises: a 9* map
   where a quarter of the board is HR-FC is already a farm map; a 4* one has
   to be near-universally DT'd to count.

   New model, computed once per beatmap over its top-50 leaderboard:
     1. Each of the top-50 scores gets an "ease weight" in [0,1] — how much
        it reads as a comfortable / pp-cheese clear (see easeWeight() in
        _farm-crawl-core.js). Mode-specific: DT/NC dominates for osu!/taiko,
        DT + HR carry catch, mania leans on DT + high-combo-not-perfect
        clears (Kloc: "farm maps aren't the SS-able ones").
     2. farmFraction = mean ease weight over the board.
     3. It's a farm map if farmFraction >= threshold(mode, nomodStars),
        where the threshold slopes DOWN with star rating:
           threshold = clamp(base - slope * (stars - pivot), min, max)
     4. Still gated by playcount and a minimum board sample so a lightly
        played map with a 6-score leaderboard can't fluke a high fraction.

   The curve params below are the site owner's judgment call, not derived
   from anything — tune here, bump FARM_SIGNAL_VERSION in _farm-crawl-core.js,
   and the dataset self-heals over the next few crawl passes.
   --------------------------------------------------------------------------- */
const FARM_PLAYCOUNT_THRESHOLD = 500;   // min beatmap playcount for any farm call
const FARM_MIN_SAMPLE = 15;             // min top-50 scores before we trust a ratio

// threshold(stars) = clamp(base - slope * (stars - pivot), min, max)
const FARM_THRESHOLD_CURVE = {
    osu:    { base: 0.66, slope: 0.11, pivot: 4.5, min: 0.20, max: 0.72 },
    taiko:  { base: 0.66, slope: 0.11, pivot: 4.0, min: 0.20, max: 0.72 },
    fruits: { base: 0.58, slope: 0.10, pivot: 4.0, min: 0.18, max: 0.66 },
    mania:  { base: 0.54, slope: 0.09, pivot: 4.0, min: 0.18, max: 0.60 },
};

function farmThresholdForStars(mode, stars) {
    const c = FARM_THRESHOLD_CURVE[mode] || FARM_THRESHOLD_CURVE.osu;
    const s = Number.isFinite(stars) ? stars : c.pivot;
    return Math.min(c.max, Math.max(c.min, c.base - c.slope * (s - c.pivot)));
}

module.exports = {
    STAR_FLOOR, MOD_COMBOS, COMPUTE_ACCURACY, MODE_NUM, MODES,
    FARM_PLAYCOUNT_THRESHOLD, FARM_MIN_SAMPLE,
    FARM_THRESHOLD_CURVE, farmThresholdForStars,
};
