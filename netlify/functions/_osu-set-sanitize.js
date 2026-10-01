/* Server-side twin of sanitizeIncomingOsuSet() in js/osu.js — keep the two
   in step. A published collection is served to everyone who opens or
   imports it, so collections-publish.js stores only what this returns:
   the fields the site uses, ids as positive integers, text as bounded
   strings. Returns null for a set without a usable id or difficulty. */

const posInt = v => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
};
const num = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
/* Text is kept as sent (osu! titles really do contain < and >, e.g. "<3",
   "<TV Size>"); pages escape it when they render it. */
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const MODE_INTS = [0, 1, 2, 3];

function sanitizeMeta(v) {
    if (!v || typeof v !== 'object') return null;
    const id = posInt(v.id);
    return id ? { id, name: str(v.name, 60) } : null;
}

function sanitizeBeatmap(b) {
    if (!b || typeof b !== 'object') return null;
    const beatmapId = posInt(b.beatmap_id);
    if (!beatmapId) return null;
    const out = {
        beatmap_id: beatmapId,
        version: str(b.version, 200),
        difficulty_rating: num(b.difficulty_rating),
        hit_length: num(b.hit_length),
        total_length: num(b.total_length),
        bpm: num(b.bpm),
        key_count: num(b.key_count),
    };
    if (MODE_INTS.includes(Number(b.mode_int))) out.mode_int = Number(b.mode_int);
    return out;
}

function sanitizeOsuSet(set) {
    if (!set || typeof set !== 'object') return null;
    const id = posInt(set.beatmapset_id);
    if (!id) return null;
    const beatmaps = (Array.isArray(set.beatmaps) ? set.beatmaps : []).map(sanitizeBeatmap).filter(Boolean);
    if (!beatmaps.length) return null;
    const out = {
        beatmapset_id: id,
        title: str(set.title),
        artist: str(set.artist),
        creator: str(set.creator, 100),
        mode: MODE_INTS.includes(Number(set.mode)) ? Number(set.mode) : 0,
        addedAt: typeof set.addedAt === 'string' && !isNaN(Date.parse(set.addedAt)) ? set.addedAt.slice(0, 40) : new Date().toISOString(),
        beatmaps,
    };
    const language = sanitizeMeta(set.language);
    const genre = sanitizeMeta(set.genre);
    if (language) out.language = language;
    if (genre) out.genre = genre;
    if (typeof set.source === 'string') out.source = str(set.source);
    return out;
}

module.exports = { sanitizeOsuSet };
