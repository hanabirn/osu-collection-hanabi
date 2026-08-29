/* OpenGraph image for a published gallery collection (see
   collection-share-page.js). Nothing is rendered — this 302-redirects to the
   collection's top beatmap cover on osu!'s CDN, which crawlers follow when
   unfurling og:image. Falls back to the site icon so a card always has a
   picture. */
const { getCollectionsStore } = require('./_blobs-store');

const MODES = ['standard', 'taiko', 'catch', 'mania'];

exports.handler = async (event) => {
    const id = (event.queryStringParameters || {}).id;
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host || '';
    const fallback = `${proto}://${host}/assets/icons/icon-512.png`;
    const redirect = (loc, maxAge) => ({
        statusCode: 302,
        headers: { Location: loc, 'Cache-Control': `public, max-age=${maxAge}` },
        body: '',
    });

    if (!id || !/^\d+$/.test(id)) return redirect(fallback, 300);

    try {
        const store = getCollectionsStore();
        const full = await store.get(`full:${id}`, { type: 'json' });
        let sid = null;
        if (full && full.collection) {
            for (const m of MODES) {
                const arr = full.collection[m] || [];
                if (arr.length && arr[0] && arr[0].beatmapset_id) { sid = arr[0].beatmapset_id; break; }
            }
        }
        if (!sid) return redirect(fallback, 300);
        return redirect(`https://assets.ppy.sh/beatmaps/${sid}/covers/cover@2x.jpg`, 3600);
    } catch {
        return redirect(fallback, 300);
    }
};
