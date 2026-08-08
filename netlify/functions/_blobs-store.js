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

module.exports = { getCollectionsStore, getSkinBackupsStore };
