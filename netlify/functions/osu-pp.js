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

        const pp = {};
        for (const acc of accList) {
            const perf = new rosu.Performance({ mods, accuracy: acc });
            pp[acc] = perf.calculate(diffAttrs).pp;
        }

        const strainsRaw = difficulty.strains(map);
        const strainValues = combineStrains(strainsRaw);

        const body = JSON.stringify({
            stars: diffAttrs.stars,
            maxCombo: diffAttrs.maxCombo,
            pp,
            strains: { sectionLength: strainsRaw.sectionLength, values: strainValues },
        });
        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
