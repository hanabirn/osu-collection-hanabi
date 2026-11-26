/* 重播影片：Discord 機器人的 🎬 Render。
   流程：機器人在 KV 建一筆工作（render-job:{id}，見 discord-interactions.js
   startRender）→ 請求者打開 /?render={id}，瀏覽器把重播錄成 mp4
   （js/replay/player.js renderVideo）→ 分段上傳到 R2 osu-replays 的
   video/{id}.mp4 → 完成時機器人把影片網址貼回原頻道，Discord 會直接播放。
   影片 30 天後由 R2 lifecycle（prefix video/）自動刪除。

   /.netlify/functions/replay-render?job=ID                 GET   工作內容
                                    &action=start           POST  開始分段上傳
                                    &action=part&n=1        PUT   一段（原始位元組）
                                    &action=complete        POST  {parts, meta} 完成並貼到 Discord
   /video/{id}.mp4                                          GET   影片（支援 Range） */

const ID_RE = /^[a-f0-9]{32}$/;
const VIDEO_RE = /^\/video\/([a-f0-9]{32})\.mp4$/;
const MAX_PART = 64 * 1024 * 1024;     // Workers 的請求本文上限之內
const MAX_PARTS = 12;                  // 最多約 768MB，實際影片遠小於此
const JOB_TTL = 24 * 3600;
const PAGE_RE = /^[/]v[/]([a-f0-9]{32})[/]?$/;

const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const jobKey = (id) => `render-job:${id}`;
async function readJob(env, id) {
    if (!ID_RE.test(id || '') || !env.KV_RESP_CACHE) return null;
    try { return await env.KV_RESP_CACHE.get(jobKey(id), 'json'); } catch { return null; }
}
const saveJob = (env, id, job) => env.KV_RESP_CACHE.put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL });

function matchVideoPage(pathname) {
    const m = PAGE_RE.exec(pathname);
    return m ? m[1] : null;
}

/* /v/{id}: a page for the video with Open Graph video tags (as o!rdr's links
   have), so Discord shows it as a video embed with the map's cover, rather
   than the small player it gives a bare .mp4 link. In a browser it is just
   the video. */
async function serveVideoPage(request, env, url) {
    const id = matchVideoPage(url.pathname);
    const job = id ? await readJob(env, id) : null;
    const head = id && env.R2_REPLAYS ? await env.R2_REPLAYS.head(`video/${id}.mp4`) : null;
    if (!head) return new Response('not found', { status: 404 });
    const meta = (job && job.meta) || {};
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const video = `${url.origin}/video/${id}.mp4`;
    // as o!rdr's: "[6.16 ⭐] PLAYER | Artist - Title [Diff] +MODS 72.55%"
    const title = meta.title
        ? `${meta.stars ? `[${Number(meta.stars).toFixed(2)} ⭐] ` : ''}${meta.player || ''} | ${meta.artist ? `${meta.artist} - ` : ''}${meta.title} [${meta.version || ''}]${meta.mods ? ` +${meta.mods}` : ''}${Number.isFinite(meta.acc) ? ` ${(meta.acc * 100).toFixed(2)}%` : ''}`
        : 'osu! replay';
    const desc = 'osu! Collection';
    const image = meta.setId ? `https://assets.ppy.sh/beatmaps/${Number(meta.setId)}/covers/card@2x.jpg` : `${url.origin}/assets/icons/icon-512.png`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:site_name" content="osu! Collection">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="video.other">
<meta property="og:url" content="${esc(`${url.origin}/v/${id}`)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:video" content="${esc(video)}">
<meta property="og:video:url" content="${esc(video)}">
<meta property="og:video:secure_url" content="${esc(video)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">
<meta name="theme-color" content="#f472b6">
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%}</style>
</head><body><video src="${esc(video)}" controls autoplay playsinline></video></body></html>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

function matchVideo(pathname) {
    const m = VIDEO_RE.exec(pathname);
    return m ? m[1] : null;
}

async function serveVideo(request, env, url) {
    const id = matchVideo(url.pathname);
    if (!id || !env.R2_REPLAYS) return new Response('not found', { status: 404 });
    const key = `video/${id}.mp4`;
    const range = request.headers.get('range');
    let r2Range;
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (m) {
            if (m[1] === '' && m[2] !== '') r2Range = { suffix: Number(m[2]) };
            else if (m[1] !== '') r2Range = m[2] === '' ? { offset: Number(m[1]) } : { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 };
        }
    }
    const obj = request.method === 'HEAD' ? await env.R2_REPLAYS.head(key) : await env.R2_REPLAYS.get(key, r2Range ? { range: r2Range } : undefined);
    if (!obj) return new Response('not found', { status: 404 });
    const headers = new Headers({
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
    });
    const size = obj.size;
    if (request.method === 'HEAD') { headers.set('Content-Length', String(size)); return new Response(null, { status: 200, headers }); }
    if (r2Range && obj.range) {
        const start = obj.range.offset != null ? obj.range.offset : size - obj.range.suffix;
        const len = obj.range.length != null ? obj.range.length : size - start;
        headers.set('Content-Range', `bytes ${start}-${start + len - 1}/${size}`);
        headers.set('Content-Length', String(len));
        return new Response(obj.body, { status: 206, headers });
    }
    headers.set('Content-Length', String(size));
    return new Response(obj.body, { status: 200, headers });
}

// the message that brings the video into the channel the button was pressed in
async function postToDiscord(env, job, pageUrl) {
    // the /v/ page: Discord turns its Open Graph tags into a video embed (map,
    // player and mods in its title), larger than the player a bare .mp4 gets
    const body = JSON.stringify({ content: `${pageUrl} 🎬 <@${job.userId}>`, allowed_mentions: { users: [String(job.userId)] } });
    // the bot's own message in the channel (works however long the render took)
    if (env.DISCORD_BOT_TOKEN && job.channelId) {
        const res = await fetch(`https://discord.com/api/v10/channels/${job.channelId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body,
        }).catch(() => null);
        if (res && res.ok) return true;
    }
    // where the bot isn't in the server (a user-installed app): a follow-up to the
    // interaction, while its token lasts (15 minutes)
    if (job.appId && job.token && Date.now() - job.created < 14.5 * 60 * 1000) {
        const res = await fetch(`https://discord.com/api/v10/webhooks/${job.appId}/${job.token}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }).catch(() => null);
        if (res && res.ok) return true;
    }
    return false;
}

async function serveRenderApi(request, env, url) {
    const id = url.searchParams.get('job') || '';
    const action = url.searchParams.get('action') || '';
    const job = await readJob(env, id);
    if (!job) return json(404, { error: 'No such render (links last a day)' });
    const key = `video/${id}.mp4`;
    const origin = `${url.protocol}//${url.host}`;

    if (request.method === 'GET' && !action) {
        return json(200, { scoreId: job.scoreId, mode: job.mode, status: job.status, video: job.status === 'done' ? `${origin}/video/${id}.mp4` : null });
    }
    if (!env.R2_REPLAYS) return json(503, { error: 'Storage unavailable' });
    if (job.status === 'done') return json(409, { error: 'Already rendered', video: `${origin}/video/${id}.mp4` });

    if (action === 'start' && request.method === 'POST') {
        const up = await env.R2_REPLAYS.createMultipartUpload(key, { httpMetadata: { contentType: 'video/mp4' } });
        job.uploadId = up.uploadId;
        job.status = 'uploading';
        await saveJob(env, id, job);
        return json(200, { ok: true });
    }
    if (action === 'part' && request.method === 'PUT') {
        const n = Number(url.searchParams.get('n'));
        if (!job.uploadId || !Number.isInteger(n) || n < 1 || n > MAX_PARTS) return json(400, { error: 'Bad part' });
        const len = Number(request.headers.get('content-length') || 0);
        if (!len || len > MAX_PART) return json(413, { error: 'Part too large' });
        const up = env.R2_REPLAYS.resumeMultipartUpload(key, job.uploadId);
        const part = await up.uploadPart(n, request.body);
        return json(200, { partNumber: part.partNumber, etag: part.etag });
    }
    if (action === 'complete' && request.method === 'POST') {
        if (!job.uploadId) return json(400, { error: 'Not started' });
        const data = await request.json().catch(() => null);
        const parts = data && Array.isArray(data.parts) ? data.parts.filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string').slice(0, MAX_PARTS) : [];
        if (!parts.length) return json(400, { error: 'No parts' });
        const up = env.R2_REPLAYS.resumeMultipartUpload(key, job.uploadId);
        await up.complete(parts);
        const videoUrl = `${origin}/video/${id}.mp4`;
        job.status = 'done';
        delete job.uploadId;
        const m0 = (data && data.meta) || {};
        // kept for the /v/{id} page's preview
        job.meta = { artist: String(m0.artist || '').slice(0, 80), stars: Number(m0.stars) || 0, title: String(m0.title || '').slice(0, 120), version: String(m0.version || '').slice(0, 80), player: String(m0.player || '').slice(0, 40), mods: String(m0.mods || '').slice(0, 30), acc: Number(m0.acc), setId: Number(m0.setId) || 0 };
        const posted = await postToDiscord(env, job, `${origin}/v/${id}`);
        delete job.token; // not needed any more
        await saveJob(env, id, job);
        return json(200, { video: videoUrl, posted });
    }
    return json(400, { error: 'Unknown action' });
}

module.exports = { matchVideo, serveVideo, matchVideoPage, serveVideoPage, serveRenderApi, jobKey, JOB_TTL };
