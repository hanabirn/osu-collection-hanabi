/* Netlify BACKGROUND function (the `-background` suffix makes Netlify reply
   202 immediately and keep running up to 15 min). discord-interactions.js
   dispatches commands that can't finish inside Discord's 3-second window to
   here, defers the interaction (type:5), and this does the work then PATCHes
   the original message via _discord-followup.

   /practice is the first: it chains getOsuToken -> two osu! API calls ->
   farm-maps-list, which no caching can pull under 3 s.

   Public URL, so it's guarded by DISCORD_WORK_SECRET (x-work-secret header),
   same pattern as farm-crawl-run.js. */
const { getDiscordBotStore } = require('./_blobs-store');
const { buildOsdb } = require('./_osdb');
const { setLocale, t } = require('./_discord-i18n');
const { sendFollowup } = require('./_discord-followup');
const L = require('./_discord-lib');

const { PINK } = L;
const WORK_TIMEOUT_MS = 12000;

function errResult(text) { return { embeds: [{ description: text, color: PINK }] }; }

async function getLink(discordId) {
    if (!discordId) return null;
    try { return await getDiscordBotStore().get(`link:${discordId}`, { type: 'json' }); }
    catch { return null; }
}

/* Ported verbatim from discord-interactions.js cmdPractice() — same fetch to
   practice-generate.js, same embed + .osdb file, but returns a followup
   descriptor ({ embeds, file? }) instead of a Netlify response envelope. */
async function runPractice({ options, invokerId, origin }) {
    const arg = String(L.optVal(options, 'username') || '').trim();
    const link = arg ? null : await getLink(invokerId);
    const who = arg || (link && link.osuUsername);
    if (!who) return errResult(t('need_name_or_link'));

    const targetPp = Number(L.optVal(options, 'target_pp'));
    const kind = Number.isFinite(targetPp) && targetPp > 0 ? 'goal' : 'push';
    const qs = new URLSearchParams({ user: who, kind });
    if (kind === 'goal') qs.set('target', String(targetPp));

    const r = await fetch(`${origin}/.netlify/functions/practice-generate?${qs}`);
    const data = await r.json().catch(() => ({}));

    if (r.status === 404) return errResult(t('user_not_found', { name: who }));
    if (r.status === 422 && data.error === 'not enough top plays') return errResult(t('practice_need_plays'));
    if (r.status === 422) return errResult(t('practice_thin'));
    if (data.error === 'goal already reached') return errResult(t('practice_goal_reached'));
    if (!r.ok || !Array.isArray(data.maps) || !data.maps.length) return errResult(t('practice_thin'));

    const beatmaps = data.maps.map(m => ({
        mapId: m.beatmapId, mapSetId: m.setId, artist: m.artist, title: m.title,
        diff: '', md5: '', mode: 0, stars: m.stars || 0,
    }));
    const bytes = buildOsdb([{ name: data.name, beatmaps }], 'osu! Collection bot');
    const filename = `${data.name.replace(/[^\w.\- ]+/g, '').trim().slice(0, 60) || 'practice'}.osdb`;

    const preview = data.maps.slice(0, 10)
        .map(m => `${Number(m.stars).toFixed(2)}★ · [${m.artist} - ${m.title}](https://osu.ppy.sh/b/${m.beatmapId})`)
        .join('\n');
    const extra = data.maps.length - 10;
    const coverSet = (data.maps.find(m => m.setId) || {}).setId;

    return {
        embeds: [{
            title: t('practice_title', { name: data.name }),
            description: `${t('practice_summary', { count: data.count, note: data.note })}\n\n${preview}${extra > 0 ? `\n${t('practice_more', { n: extra })}` : ''}`,
            color: PINK,
            thumbnail: coverSet ? { url: `https://assets.ppy.sh/beatmaps/${coverSet}/covers/list@2x.jpg` } : undefined,
            footer: L.siteFooter(t('export_done', { name: filename })),
        }],
        file: { filename, body: bytes, contentType: 'application/octet-stream' },
    };
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
    const secret = event.headers['x-work-secret'] || event.headers['X-Work-Secret'];
    if (!process.env.DISCORD_WORK_SECRET || secret !== process.env.DISCORD_WORK_SECRET) {
        return { statusCode: 401, body: 'unauthorized' };
    }

    let job;
    try { job = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'bad json' }; }
    const { command, lang, appId, token, invokerId, options, origin } = job;
    if (!appId || !token) return { statusCode: 400, body: 'missing interaction ref' };

    setLocale(lang);

    let result;
    try {
        const work = (async () => {
            switch (command) {
                case 'practice': return await runPractice({ options, invokerId, origin });
                default: return errResult(t('unknown_command'));
            }
        })();
        result = await Promise.race([
            work,
            new Promise((_, reject) => setTimeout(() => reject(new Error('work timeout')), WORK_TIMEOUT_MS)),
        ]);
    } catch (err) {
        console.error('discord-work-background', command, err && err.message);
        result = errResult(t('deferred_timeout'));
    }

    await sendFollowup(appId, token, result);
    return { statusCode: 202, body: 'ok' };
};
