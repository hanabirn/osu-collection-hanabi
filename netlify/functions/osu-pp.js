const rosu = require('rosu-pp-js');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };
const MAX_ACC_VALUES = 6;
const STRAIN_FIELDS = ['aim', 'speed', 'flashlight', 'color', 'rhythm', 'stamina', 'movement', 'strains'];

/* Combines whichever per-mode strain arrays rosu-pp-js returns (aim+speed
   for osu!std, color+rhythm+stamina for taiko, movement for catch, strains
   for mania) into one elementwise-summed "difficulty over time" curve, so
   the client can render a single line without needing per-mode knowledge. */
function combineStrains(strains) {
    const arrays = STRAIN_FIELDS.map(f => strains[f]).filter(a => a && a.length);
    if (!arrays.length) return [];
    const len = arrays[0].length;
    const combined = new Array(len).fill(0);
    for (const arr of arrays) {
        for (let i = 0; i < len; i++) combined[i] += arr[i] || 0;
    }
    return combined;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const qs = event.queryStringParameters || {};
    const id = qs.id;
    if (!id || !/^\d+$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Missing or invalid id' }) };
    }

    const mods = /^[A-Za-z]{0,24}$/.test(qs.mods || '') ? (qs.mods || '').toUpperCase() : '';

    const accList = (qs.acc ? qs.acc.split(',') : ['95', '98', '100'])
        .map(s => parseFloat(s))
        .filter(n => Number.isFinite(n) && n >= 0 && n <= 100)
        .slice(0, MAX_ACC_VALUES);
    if (accList.length === 0) accList.push(100);

    // Both optional — omitted means "full combo" / "no misses" respectively,
    // which is what rosu-pp-js itself defaults to when a Performance option
    // is left unset, so there's no need to compute or send a real default.
    const combo = /^\d+$/.test(qs.combo || '') ? parseInt(qs.combo, 10) : undefined;
    const misses = /^\d+$/.test(qs.misses || '') ? Math.min(parseInt(qs.misses, 10), 5000) : undefined;

    try {
        const res = await fetch(`https://osu.ppy.sh/osu/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu-collection-hanabi.netlify.app/)' },
        });
        const text = await res.text();
        if (!res.ok || !text) {
            return { statusCode: 404, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Beatmap file not found' }) };
        }

        const map = new rosu.Beatmap(text);
        const difficulty = new rosu.Difficulty({ mods });
        const diffAttrs = difficulty.calculate(map);
        // Mod-adjusted AR/OD/CS/HP (e.g. HR raising CS, DT's clock rate
        // shrinking AR's effective hit window) for the difficulty radar
        // chart — separate from diffAttrs above, which doesn't expose ar/cs.
        const beatmapAttrs = new rosu.BeatmapAttributesBuilder({ map, mods }).build();

        const pp = {};
        for (const acc of accList) {
            const perfOpts = { mods, accuracy: acc };
            // Clamped to maxCombo rather than rejected — a visitor typing a
            // combo higher than the map allows is a mistake, not something
            // worth a 4xx round trip for.
            if (combo !== undefined) perfOpts.combo = Math.min(combo, diffAttrs.maxCombo);
            if (misses !== undefined) perfOpts.misses = misses;
            const perf = new rosu.Performance(perfOpts);
            pp[acc] = perf.calculate(diffAttrs).pp;
        }

        const strainsRaw = difficulty.strains(map);
        const strainValues = combineStrains(strainsRaw);

        const body = JSON.stringify({
            stars: diffAttrs.stars,
            maxCombo: diffAttrs.maxCombo,
            // osu!std aim / speed difficulty — used by the practice
            // generator's stream/jump weak-spot dimension. null for other
            // rulesets.
            aim: diffAttrs.aim != null ? diffAttrs.aim : null,
            speed: diffAttrs.speed != null ? diffAttrs.speed : null,
            pp,
            strains: { sectionLength: strainsRaw.sectionLength, values: strainValues },
            attrs: { ar: beatmapAttrs.ar, od: beatmapAttrs.od, cs: beatmapAttrs.cs, hp: beatmapAttrs.hp },
        });
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
