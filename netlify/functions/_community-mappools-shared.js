/* Shared helpers for the community-authored tournament mappools feature
   (community-mappools-list.js + community-mappools-edit.js). The crowd-
   sourced counterpart to the auto-crawled World Cup pools (_wc-mappools-core.js):
   visitors pick a tournament (from the 賽事 tab's list, or free text), pick a
   mode, add rounds and mod brackets, and drop beatmap ids in — the backend
   resolves each id's metadata + cover the same way the WC pools do. */
const { getOsuToken } = require('./_osu-auth');

const MODES = ['standard', 'taiko', 'catch', 'mania'];
// API mode string per site mode key (osu! v2 uses "osu"/"fruits").
const API_MODE = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };

// Preset bracket labels offered in the editor (the server still accepts any
// custom string). std/taiko/catch share one set; mania has its own.
const PRESET_BRACKETS = {
    standard: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    taiko: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    catch: ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'],
    mania: ['RC', 'LN', 'HB', 'TB'],
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
const EDIT_COOLDOWN_MS = 2000;

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

/* Best-effort import of a wyBin tournament's mappool into our pool shape.
   wyBin's /api/v1/tournament/<slug> carries stages[].modBrackets[].beatmaps[],
   but many hosts leave it empty (they use Google Sheets) or fill it with
   beatmapId:0 placeholder rows — so this often returns { count: 0 } and the
   caller falls back to manual entry. Returns { rounds, count } where rounds
   is [{ id, name, brackets:[{ label, custom, maps:[{beatmapId}] }] }]. */
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
    const presetSet = new Set((PRESET_BRACKETS[mode] || []).map((x) => x.toLowerCase()));
    const rounds = [];
    let count = 0;
    for (const st of (det.stages || [])) {
        if (!st.name) continue;
        const brackets = [];
        for (const mb of (st.modBrackets || [])) {
            const ids = (mb.beatmaps || [])
                .filter((m) => (m.beatmapId || 0) > 0 && (m.gamemodeId == null || m.gamemodeId === wantGm))
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
        if (rounds.length >= MAX_ROUNDS) break;
    }
    return { rounds, count };
}

module.exports = {
    MODES, API_MODE, PRESET_BRACKETS, PRESET_ROUNDS,
    MAX_ROUNDS, MAX_BRACKETS_PER_ROUND, MAX_MAPS_PER_BRACKET,
    MAX_LABEL_LEN, MAX_NAME_LEN, EDIT_COOLDOWN_MS,
    slugify, poolId, parseBeatmapRef, resolveBeatmap,
    resolveBeatmapsBatch, importWybinPool,
};
