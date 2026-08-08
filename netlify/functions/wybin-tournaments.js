/* ===== wyBin tournament listing proxy =====
   wyBin (https://wybin.xyz) is a community-run tournament hosting platform
   (mostly osu!catch, but covers all 4 modes) with a public, no-auth,
   CORS-open JSON API — GET /api/v1/tournament returns every tournament
   ever hosted there (~100+ entries, ~470KB) with a lot of fields this site
   has no use for (per-tournament theming colors, full HTML description,
   staff/team/player rosters, bracket/stage data). This proxy exists to:
   (1) keep the client-side tournaments tab decoupled from wyBin's exact
   response shape, matching every other osu-*.js proxy in this project, and
   (2) trim each entry down to just what the merged tournament list (see
   js/tournaments.js) actually renders — both for payload size and so this
   site doesn't needlessly re-expose other users' staff/team roster data. */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    try {
        const res = await fetch('https://wybin.xyz/api/v1/tournament');
        if (!res.ok) throw new Error(`wyBin API returned ${res.status}`);
        const data = await res.json();

        const items = (Array.isArray(data) ? data : [])
            .map(t => ({
                id: t.id,
                name: t.name,
                slug: t.slug,
                acronym: t.acronym,
                gamemode: t.gamemode,
                releaseDate: t.releaseDate,
                tags: t.tags,
                headerImageThumb: t.headerImageThumb,
            }))
            .sort((a, b) => (b.releaseDate || 0) - (a.releaseDate || 0));

        return {
            statusCode: 200,
            headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=900' },
            body: JSON.stringify({ items }),
        };
    } catch (err) {
        return { statusCode: 500, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: err.message }) };
    }
};
