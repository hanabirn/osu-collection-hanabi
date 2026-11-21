/* PP over the course of a replay, for the replay player's pp counter.
   POST { id: beatmap id, mods: mod bits, mode: 0-3, states: [{ n, combo,
   geki, katu, n300, n100, n50, miss }] } where n is how many of the map's
   objects (as rosu-pp counts them for that mode) have been judged; the
   states must be in order. Answers { pp: [ ... one per state ] } using
   rosu-pp-js's GradualPerformance (one pass over the map), stable scoring. */
const rosu = require('rosu-pp-js');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const MAX_STATES = 6000;
const reply = (statusCode, body, extra = {}) => ({ statusCode, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
    let input;
    try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Bad JSON' }); }
    const id = String(input.id || '');
    if (!/^\d{1,10}$/.test(id)) return reply(400, { error: 'Missing or invalid id' });
    const mods = Number.isInteger(input.mods) && input.mods >= 0 ? input.mods : 0;
    const mode = [0, 1, 2, 3].includes(input.mode) ? input.mode : 0;
    const states = Array.isArray(input.states) ? input.states.slice(0, MAX_STATES) : [];
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

    try {
        const res = await fetch(`https://osu.ppy.sh/osu/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HanabiOsuSite/1.0; +https://osu.hanabirn.xyz/)' },
        });
        const text = await res.text();
        if (!res.ok || !text) return reply(404, { error: 'Beatmap file not found' });
        const map = new rosu.Beatmap(text);
        // a map converted from standard to another mode
        if (map.mode !== mode) map.convert(mode, mods);
        const difficulty = new rosu.Difficulty({ mods, lazer: false });
        const gradual = new rosu.GradualPerformance(difficulty, map);
        const pp = [];
        let done = 0; // objects processed so far
        for (const s of states) {
            const n = num(s.n);
            const state = {
                maxCombo: num(s.combo), nGeki: num(s.geki), nKatu: num(s.katu),
                n300: num(s.n300), n100: num(s.n100), n50: num(s.n50), misses: num(s.miss),
                osuLargeTickHits: 0, osuSmallTickHits: 0, sliderEndHits: 0,
            };
            let attrs;
            if (n > done) { attrs = gradual.nth(state, n - done - 1); done = n; }
            else attrs = gradual.next ? null : null;
            pp.push(attrs ? Math.round(attrs.pp * 100) / 100 : (pp.length ? pp[pp.length - 1] : 0));
        }
        gradual.free(); difficulty.free(); map.free();
        return reply(200, { pp }, { 'Cache-Control': 'no-store' });
    } catch (err) {
        console.error('replay-pp failed', err);
        return reply(500, { error: 'Calculation failed' });
    }
};
