/* Blobs store for Web Push subscriptions. Same explicit siteID/token as
   _blobs-store.js (the classic Lambda function format this project uses
   can't rely on @netlify/blobs' automatic env injection). One entry per
   push subscription, keyed by a hash of its endpoint. */
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function getPushStore() {
    return getStore({
        name: 'osu-push-subs',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

/* Deterministic key from the subscription endpoint so a re-subscribe (same
   endpoint, refreshed player list) overwrites rather than duplicates. */
function subKey(endpoint) {
    return crypto.createHash('sha256').update(String(endpoint)).digest('hex');
}

module.exports = { getPushStore, subKey };
