/* Self-contained, iframe-able card for one published gallery collection —
   something to drop on a forum post, blog, or tournament sheet.
   osu!Collector has no embed at all. All CSS/markup inline (no external
   requests except beatmap cover images from assets.ppy.sh), theme-aware via
   prefers-color-scheme, links out to the full collection with target=_top so
   a click escapes the iframe. */
const { getCollectionsStore } = require('./_blobs-store');

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MAX_COVERS = 12;

exports.handler = async (event) => {
    const id = (event.queryStringParameters || {}).id;
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host || 'osu-collection-hanabi.netlify.app';
    const origin = `${proto}://${host}`;

    const html = (status, inner) => ({
        statusCode: status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': status === 200 ? 'public, max-age=600' : 'no-store',
            'Access-Control-Allow-Origin': '*',
            'X-Frame-Options': 'ALLOWALL',
            'Content-Security-Policy': "frame-ancestors *",
        },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8">`
            + `<meta name="viewport" content="width=device-width,initial-scale=1">`
            + `<style>${STYLE}</style></head><body>${inner}</body></html>`,
    });

    if (!id || !/^\d+$/.test(id)) return html(400, `<div class="wrap err">Invalid collection id</div>`);

    let entry = null, full = null;
    try {
        const store = getCollectionsStore();
        const [index, data] = await Promise.all([
            store.get('index', { type: 'json' }),
            store.get(`full:${id}`, { type: 'json' }),
        ]);
        entry = (index || []).find(e => String(e.id) === String(id)) || null;
        full = data || null;
    } catch { /* fall through to 404 */ }

    if (!entry || !full) return html(404, `<div class="wrap err">Collection not found</div>`);

    const MODES = ['standard', 'taiko', 'catch', 'mania'];
    const seen = new Set();
    const sets = MODES.flatMap(m => (full.collection && full.collection[m]) || [])
        .filter(s => s && s.beatmapset_id && !seen.has(s.beatmapset_id) && seen.add(s.beatmapset_id));

    const covers = sets
        .slice()
        .sort((a, b) => {
            const ar = (a.beatmaps || []).reduce((x, y) => Math.max(x, y.difficulty_rating || 0), 0);
            const br = (b.beatmaps || []).reduce((x, y) => Math.max(x, y.difficulty_rating || 0), 0);
            return br - ar;
        })
        .slice(0, MAX_COVERS)
        .map(s => `<img loading="lazy" src="https://assets.ppy.sh/beatmaps/${s.beatmapset_id}/covers/list.jpg" alt="">`)
        .join('');

    const name = esc(entry.username || ('#' + id));
    const bits = [`${sets.length} beatmapsets`];
    if (entry.maxRating) bits.push(`up to ${Number(entry.maxRating).toFixed(2)}★`);
    if (entry.likeCount) bits.push(`♥ ${entry.likeCount}`);
    const collUrl = `${origin}/c/${id}`;

    return html(200, `
    <a class="wrap" href="${esc(collUrl)}" target="_top" rel="noopener">
        <div class="head">
            <span class="logo">osu! 歌曲收藏</span>
            <span class="title">${name}'s collection</span>
        </div>
        <div class="meta">${esc(bits.join(' · '))}</div>
        <div class="covers">${covers}</div>
        <div class="cta">View full collection →</div>
    </a>`);
};

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC","Microsoft JhengHei",sans-serif;background:transparent}
.wrap{display:flex;flex-direction:column;gap:8px;height:100%;padding:14px 16px;
  text-decoration:none;color:#1a1523;background:#faf7ff;border:1px solid #e7dcff;border-radius:14px;overflow:hidden}
.head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.logo{font-size:11px;font-weight:700;color:#a855f7;letter-spacing:.02em}
.title{font-size:15px;font-weight:700}
.meta{font-size:12px;color:#6b6480}
.covers{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;flex:1;min-height:0;margin-top:2px}
.covers img{width:100%;height:100%;object-fit:cover;border-radius:5px;background:#ece4ff}
.cta{font-size:12px;font-weight:600;color:#a855f7}
.err{align-items:center;justify-content:center;color:#6b6480}
@media (prefers-color-scheme:dark){
  .wrap{color:#f0ebff;background:#1a1626;border-color:#33294d}
  .meta,.err{color:#a79fc4}
  .covers img{background:#2a2340}
}
`;
