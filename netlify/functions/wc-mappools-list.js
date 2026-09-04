/* Public, read-only view over the precomputed World Cup mappool index
   (built by wc-mappool-crawl-cron.js — see _wc-mappools-core.js). No auth.

   GET with no params  -> index:
     { editions: [{ key, variant, year, label, roundCount, mapCount }],
       coverage, lastRunAt }
   GET ?tournament=OWC&variant=&year=2024  -> one edition, maps joined
   against the resolved-metadata cache:
     { key, variant, year, label, folder,
       rounds: [{ name, mappackUrl, showcaseUrl,
         brackets: [{ label, maps: [{ beatmapId, setId, mode, artist, title,
           creator, version, stars, bpm, length, wikiText, isTiebreaker,
           resolved }] }] }] } */
const { getWcMappoolsStore } = require('./_blobs-store');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const tournament = (qs.tournament || '').trim().toUpperCase();
    const variant = (qs.variant || '').trim().toUpperCase();
    const year = parseInt(qs.year, 10) || 0;

    try {
        const store = getWcMappoolsStore();
        const pools = (await store.get('pools:all', { type: 'json' })) || [];
        const state = (await store.get('wc-state', { type: 'json' })) || {};

        if (!tournament || !year) {
            const editions = pools.map((p) => {
                let mapCount = 0;
                for (const r of p.rounds) for (const b of r.brackets) mapCount += b.maps.length;
                return { key: p.key, variant: p.variant || '', year: p.year, label: p.label, roundCount: p.rounds.length, mapCount };
            });
            return {
                statusCode: 200,
                headers: { ...headers, 'Cache-Control': 'public, max-age=600' },
                body: JSON.stringify({
                    editions,
                    coverage: state.coverage || null,
                    lastRunAt: state.lastRunAt || null,
                }),
            };
        }

        const pool = pools.find((p) => p.key === tournament && (p.variant || '') === variant && p.year === year);
        if (!pool) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'No such edition' }) };
        }

        const cache = (await store.get('beatmaps:cache', { type: 'json' })) || {};
        const rounds = pool.rounds.map((r) => ({
            name: r.name,
            mappackUrl: r.mappackUrl || null,
            showcaseUrl: r.showcaseUrl || null,
            brackets: r.brackets.map((b) => ({
                label: b.label,
                maps: b.maps.map((m) => {
                    const c = cache[m.beatmapId];
                    const resolved = !!(c && !c.unresolvable);
                    return {
                        beatmapId: m.beatmapId,
                        setId: m.setId,
                        mode: m.mode,
                        wikiText: m.wikiText || '',
                        isTiebreaker: !!m.isTiebreaker,
                        resolved,
                        artist: resolved ? c.artist : '',
                        title: resolved ? c.title : '',
                        creator: resolved ? c.creator : '',
                        version: resolved ? c.version : '',
                        stars: resolved ? c.stars : null,
                        bpm: resolved ? c.bpm : null,
                        length: resolved ? c.length : null,
                        status: resolved ? c.status : '',
                    };
                }),
            })),
        }));

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=600' },
            body: JSON.stringify({
                key: pool.key,
                variant: pool.variant || '',
                year: pool.year,
                label: pool.label,
                folder: pool.folder,
                rounds,
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
