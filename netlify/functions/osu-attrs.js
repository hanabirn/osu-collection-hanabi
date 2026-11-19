/* A beatmap's official difficulty attributes with a given set of mods
   (osu! API v2 POST /beatmaps/{id}/attributes): star rating, and per ruleset
   aim / speed / flashlight difficulty, approach rate, overall difficulty...
   the numbers osu! itself uses for pp. Used by the skill radar
   (js/skill-radar.js) so every top play is read with the mods it was
   actually set with.

   GET ?id=<beatmap id>&mods=HDDT&m=osu|taiko|fruits|mania
   Cached a day at the edge (attributes only change with a pp rework). */
const { getOsuToken } = require('./_osu-auth');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };
const RULESETS = new Set(['osu', 'taiko', 'fruits', 'mania']);
// Only mods that can change difficulty; everything else is dropped.
const DIFF_MODS = new Set(['EZ', 'HR', 'DT', 'NC', 'HT', 'FL', 'HD', 'TD', 'NF', 'SO', 'RX', 'AP', 'MR']);

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    const qs = event.queryStringParameters || {};
    const id = qs.id;
    if (!id || !/^\d{1,12}$/.test(id)) {
        return { statusCode: 400, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'invalid id' }) };
    }
    const ruleset = RULESETS.has(qs.m) ? qs.m : 'osu';
    const mods = (String(qs.mods || '').toUpperCase().match(/[A-Z0-9]{2}/g) || []).filter((m) => DIFF_MODS.has(m));
    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${id}/attributes`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ mods, ruleset }),
        });
        if (!res.ok) {
            return { statusCode: res.status === 404 ? 404 : 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: `osu! API ${res.status}` }) };
        }
        const data = await res.json();
        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
            body: JSON.stringify(data.attributes || {}),
        };
    } catch (err) {
        return { statusCode: 502, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
