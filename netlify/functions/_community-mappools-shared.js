/* Shared helpers for the community-authored tournament mappools feature
   (community-mappools-list.js + community-mappools-edit.js). The crowd-
   sourced counterpart to the auto-crawled World Cup pools (_wc-mappools-core.js):
   visitors pick a tournament (from the 賽事 tab's list, or free text), pick a
   mode, add rounds and mod brackets, and drop beatmap ids in — the backend
   resolves each id's metadata + cover the same way the WC pools do. */
const { getOsuToken } = require('./_osu-auth');

// 'all' = a multi-mode tournament (O!EMMT, Fin's All Mode Event, …): one
// pool whose brackets/maps can be any ruleset; each map keeps its own mode.
const MODES = ['standard', 'taiko', 'catch', 'mania', 'all'];
// API mode string per site mode key (osu! v2 uses "osu"/"fruits").
const API_MODE = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };

// Preset bracket labels offered in the editor (the server still accepts any
// custom string). std/taiko/catch share one set; mania has its own; 'all'
// offers the union.
const PRESET_BRACKETS = {
    standard: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    taiko: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    catch: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    mania: ['RC', 'LN', 'HB', 'TB'],
    all: ['NM', 'HD', 'HR', 'DT', 'FM', 'RC', 'LN', 'HB', 'TB'],
};
const PRESET_ROUNDS = [
    'Qualifiers', 'Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
    'Quarterfinals', 'Semifinals', 'Finals', 'Grand Finals',
];

// Sanity caps so one pool can't grow unbounded.
const MAX_ROUNDS = 40;
const MAX_BRACKETS_PER_ROUND = 30;
const MAX_MAPS_PER_BRACKET = 20;
const MAX_LABEL_LEN = 24;
const MAX_NAME_LEN = 80;
const EDIT_COOLDOWN_MS = 800;   // loose enough to add several maps in a row

function slugify(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'untitled';
}

function poolId(tournamentSlug, mode) {
    return `${slugify(tournamentSlug)}--${mode}`;
}

// Parse a beatmap id out of a raw id or any osu! URL shape (same shapes
// parseOsuInput()/extractBeatmapRefs handle elsewhere).
function parseBeatmapRef(raw) {
    const s = String(raw || '').trim();
    if (/^\d{1,12}$/.test(s)) return parseInt(s, 10);
    let m = s.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/);           // beatmapsets/123#osu/456
    if (m) return parseInt(m[1], 10);
    m = s.match(/\/beatmaps\/(\d+)/) || s.match(/\/b\/(\d+)/);        // /beatmaps/456 or /b/456
    if (m) return parseInt(m[1], 10);
    return null;                                                     // set-only URLs give no diff id
}

/* Best-effort scrape of many beatmap ids out of a pasted blob — a column of
   ids from a Google Sheet, a list of difficulty links from a forum post, or
   lines like "NM1: <link>". One line at a time so a stray number in prose
   (a BPM, a year) is far less likely to be mistaken for an id:
     - a line that is just digits            -> that id
     - a line with osu! diff-link shapes     -> every id in it
     - otherwise a lone 4-12 digit run       -> that id  (covers "NM1  123456")
   Set-only URLs (beatmapsets/123 with no #mode/diff) carry no diff id and are
   skipped. Returns an ordered, de-duped array. */
function parseBeatmapRefs(text) {
    const ids = [];
    const seen = new Set();
    const push = (id) => { if (id > 0 && id < 1e12 && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (const rawLine of String(text || '').split(/[\r\n]+/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^\d{1,12}$/.test(line)) { push(parseInt(line, 10)); continue; }
        const re = /#(?:osu|taiko|fruits|mania)\/(\d+)|\/beatmaps\/(\d+)|\/b\/(\d+)/g;
        let m, found = false;
        while ((m = re.exec(line))) { push(parseInt(m[1] || m[2] || m[3], 10)); found = true; }
        if (!found) {
            const n = line.match(/(?:^|[^\d/])(\d{4,12})(?:[^\d]|$)/);
            if (n) push(parseInt(n[1], 10));
        }
    }
    return ids;
}

// Resolve one beatmap id -> { setId, mode, artist, title, creator, version,
// stars, bpm, length, status } via osu! API v2, or { unresolvable: true }.
async function resolveBeatmap(beatmapId) {
    try {
        const token = await getOsuToken();
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (res.status === 404) return { unresolvable: true };
        if (!res.ok) return null; // transient — let the caller retry later
        const b = await res.json();
        const set = b.beatmapset || {};
        return {
            setId: b.beatmapset_id || set.id || null,
            mode: b.mode || null,
            artist: set.artist || '',
            title: set.title || '',
            creator: set.creator || '',
            version: b.version || '',
            stars: typeof b.difficulty_rating === 'number' ? b.difficulty_rating : null,
            bpm: typeof b.bpm === 'number' ? b.bpm : null,
            length: typeof b.total_length === 'number' ? b.total_length : null,
            status: b.status || '',
            resolvedAt: Date.now(),
        };
    } catch {
        return null;
    }
}

// Resolve up to 50 beatmap ids in one osu! API v2 call. Returns a
// { [id]: meta | {unresolvable:true} } map; ids not in the response are
// left out (caller treats them as unresolved-for-now).
async function resolveBeatmapsBatch(ids) {
    const out = {};
    if (!ids.length) return out;
    try {
        const token = await getOsuToken();
        for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            const qs = chunk.map((id) => `ids[]=${id}`).join('&');
            const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps?${qs}`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            });
            if (!res.ok) continue;
            const data = await res.json();
            for (const b of (data.beatmaps || [])) {
                const set = b.beatmapset || {};
                out[b.id] = {
                    setId: b.beatmapset_id || set.id || null,
                    mode: b.mode || null,
                    artist: set.artist || '', title: set.title || '', creator: set.creator || '',
                    version: b.version || '',
                    stars: typeof b.difficulty_rating === 'number' ? b.difficulty_rating : null,
                    bpm: typeof b.bpm === 'number' ? b.bpm : null,
                    length: typeof b.total_length === 'number' ? b.total_length : null,
                    status: b.status || '', resolvedAt: Date.now(),
                };
            }
        }
    } catch { /* partial / empty result — caller retries later */ }
    return out;
}

// wyBin mod-bracket name -> our short label.
const WYBIN_MOD_LABEL = {
    NoMod: 'NM', Hidden: 'HD', HardRock: 'HR', DoubleTime: 'DT', Nightcore: 'NC',
    FreeMod: 'FM', Tiebreaker: 'TB', TieBreaker: 'TB', Easy: 'EZ', Flashlight: 'FL',
    HalfTime: 'HT', SuddenDeath: 'SD', Perfect: 'PF',
    Rice: 'RC', LongNote: 'LN', 'Long Note': 'LN', Hybrid: 'HB',
};

// One wyBin stage's mod brackets. The tournament summary
// (/api/v1/tournament/<slug>) only inlines modBrackets for `currentStageId`;
// every other stage comes back with modBrackets:null and needs its own
// /api/v1/tournament-stage/<id> fetch to get the pool. Returns the raw
// modBrackets array (or []).
async function fetchWybinStageBrackets(st) {
    if (Array.isArray(st.modBrackets) && st.modBrackets.length) return st.modBrackets;
    if (st.id == null) return [];
    try {
        const res = await fetch(`https://wybin.xyz/api/v1/tournament-stage/${st.id}`, {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) return [];
        return (await res.json()).modBrackets || [];
    } catch {
        return [];
    }
}

/* Best-effort import of a wyBin tournament's mappool into our pool shape.
   Walks every stage (Qualifier … Grand Finals), pulling each stage's pool
   from /api/v1/tournament-stage/<id> when the summary didn't inline it, so
   all rounds are captured — not just the current one. Many hosts still leave
   wyBin empty (Google Sheets) so this can return { count: 0 } and the caller
   falls back to manual entry. Stages are ordered by start date so rounds
   read Qualifier → GF. Returns { rounds, count } where rounds is
   [{ id, name, brackets:[{ label, custom, maps:[{beatmapId}] }] }]. */
async function importWybinPool(slug, mode) {
    let det;
    try {
        const res = await fetch(`https://wybin.xyz/api/v1/tournament/${encodeURIComponent(slug)}`, {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) return { rounds: [], count: 0 };
        det = await res.json();
    } catch {
        return { rounds: [], count: 0 };
    }
    const wantGm = { standard: 0, taiko: 1, catch: 2, mania: 3 }[mode];
    const takeAll = mode === 'all';
    const presetSet = new Set((PRESET_BRACKETS[mode] || []).map((x) => x.toLowerCase()));
    const stages = (det.stages || [])
        .filter((st) => st && st.name)
        .sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
    const rounds = [];
    let count = 0;
    for (const st of stages) {
        if (rounds.length >= MAX_ROUNDS) break;
        const modBrackets = await fetchWybinStageBrackets(st);
        const brackets = [];
        for (const mb of modBrackets) {
            const ids = (mb.beatmaps || [])
                .filter((m) => (m.beatmapId || 0) > 0 && (takeAll || m.gamemodeId == null || m.gamemodeId === wantGm))
                .map((m) => parseInt(m.beatmapId, 10));
            if (!ids.length) continue;
            const label = (WYBIN_MOD_LABEL[mb.name] || String(mb.name || 'NM')).slice(0, MAX_LABEL_LEN);
            const seen = new Set();
            const maps = ids.filter((id) => !seen.has(id) && seen.add(id)).slice(0, MAX_MAPS_PER_BRACKET)
                .map((id) => ({ beatmapId: id, addedBy: 'wybin', addedAt: new Date().toISOString() }));
            count += maps.length;
            brackets.push({ label, custom: !presetSet.has(label.toLowerCase()), maps });
        }
        if (brackets.length) rounds.push({ id: slugify(st.name), name: String(st.name).slice(0, MAX_NAME_LEN), brackets });
    }
    return { rounds, count };
}

const MAX_INDEX = 2000;

function indexEntry(pool) {
    let maps = 0;
    for (const r of (pool.rounds || [])) for (const b of r.brackets) maps += b.maps.length;
    return {
        id: pool.id,
        tournamentName: pool.tournament.name,
        tournamentUrl: pool.tournament.url || null,
        source: pool.tournament.source || 'custom',
        mode: pool.mode,
        roundCount: (pool.rounds || []).length,
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

/* Scheduled crawl: walk wyBin's tournament list, and for any tournament that
   has actually filled its mappool in wyBin's own system, auto-create the
   matching community pool(s) — but NEVER touch a pool that already exists,
   so manual edits are safe. Time-boxed + cursor-paged (state under
   `wybin-crawl-state`) so a run fits Netlify's scheduled-function window.
   `store` is a getCommunityMappoolsStore(). */
async function crawlWybinMappools(store, { budgetMs = 25000, perRun = 10 } = {}) {
    const start = Date.now();
    const state = (await store.get('wybin-crawl-state', { type: 'json' })) || { cursor: 0, createdTotal: 0 };

    let list;
    try {
        const res = await fetch('https://wybin.xyz/api/v1/tournament', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`wybin list ${res.status}`);
        const data = await res.json();
        list = (Array.isArray(data) ? data : (data.data || data.tournaments || data.items || []))
            .filter((t) => t && t.slug);
    } catch (e) {
        state.lastRunAt = new Date().toISOString();
        state.lastError = e.message;
        await store.setJSON('wybin-crawl-state', state);
        return { checked: 0, created: 0, error: e.message };
    }

    if (state.cursor >= list.length) state.cursor = 0;
    let checked = 0, created = 0, error = null;

    try {
        for (let n = 0; n < perRun && checked < list.length; n++) {
            if (Date.now() - start > budgetMs) break;
            const t = list[state.cursor % list.length];
            state.cursor = (state.cursor + 1) % list.length;
            checked++;

            // Which mode(s) this tournament's pool maps to. wyBin gamemode
            // 4 = "all modes" -> our 'all' pool; otherwise the single mode.
            const gm2mode = { 0: 'standard', 1: 'taiko', 2: 'catch', 3: 'mania', 4: 'all' };
            const mode = gm2mode[t.gamemode];
            if (!mode) continue;

            const id = poolId(slugify(t.slug || t.name), mode);
            const existing = await store.get(`pool:${id}`, { type: 'json' });
            // Skip anything a human has touched (a contributor other than the
            // 'wybin' bot). A pool that's still purely wybin-sourced gets
            // re-imported so it tracks wyBin as more rounds get filled in.
            if (existing && (existing.contributors || []).some((c) => String(c) !== 'wybin')) continue;

            let imp;
            try { imp = await importWybinPool(String(t.slug), mode); } catch { continue; }
            if (!imp.count) continue;
            // Don't rewrite an identical import (avoids a pointless blob write
            // + updatedAt churn every 6h).
            if (existing && JSON.stringify(existing.rounds) === JSON.stringify(imp.rounds)) continue;

            const ids = [...new Set(imp.rounds.flatMap((r) => r.brackets.flatMap((b) => b.maps.map((m) => m.beatmapId))))];
            const resolved = await resolveBeatmapsBatch(ids);
            if (Object.keys(resolved).length) {
                const cache = (await store.get('beatmaps:cache', { type: 'json' })) || {};
                Object.assign(cache, resolved);
                await store.setJSON('beatmaps:cache', cache);
            }

            const now = new Date().toISOString();
            const pool = {
                id, mode,
                tournament: {
                    name: String(t.name || t.slug).slice(0, MAX_NAME_LEN),
                    slug: slugify(t.slug || t.name),
                    source: 'wybin',
                    url: t.slug ? `https://wybin.xyz/tournaments/${t.slug}` : null,
                },
                rounds: imp.rounds,
                contributors: ['wybin'],
                createdBy: 'wybin',
                createdAt: existing ? existing.createdAt : now,
                updatedAt: now,
            };
            await store.setJSON(`pool:${id}`, pool);
            await writeIndex(store, pool);
            created++;
        }
    } catch (e) {
        error = e.message;
    }

    state.lastRunAt = new Date().toISOString();
    state.lastError = error;
    state.createdTotal = (state.createdTotal || 0) + created;
    await store.setJSON('wybin-crawl-state', state);
    return { checked, created, cursor: state.cursor, listSize: list.length, error };
}

module.exports = {
    MODES, API_MODE, PRESET_BRACKETS, PRESET_ROUNDS,
    MAX_ROUNDS, MAX_BRACKETS_PER_ROUND, MAX_MAPS_PER_BRACKET,
    MAX_LABEL_LEN, MAX_NAME_LEN, EDIT_COOLDOWN_MS,
    slugify, poolId, parseBeatmapRef, parseBeatmapRefs, resolveBeatmap,
    resolveBeatmapsBatch, importWybinPool,
    indexEntry, writeIndex, removeFromIndex, crawlWybinMappools,
};
