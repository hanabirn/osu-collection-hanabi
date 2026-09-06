/* RSS 2.0 feed of recently published / updated gallery collections.
   osu!Collector has a "recently uploaded" page but no feed — this lets
   someone follow the gallery from a feed reader. Read-only over the same
   `index` blob collections-list.js uses. Served at /gallery.xml (redirect
   in netlify.toml) as well as the raw function path. */
const { getCollectionsStore } = require('./_blobs-store');

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MAX_ITEMS = 40;

exports.handler = async (event) => {
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host || 'osu-collection-hanabi.netlify.app';
    const origin = `${proto}://${host}`;

    let index = [];
    try {
        const store = getCollectionsStore();
        index = (await store.get('index', { type: 'json' })) || [];
    } catch { /* empty feed rather than a 500 */ }

    const items = [...index]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, MAX_ITEMS)
        .map(e => {
            const link = `${origin}/c/${e.id}`;
            const title = `${e.username || ('#' + e.id)}'s osu! collection`;
            const bits = [`${e.totalSets || 0} beatmapsets`];
            if (e.maxRating) bits.push(`up to ${Number(e.maxRating).toFixed(2)}★`);
            if (e.likeCount) bits.push(`♥ ${e.likeCount}`);
            if (Array.isArray(e.tags) && e.tags.length) bits.push(e.tags.slice(0, 8).join(', '));
            const date = e.updatedAt ? new Date(e.updatedAt) : new Date();
            return `    <item>
      <title>${esc(title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${date.toUTCString()}</pubDate>
      <description>${esc(bits.join(' · '))}</description>
    </item>`;
        })
        .join('\n');

    const now = new Date().toUTCString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>osu! 歌曲收藏 — Gallery</title>
    <link>${esc(origin)}/</link>
    <atom:link href="${esc(origin)}/gallery.xml" rel="self" type="application/rss+xml" />
    <description>Recently published and updated osu! beatmap collections</description>
    <language>en</language>
    <lastBuildDate>${now}</lastBuildDate>
${items}
  </channel>
</rss>`;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=600',
            'Access-Control-Allow-Origin': '*',
        },
        body: xml,
    };
};
