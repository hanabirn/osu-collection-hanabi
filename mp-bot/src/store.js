/* The bot's only link to the website: a Netlify Blobs store (`osu-games`,
   the same one games-daily.js uses). The site appends lobby requests to the
   `mp-requests` array; the bot marks them running/done and writes a
   `mp-status:<id>` doc the site polls to show the lobby link. */
const { getStore } = require('@netlify/blobs');

const store = () => getStore({
    name: 'osu-games',
    siteID: process.env.NETLIFY_BLOBS_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
});

async function readRequests() {
    try {
        return (await store().get('mp-requests', { type: 'json' })) || [];
    } catch (e) {
        console.error('[store] readRequests:', e.message);
        return [];
    }
}

async function writeRequests(list) {
    try {
        await store().setJSON('mp-requests', list);
    } catch (e) {
        console.error('[store] writeRequests:', e.message);
    }
}

// Merge a patch into one request in the queue (re-reads to reduce races
// with the site appending at the same time).
async function patchRequest(id, patch) {
    const list = await readRequests();
    const i = list.findIndex((r) => r.id === id);
    if (i === -1) return;
    list[i] = { ...list[i], ...patch };
    await writeRequests(list);
}

async function setStatus(id, patch) {
    try {
        const key = `mp-status:${id}`;
        const cur = (await store().get(key, { type: 'json' })) || {};
        await store().setJSON(key, { ...cur, ...patch, updatedAt: new Date().toISOString() });
    } catch (e) {
        console.error('[store] setStatus:', e.message);
    }
}

module.exports = { readRequests, writeRequests, patchRequest, setStatus };
