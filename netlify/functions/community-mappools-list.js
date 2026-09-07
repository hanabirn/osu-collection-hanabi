/* Public, read-only view over the community-authored tournament mappools
   (written by community-mappools-edit.js). No auth.

   GET with no params -> index:
     { pools: [{ id, tournamentName, tournamentUrl, source, mode,
                 roundCount, mapCount, contributorCount, updatedAt }],
       count }
   GET ?id=<poolId> -> one pool, ids joined against beatmaps:cache:
     { id, tournament: { name, slug, source, url }, mode,
       rounds: [{ id, name, brackets: [{ label, custom,
         maps: [{ beatmapId, setId, mode, artist, title, creator, version,
                  stars, bpm, length, status, resolved, addedBy }] }] }],
       contributors, updatedAt }
   Shape deliberately mirrors wc-mappools-list.js so js/mappools.js's
   renderMappoolCard()/mappoolBracketHead() render it unchanged. */
const { getCommunityMappoolsStore } = require('./_blobs-store');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const id = (qs.id || '').trim();

    try {
        const store = getCommunityMappoolsStore();

        if (!id) {
            const index = (await store.get('index', { type: 'json' })) || [];
            index.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            return {
                statusCode: 200,
                headers: { ...headers, 'Cache-Control': 'public, max-age=30' },
                body: JSON.stringify({ pools: index, count: index.length }),
            };
        }

        const pool = await store.get(`pool:${id}`, { type: 'json' });
        if (!pool) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Pool not found' }) };

        const cache = (await store.get('beatmaps:cache', { type: 'json' })) || {};
        const rounds = (pool.rounds || []).map((r) => ({
            id: r.id,
            name: r.name,
            brackets: (r.brackets || []).map((b) => ({
                label: b.label,
                custom: !!b.custom,
                maps: (b.maps || []).map((m) => {
                    const c = cache[m.beatmapId];
                    const resolved = !!(c && !c.unresolvable);
                    return {
                        beatmapId: m.beatmapId,
                        setId: resolved ? c.setId : null,
                        mode: resolved ? c.mode : null,
                        artist: resolved ? c.artist : '',
                        title: resolved ? c.title : '',
                        creator: resolved ? c.creator : '',
                        version: resolved ? c.version : '',
                        stars: resolved ? c.stars : null,
                        bpm: resolved ? c.bpm : null,
                        length: resolved ? c.length : null,
                        status: resolved ? c.status : '',
                        resolved,
                        addedBy: m.addedBy || null,
                    };
                }),
            })),
        }));

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, max-age=15' },
            body: JSON.stringify({
                id: pool.id,
                tournament: pool.tournament,
                mode: pool.mode,
                rounds,
                contributors: pool.contributors || [],
                createdAt: pool.createdAt,
                updatedAt: pool.updatedAt,
            }),
        };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
