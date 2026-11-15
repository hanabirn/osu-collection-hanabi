/* GET /card/<osu! score id>.png[?m=<ruleset>][&lang=xx] -> the score card
 * as a PNG. m marks a legacy (stable) score id, as osu! API v2's
 * /users/{id}/scores returns them (see netlify/functions/osu-score.js).
 *
 * The Discord bot can't draw the card itself (it's HTML/CSS: blur, glass,
 * gradient text), so this asks Cloudflare Browser Rendering's REST
 * "screenshot" endpoint to open the site's own card-only page
 * (/?scorecard=<id>&bare, js/score-card.js) and capture #score-card-body
 * once it is marked data-ready. The browser runs on Cloudflare's side,
 * so this Worker only waits on fetches (the free plan's 10 ms CPU limit
 * would not survive driving a browser with puppeteer here).
 *
 * Needs two secrets: CF_ACCOUNT_ID and CF_BROWSER_TOKEN (an API token
 * with the "Browser Rendering - Edit" permission). Without them it
 * answers 503 and the bot says the card isn't available.
 *
 * Every rendered card is kept in the edge cache for a day (a finished
 * score doesn't change), and the score id is checked against osu! first
 * so random ids can't spend browser time. */

const ID_RE = /^\/card\/(\d{1,20})\.png$/;
const LANGS = new Set(['zh', 'zh-Hans', 'en', 'ja', 'ko', 'ru', 'fr', 'es', 'de']);

function matchScoreCardPng(pathname) {
    const m = ID_RE.exec(pathname);
    return m ? m[1] : null;
}

const jsonError = (status, error) => new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function serveScoreCardPng(request, env, url, ctx) {
    const id = matchScoreCardPng(url.pathname);
    if (!id) return jsonError(404, 'not found');
    const lang = LANGS.has(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'zh';
    const m = ['osu', 'taiko', 'fruits', 'mania'].includes(url.searchParams.get('m')) ? url.searchParams.get('m') : '';
    const mq = m ? `&m=${m}` : '';

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/card/${id}.png?lang=${lang}${mq}`, { method: 'GET' });
    try {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
    } catch { /* cache is only a speed-up */ }

    if (!env.CF_ACCOUNT_ID || !env.CF_BROWSER_TOKEN) return jsonError(503, 'card rendering is not configured');

    // The score must exist (osu-score is itself cached for a day).
    const check = await fetch(`${url.origin}/.netlify/functions/osu-score?id=${id}${mq}`);
    if (!check.ok) return jsonError(check.status === 404 ? 404 : 502, 'score not found');

    const page = `${url.origin}/?scorecard=${id}${mq}&bare&lang=${encodeURIComponent(lang)}`;
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/screenshot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: page,
            viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
            gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
            waitForSelector: { selector: '#score-card-body[data-ready="1"]', timeout: 20000 },
            selector: '#score-card-body',
            screenshotOptions: { type: 'png' },
        }),
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        console.error('score card render failed:', res.status, detail);
        return jsonError(502, 'render failed');
    }

    const png = new Response(res.body, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
        },
    });
    try {
        const copy = png.clone();
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, copy));
        else await cache.put(cacheKey, copy);
    } catch { /* cache is only a speed-up */ }
    return png;
}

module.exports = { matchScoreCardPng, serveScoreCardPng };
