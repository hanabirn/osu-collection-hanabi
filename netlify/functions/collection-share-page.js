/* Crawler-facing HTML for /c/:id (netlify.toml rewrites that path here).
   Serves OpenGraph / Twitter-card meta for a published gallery collection so
   a pasted link unfurls into a rich card, then bounces real browsers to the
   SPA at /?c=<id> (js/public-collections.js checkGalleryDeepLink opens the
   detail modal there). Personal #hash share links can't use this — the
   fragment never reaches the server. */
const { getCollectionsStore } = require('./_blobs-store');

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

exports.handler = async (event) => {
    const id = (event.queryStringParameters || {}).id;
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host || '';
    const origin = `${proto}://${host}`;

    const page = (status, headHtml, bodyHtml) => ({
        statusCode: status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8">${headHtml}</head><body>${bodyHtml}</body></html>`,
    });

    if (!id || !/^\d+$/.test(id)) {
        return page(404, '<title>Not found</title>', 'Collection not found.');
    }

    let entry = null;
    try {
        const store = getCollectionsStore();
        const index = (await store.get('index', { type: 'json' })) || [];
        entry = index.find(e => String(e.id) === String(id)) || null;
    } catch { /* fall through */ }

    if (!entry) {
        return page(404, '<title>Not found</title>', 'Collection not found.');
    }

    const title = `${entry.username || ('#' + id)}'s osu! collection`;
    const bits = [`${entry.totalSets || 0} beatmapsets`];
    if (entry.maxRating) bits.push(`up to ${Number(entry.maxRating).toFixed(2)}★`);
    if (entry.likeCount) bits.push(`♥ ${entry.likeCount}`);
    const desc = bits.join(' · ');
    const pageUrl = `${origin}/c/${id}`;
    const imgUrl = `${origin}/.netlify/functions/og-collection?id=${id}`;
    const appUrl = `/?c=${id}`;

    const head = [
        `<title>${esc(title)}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="osu! Collection">`,
        `<meta property="og:title" content="${esc(title)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:url" content="${esc(pageUrl)}">`,
        `<meta property="og:image" content="${esc(imgUrl)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${esc(title)}">`,
        `<meta name="twitter:description" content="${esc(desc)}">`,
        `<meta name="twitter:image" content="${esc(imgUrl)}">`,
        `<link rel="canonical" href="${esc(pageUrl)}">`,
        `<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">`,
    ].join('');
    const body = `<script>location.replace(${JSON.stringify(appUrl)})</script>`
        + `<p>Opening <a href="${esc(appUrl)}">this collection</a>…</p>`;

    return page(200, head, body);
};
