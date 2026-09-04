/* Netlify Blobs' "automatic" siteID/token injection (getStore(name) with no
   config) only works for the newer Functions v2 runtime — it does NOT work
   in the classic Lambda-compatible format this project uses everywhere
   (exports.handler = async (event) => {...}, matching osu-avatar.js etc.),
   confirmed by hitting MissingBlobsEnvironmentError on a real deploy. So the
   siteID/token have to be supplied explicitly here, sourced from env vars
   (NETLIFY_BLOBS_SITE_ID = Project ID from Netlify's Site configuration >
   General > Project information; NETLIFY_BLOBS_TOKEN = a personal access
   token from User settings > Applications > New access token). */
const { getStore } = require('@netlify/blobs');

function getCollectionsStore() {
    return getStore({
        name: 'osu-public-collections',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

function getSkinBackupsStore() {
    return getStore({
        name: 'osu-skin-backups',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

function getFarmMapsStore() {
    return getStore({
        name: 'osu-farm-maps',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

function getSkinScreenshotsStore() {
    return getStore({
        name: 'osu-skin-screenshots',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

// Ranked-catalog metadata index (artist / language / genre / source / feat.),
// built by catalog-crawl-cron.js — see _catalog-crawl-core.js. Separate from
// the farm-maps store: no star floor, no PP, one lean record per beatmapSET.
function getCatalogStore() {
    return getStore({
        name: 'osu-catalog',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

// Small key/value bucket for site-wide counters (currently just the "like
// this site" total — see site-likes.js).
function getSiteStatsStore() {
    return getStore({
        name: 'osu-site-stats',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

// Official World Cup mappools (OWC / TWC / MWC 4K+7K / CWC, every year),
// parsed from the ppy/osu-wiki markdown by wc-mappool-crawl-cron.js — see
// _wc-mappools-core.js. Near-static: one weekly sweep, hash-compared.
function getWcMappoolsStore() {
    return getStore({
        name: 'osu-wc-mappools',
        siteID: process.env.NETLIFY_BLOBS_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
    });
}

module.exports = { getCollectionsStore, getSkinBackupsStore, getFarmMapsStore, getSkinScreenshotsStore, getSiteStatsStore, getCatalogStore, getWcMappoolsStore };
