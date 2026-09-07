/* Write side of the community-authored tournament mappools. Login-gated
   (osu! OAuth, same verifyAuthToken as chat/gallery) — anyone signed in can
   contribute; only the site owner can delete a whole pool or a non-empty
   round/bracket. Trust model = the chat room's: crowd-editable, owner mops
   up. Concurrency = last-write-wins on the single pool:<id> doc, which is
   fine at this scale (edits are small and rare relative to a blob write).

   POST { action, ... } where action is one of:
     create        { tournament: { name, slug?, source?, url? }, mode }
     add-round     { poolId, name }
     remove-round  { poolId, roundId }            (owner, or empty round)
     add-bracket   { poolId, roundId, label }
     remove-bracket{ poolId, roundId, label }     (owner, or empty bracket)
     add-map       { poolId, roundId, label, ref }  ref = id or any osu! URL
     remove-map    { poolId, roundId, label, beatmapId }  (adder, or owner)
     delete-pool   { poolId }                     (owner only)
   Every mutating action returns the updated pool doc (raw, unresolved) as
   { pool }. */
const { getCommunityMappoolsStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');
const {
    MODES, PRESET_BRACKETS, slugify, poolId, parseBeatmapRef, resolveBeatmap,
    resolveBeatmapsBatch, importWybinPool,
    MAX_ROUNDS, MAX_BRACKETS_PER_ROUND, MAX_MAPS_PER_BRACKET,
    MAX_LABEL_LEN, MAX_NAME_LEN, EDIT_COOLDOWN_MS,
} = require('./_community-mappools-shared');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const OWNER_OSU_ID = process.env.CHAT_OWNER_OSU_ID || '26696007';
const MAX_INDEX = 2000;

const err = (code, message) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ error: message }) });
const ok = (pool) => ({ statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ pool }) });

function indexEntry(pool) {
    let maps = 0;
    for (const r of pool.rounds) for (const b of r.brackets) maps += b.maps.length;
    return {
        id: pool.id,
        tournamentName: pool.tournament.name,
        tournamentUrl: pool.tournament.url || null,
        source: pool.tournament.source || 'custom',
        mode: pool.mode,
        roundCount: pool.rounds.length,
        mapCount: maps,
        contributorCount: (pool.contributors || []).length,
        updatedAt: pool.updatedAt,
    };
}

async function writeIndex(store, pool) {
    const index = (await store.get('index', { type: 'json' })) || [];
    const i = index.findIndex((e) => e.id === pool.id);
    const entry = indexEntry(pool);
    if (i === -1) index.push(entry); else index[i] = entry;
    await store.setJSON('index', index.slice(-MAX_INDEX));
}

async function removeFromIndex(store, id) {
    const index = (await store.get('index', { type: 'json' })) || [];
    await store.setJSON('index', index.filter((e) => e.id !== id));
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) return err(401, 'Invalid or expired login, please log in again');
    const isOwner = String(user.id) === String(OWNER_OSU_ID);

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }
    const action = body.action;

    const store = getCommunityMappoolsStore();

    const lastEditAt = await store.get(`lastEditAt:${user.id}`, { type: 'text' });
    if (lastEditAt && Date.now() - parseInt(lastEditAt, 10) < EDIT_COOLDOWN_MS) {
        return err(429, 'Editing too fast, please slow down');
    }

    try {
        // ---- create ----------------------------------------------------
        if (action === 'create') {
            const name = String((body.tournament || {}).name || '').trim().slice(0, MAX_NAME_LEN);
            const mode = body.mode;
            if (!name) return err(422, 'Missing tournament name');
            if (!MODES.includes(mode)) return err(422, 'Invalid mode');
            const slug = slugify((body.tournament || {}).slug || name);
            const id = poolId(slug, mode);

            const existing = await store.get(`pool:${id}`, { type: 'json' });
            if (existing) return ok(existing); // dedup — join the existing pool

            const now = new Date().toISOString();
            const rawUrl = typeof (body.tournament || {}).url === 'string' ? body.tournament.url.trim().slice(0, 300) : '';
            const source = ['wybin', 'forum', 'custom'].includes((body.tournament || {}).source) ? body.tournament.source : 'custom';
            const pool = {
                id, mode,
                tournament: { name, slug, source, url: /^https?:\/\//i.test(rawUrl) ? rawUrl : null },
                rounds: [],
                contributors: [user.id],
                createdBy: user.id,
                createdAt: now,
                updatedAt: now,
            };

            // Best-effort auto-import from wyBin's own mappool data. Usually
            // finds nothing (hosts fill pools late / use Google Sheets), in
            // which case the pool is created empty for manual entry.
            let imported = 0;
            if (source === 'wybin' && (body.tournament || {}).slug) {
                try {
                    const imp = await importWybinPool(String(body.tournament.slug), mode);
                    if (imp.count > 0) {
                        const ids = [...new Set(imp.rounds.flatMap((r) => r.brackets.flatMap((b) => b.maps.map((m) => m.beatmapId))))];
                        const resolved = await resolveBeatmapsBatch(ids);
                        if (Object.keys(resolved).length) {
                            const cache = (await store.get('beatmaps:cache', { type: 'json' })) || {};
                            Object.assign(cache, resolved);
                            await store.setJSON('beatmaps:cache', cache);
                        }
                        pool.rounds = imp.rounds;
                        imported = imp.count;
                    }
                } catch { /* fall through to an empty pool */ }
            }

            await store.setJSON(`pool:${id}`, pool);
            await writeIndex(store, pool);
            await store.set(`lastEditAt:${user.id}`, String(Date.now()));
            return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ pool, imported }) };
        }

        // ---- everything else needs an existing pool -------------------
        const id = String(body.poolId || '').trim();
        if (!id) return err(422, 'Missing poolId');
        const pool = await store.get(`pool:${id}`, { type: 'json' });
        if (!pool) return err(404, 'Pool not found');

        const round = () => pool.rounds.find((r) => r.id === body.roundId);
        const touch = () => {
            pool.updatedAt = new Date().toISOString();
            if (!pool.contributors.includes(user.id)) pool.contributors.push(user.id);
        };
        const save = async () => {
            await store.setJSON(`pool:${id}`, pool);
            await writeIndex(store, pool);
            await store.set(`lastEditAt:${user.id}`, String(Date.now()));
            return ok(pool);
        };

        if (action === 'delete-pool') {
            if (!isOwner) return err(403, 'Only the site owner can delete a pool');
            await store.delete(`pool:${id}`);
            await removeFromIndex(store, id);
            await store.set(`lastEditAt:${user.id}`, String(Date.now()));
            return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true }) };
        }

        if (action === 'add-round') {
            const name = String(body.name || '').trim().slice(0, MAX_NAME_LEN);
            if (!name) return err(422, 'Missing round name');
            if (pool.rounds.length >= MAX_ROUNDS) return err(422, 'Too many rounds');
            const rid = slugify(name);
            if (!pool.rounds.some((r) => r.id === rid)) {
                pool.rounds.push({ id: rid, name, brackets: [] });
                touch();
            }
            return save();
        }

        if (action === 'remove-round') {
            const r = round();
            if (!r) return err(404, 'Round not found');
            const hasMaps = r.brackets.some((b) => b.maps.length);
            if (hasMaps && !isOwner) return err(403, 'Round is not empty');
            pool.rounds = pool.rounds.filter((x) => x.id !== r.id);
            touch();
            return save();
        }

        if (action === 'add-bracket') {
            const r = round();
            if (!r) return err(404, 'Round not found');
            const label = String(body.label || '').trim().slice(0, MAX_LABEL_LEN);
            if (!label) return err(422, 'Missing bracket label');
            if (r.brackets.length >= MAX_BRACKETS_PER_ROUND) return err(422, 'Too many brackets');
            if (!r.brackets.some((b) => b.label.toLowerCase() === label.toLowerCase())) {
                const preset = (PRESET_BRACKETS[pool.mode] || []).map((x) => x.toLowerCase());
                r.brackets.push({ label, custom: !preset.includes(label.toLowerCase()), maps: [] });
                touch();
            }
            return save();
        }

        if (action === 'remove-bracket') {
            const r = round();
            if (!r) return err(404, 'Round not found');
            const b = r.brackets.find((x) => x.label.toLowerCase() === String(body.label || '').toLowerCase());
            if (!b) return err(404, 'Bracket not found');
            if (b.maps.length && !isOwner) return err(403, 'Bracket is not empty');
            r.brackets = r.brackets.filter((x) => x !== b);
            touch();
            return save();
        }

        if (action === 'add-map') {
            const r = round();
            if (!r) return err(404, 'Round not found');
            const b = r.brackets.find((x) => x.label.toLowerCase() === String(body.label || '').toLowerCase());
            if (!b) return err(404, 'Bracket not found');
            const beatmapId = parseBeatmapRef(body.ref);
            if (!beatmapId) return err(422, 'Could not read a beatmap id — paste a difficulty link or id');
            if (b.maps.length >= MAX_MAPS_PER_BRACKET) return err(422, 'Bracket is full');
            if (b.maps.some((m) => m.beatmapId === beatmapId)) return err(409, 'That map is already in this bracket');

            const cache = (await store.get('beatmaps:cache', { type: 'json' })) || {};
            if (!cache[beatmapId]) {
                const meta = await resolveBeatmap(beatmapId);
                if (meta === null) return err(502, 'Could not reach osu! to look up that map, try again');
                cache[beatmapId] = meta;
                await store.setJSON('beatmaps:cache', cache);
            }
            if (cache[beatmapId].unresolvable) return err(404, 'No beatmap with that id');

            b.maps.push({ beatmapId, addedBy: user.id, addedAt: new Date().toISOString() });
            touch();
            return save();
        }

        if (action === 'remove-map') {
            const r = round();
            if (!r) return err(404, 'Round not found');
            const b = r.brackets.find((x) => x.label.toLowerCase() === String(body.label || '').toLowerCase());
            if (!b) return err(404, 'Bracket not found');
            const beatmapId = parseInt(body.beatmapId, 10);
            const m = b.maps.find((x) => x.beatmapId === beatmapId);
            if (!m) return err(404, 'Map not found');
            if (String(m.addedBy) !== String(user.id) && !isOwner) return err(403, 'Not the map you added');
            b.maps = b.maps.filter((x) => x !== m);
            touch();
            return save();
        }

        return err(400, `Unknown action: ${action}`);
    } catch (e) {
        return err(500, e.message);
    }
};
