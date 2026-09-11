/* Netlify Blobs store getters for this site. Same explicit siteID/token
   pattern as the main site's _blobs-store.js (automatic env injection only
   works on the Functions v2 runtime, not the classic Lambda-style handlers
   used here) — but pointed at THIS site's own NETLIFY_BLOBS_SITE_ID /
   NETLIFY_BLOBS_TOKEN, which must be freshly generated for this Netlify
   site (see SETUP.md), not copied from the main site. */
const { getStore } = require('@netlify/blobs');

function store(name) {
    return getStore({
        name,
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

// Rankings sweep: `rankings:TW` (gzip array of player records) +
// `rankings-crawl-state` (plain JSON cursor/diagnostics) +
// `players:index` (plain JSON polling queue, derived from rankings:TW).
function getRankingsStore() {
    return store('catch-tracker-rankings');
}

// Score-poll sweep: `feed:recent` (gzip ring buffer of detected scores) +
// `scores-poll-state` (plain JSON cursor/diagnostics) +
// `player-scores:{user_id}` (plain JSON per-player de-dup cache).
function getFeedStore() {
    return store('catch-tracker-feed');
}

// Map catalog sweep: `maps:catch` (gzip array of every ranked+loved catch
// beatmap) + `maps-crawl-state` (plain JSON cursor/diagnostics).
function getMapsStore() {
    return store('catch-tracker-maps');
}

// Public skin catalog (skins-upload/list/download/image.js) — a browsable
// community skin-file catalog (anyone can upload/download), NOT the same
// thing as the main site's skins feature (a private per-user login-gated
// cloud *backup* of your own skins — nobody else can see or download
// those). `index` (plain JSON array of metadata), `file:{id}` (binary
// .osk), `preview:{id}` (binary preview image, optional).
function getSkinsStore() {
    return store('catch-tracker-skins');
}

// Watch Replay login (osu-replay-login/callback.js, _replay-auth.js):
// `user-token:{user_id}` → encrypted {access_token, refresh_token,
// expires_at} (see _token-crypto.js) so replay-download.js can call osu!'s
// API again on a later visit without asking the user to re-login every time.
function getAuthStore() {
    return store('catch-tracker-auth');
}

// replay-download.js: `replay:{score_id}` → raw .osr bytes. A finished
// score's replay never changes, so this is cached forever — sidesteps
// re-hitting osu!'s download endpoint (and the user's own rate limit) on
// every repeat view of the same replay.
function getReplayCacheStore() {
    return store('catch-tracker-replay-cache');
}

module.exports = { getRankingsStore, getFeedStore, getMapsStore, getSkinsStore, getAuthStore, getReplayCacheStore };
