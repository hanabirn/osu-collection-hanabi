/* Shared bits between chat-send.js and chat-edit.js — the message-content
   limits and the "resolve an osu! beatmap/set link in the text into a
   preview card" helper, so an edited message re-resolves its card the same
   way a freshly-sent one does. */

const MAX_CONTENT_LENGTH = 300;
const MAX_MESSAGES = 300;
const REPLY_SNIPPET_LENGTH = 120;

// Matches /beatmapsets/<id>, /beatmaps/<id> and the legacy /s/<id> — same
// shapes parseOsuInput() in js/osu.js already recognizes on the client,
// reimplemented here since this runs in a different runtime.
const BEATMAP_URL_RE = /osu\.ppy\.sh\/(?:beatmapsets|beatmaps|s)\/(\d+)/i;

async function resolveBeatmapPreview(content) {
    const match = content.match(BEATMAP_URL_RE);
    if (!match) return null;
    const id = match[1];

    try {
        const params = new URLSearchParams({ k: process.env.OSU_API_KEY, s: id });
        let res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${params.toString()}`);
        let beatmaps = await res.json();

        // The matched id might be a single-difficulty beatmap id rather than
        // a beatmapset id (e.g. /beatmaps/<diffId>) — retry as `b=` and
        // re-fetch the whole set, same fallback addOsuBeatmap() itself uses.
        if (!Array.isArray(beatmaps) || beatmaps.length === 0) {
            const byMapParams = new URLSearchParams({ k: process.env.OSU_API_KEY, b: id });
            const byMapRes = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${byMapParams.toString()}`);
            const byMap = await byMapRes.json();
            if (Array.isArray(byMap) && byMap.length > 0) {
                const setParams = new URLSearchParams({ k: process.env.OSU_API_KEY, s: byMap[0].beatmapset_id });
                res = await fetch(`https://osu.ppy.sh/api/get_beatmaps?${setParams.toString()}`);
                beatmaps = await res.json();
            }
        }
        if (!Array.isArray(beatmaps) || beatmaps.length === 0) return null;

        const ratings = beatmaps.map(b => parseFloat(b.difficultyrating)).filter(r => Number.isFinite(r));
        const modes = [...new Set(beatmaps.map(b => parseInt(b.mode, 10)))].filter(m => Number.isInteger(m));

        return {
            beatmapsetId: parseInt(beatmaps[0].beatmapset_id, 10),
            title: beatmaps[0].title,
            artist: beatmaps[0].artist,
            creator: beatmaps[0].creator,
            modes,
            starMin: ratings.length ? Math.min(...ratings) : 0,
            starMax: ratings.length ? Math.max(...ratings) : 0,
        };
    } catch (err) {
        // Best-effort — a resolution failure just means the message posts /
        // saves as plain text, never blocks the write.
        return null;
    }
}

module.exports = {
    MAX_CONTENT_LENGTH, MAX_MESSAGES, REPLY_SNIPPET_LENGTH,
    BEATMAP_URL_RE, resolveBeatmapPreview,
};
