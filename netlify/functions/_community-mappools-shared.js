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

module.exports = {
    MODES, API_MODE, PRESET_BRACKETS, PRESET_ROUNDS,
    MAX_ROUNDS, MAX_BRACKETS_PER_ROUND, MAX_MAPS_PER_BRACKET,
    MAX_LABEL_LEN, MAX_NAME_LEN, EDIT_COOLDOWN_MS,
    slugify, poolId, parseBeatmapRef, resolveBeatmap,
};
