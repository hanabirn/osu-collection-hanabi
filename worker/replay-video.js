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
async function postToDiscord(env, job, videoUrl, meta) {
    const clip = (s, n) => String(s == null ? '' : s).replace(/[\r\n`*_~|>@#<]/g, ' ').trim().slice(0, n);
    const lines = [
        `🎬 <@${job.userId}>`,
        `**${clip(meta.title, 90)}** [${clip(meta.version, 60)}] · ${clip(meta.player, 32)}${meta.mods ? ` +${clip(meta.mods, 30)}` : ''}${Number.isFinite(meta.acc) ? ` · ${(meta.acc * 100).toFixed(2)}%` : ''}`,
        videoUrl,
    ];
    const body = JSON.stringify({ content: lines.join('\n'), allowed_mentions: { users: [String(job.userId)] } });
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
        const posted = await postToDiscord(env, job, videoUrl, (data && data.meta) || {});
        delete job.token; // not needed any more
        await saveJob(env, id, job);
        return json(200, { video: videoUrl, posted });
    }
    return json(400, { error: 'Unknown action' });
}

module.exports = { matchVideo, serveVideo, serveRenderApi, jobKey, JOB_TTL };
