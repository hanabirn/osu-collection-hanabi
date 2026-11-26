/* Discord bot — HTTP Interactions endpoint (no persistent gateway).
   Discord POSTs every slash-command / autocomplete / message-component
   interaction here; we verify the Ed25519 signature (see _discord-lib.js),
   then answer synchronously within the 3 s window. Every command is one or
   two blob reads / internal fetches, comfortably under budget, so there is
   no deferred-response dance.

   Response text is localized to the invoker's client locale — the handler
   calls setLocale(interaction.locale) once, then t(key, params) is used
   everywhere (see _discord-i18n.js). Command-picker text is localized
   separately via Discord's description_localizations (register script).

   Endpoint URL (set in the Discord developer portal):
     https://osu.hanabirn.xyz/discord
   (netlify.toml rewrites /discord -> here.)

   Env: DISCORD_PUBLIC_KEY (signature). OSU_CLIENT_ID/SECRET (osu! API v2,
   via _osu-auth) and NETLIFY_BLOBS_* are already set for the rest of the
   site. Command definitions: scripts/register-discord-commands.mjs — run
   `npm run discord:register` after changing them. */
const { getCollectionsStore, getDiscordBotStore } = require('./_blobs-store');
const { getOsuToken } = require('./_osu-auth');
const { setLocale, getLocale, runWithLocale, t, LANG_NAMES, KNOWN_KEYS } = require('./_discord-i18n');
const { getCtx, getEnv } = require('./_cf-env');
const { buildOsdb, MODE_INT } = require('./_osdb');
const { messageWithFile } = require('./_discord-attach');
const L = require('./_discord-lib');

const { PINK } = L;

/* --- osu! account link (so /pp /recent /top work with no argument) ------ */

async function getLink(discordId) {
    if (!discordId) return null;
    try {
        return await getDiscordBotStore().get(`link:${discordId}`, { type: 'json' });
    } catch {
        return null;
    }
}

// The language a user picked with /language, if any (a bare key string).
async function getUserLang(discordId) {
    if (!discordId) return null;
    try {
        const v = await getDiscordBotStore().get(`lang:${discordId}`, { type: 'json' });
        return typeof v === 'string' && KNOWN_KEYS.has(v) ? v : null;
    } catch {
        return null;
    }
}

async function cmdLanguage(options, interaction) {
    const uid = L.invokerId(interaction);
    const choice = String(L.optVal(options, 'lang') || '');
    const store = getDiscordBotStore();
    if (choice === 'auto' || !KNOWN_KEYS.has(choice)) {
        try { await store.delete(`lang:${uid}`); } catch { /* ignore */ }
        setLocale(interaction.locale);
        return L.ephemeral(t('lang_auto'));
    }
    await store.setJSON(`lang:${uid}`, choice);
    setLocale(choice); // answer in the just-chosen language
    return L.ephemeral(t('lang_set', { lang: LANG_NAMES[choice] }));
}

async function cmdLink(options, interaction) {
    const name = String(L.optVal(options, 'username') || '').trim();
    if (!name) return L.ephemeral(t('link_need_name'));
    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, name, '');
    if (!u) return L.ephemeral(t('user_not_found', { name }));
    await getDiscordBotStore().setJSON(`link:${L.invokerId(interaction)}`, {
        osuUserId: u.id, osuUsername: u.username, linkedAt: new Date().toISOString(),
    });
    return L.ephemeral(t('link_done', { name: u.username, id: u.id }));
}

async function cmdUnlink(interaction) {
    await getDiscordBotStore().delete(`link:${L.invokerId(interaction)}`);
    return L.ephemeral(t('unlink_done'));
}

// The osu! identity a /pp|/recent|/top call should act on: explicit arg wins,
// else the caller's linked account.
async function resolveWho(options, interaction) {
    const arg = String(L.optVal(options, 'username') || '').trim();
    if (arg) return arg;
    const link = await getLink(L.invokerId(interaction));
    return link ? link.osuUsername : null;
}

/* --- /pp -------------------------------------------------------------- */

async function cmdPp(options, interaction) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(t('user_not_found', { name: who }));
    const s = u.statistics || {};
    const g = s.grade_counts || {};
    const playHours = s.play_time != null ? t('hours', { n: Math.round(s.play_time / 3600).toLocaleString('en-US') }) : '—';
    const rankHist = (u.rank_history && u.rank_history.data) || (u.rankHistory && u.rankHistory.data) || [];
    const rankChart = L.rankChartUrl(rankHist);

    return L.message({
        author: L.osuAuthor(u, apiMode),
        title: `${L.modeTag(apiMode) ? L.modeTag(apiMode) + ' ' : ''}${u.username} — ${L.MODE_LABEL[apiMode]}`,
        url: `https://osu.ppy.sh/users/${u.id}/${apiMode}`,
        color: L.rankColor(s.global_rank),
        thumbnail: u.avatar_url ? { url: u.avatar_url } : undefined,
        image: rankChart ? { url: rankChart } : undefined,
        fields: [
            { name: t('f_pp'), value: s.pp != null ? `${Math.round(s.pp).toLocaleString('en-US')}pp` : '—', inline: true },
            { name: t('f_global_rank'), value: s.global_rank ? `#${L.fmtNum(s.global_rank)}` : '—', inline: true },
            { name: t('f_country_rank', { cc: u.country_code || t('country_word') }), value: s.country_rank ? `#${L.fmtNum(s.country_rank)}` : '—', inline: true },
            { name: t('f_acc'), value: s.hit_accuracy != null ? `${s.hit_accuracy.toFixed(2)}%` : '—', inline: true },
            { name: t('f_playcount'), value: L.fmtNum(s.play_count), inline: true },
            { name: t('f_level'), value: s.level && s.level.current != null ? String(s.level.current) : '—', inline: true },
            { name: t('f_max_combo'), value: L.fmtNum(s.maximum_combo), inline: true },
            { name: t('f_playtime'), value: playHours, inline: true },
            { name: t('f_grades'), value: `${L.GRADE_EMOJI.SS}${L.fmtNum(g.ss || 0)} ${L.GRADE_EMOJI.SSH}${L.fmtNum(g.ssh || 0)} ${L.GRADE_EMOJI.S}${L.fmtNum(g.s || 0)} ${L.GRADE_EMOJI.SH}${L.fmtNum(g.sh || 0)} ${L.GRADE_EMOJI.A}${L.fmtNum(g.a || 0)}`, inline: false },
        ],
        footer: L.siteFooter(rankChart ? t('footer_rank_trend') : t('api_v2')),
    });
}

/* --- /recent & /top ------------------------------------------------------- */

/* --- 成績卡 / 加入收藏 ------------------------------------------------
   Buttons under a score: 🖼 posts the site's score card as an image
   (rendered by worker/score-card-png.js), ➕ queues the map for the
   linked osu! account's site collection (picked up on the next sign-in,
   see netlify/functions/discord-inbox.js), and a link opens the card on
   the site. A score from /users/{id}/scores carries a legacy id, so the
   ruleset travels with it (m=). */

// bot locale -> site language for the card's labels
const SITE_LANG = { zh: 'zh', zhs: 'zh-Hans', en: 'en', ja: 'ja', fr: 'fr', de: 'de', ru: 'ru', es: 'es', ko: 'ko' };

function scoreCardSiteUrl(origin, scoreId, apiMode) {
    return `${origin}/?scorecard=${scoreId}${apiMode ? `&m=${apiMode}` : ''}`;
}

const hasReplay = (x) => !!x && x.replay !== false && x.has_replay !== false;

function scoreActionRow(score, apiMode, origin) {
    const setId = (score.beatmapset && score.beatmapset.id) || (score.beatmap && score.beatmap.beatmapset_id);
    const btns = [];
    if (score.id) btns.push({ type: 2, style: 1, label: t('btn_card'), custom_id: `card|${apiMode}|${score.id}` });
    if (setId) btns.push({ type: 2, style: 2, label: t('btn_fav'), custom_id: `fav|${setId}` });
    // 🎬 Render: only when osu! keeps this score's replay
    if (score.id && hasReplay(score)) btns.push({ type: 2, style: 2, label: t('btn_render'), custom_id: `rend|${apiMode}|${score.id}` });
    // 🆚: a video of this score against another one on the map's leaderboard
    const mapId = score.beatmap && score.beatmap.id;
    if (score.id && mapId && hasReplay(score)) btns.push({ type: 2, style: 2, label: t('btn_vs'), custom_id: `vs|${apiMode}|${score.id}|${mapId}` });
    if (score.id && origin) btns.push({ type: 2, style: 5, label: t('btn_site'), url: scoreCardSiteUrl(origin, score.id, apiMode) });
    return btns.length ? [{ type: 1, components: btns }] : [];
}

/* 🎬 Render: a job in KV and a link, seen only by whoever pressed. Their
   browser draws the replay into a video with the site's player and their
   own skin, uploads it, and the bot posts it in this channel
   (worker/replay-video.js). */
async function startRender(interaction, origin, apiMode, scoreId, scoreIdB) {
    const env = getEnv();
    const kv = env && env.KV_RESP_CACHE;
    if (!kv) return L.ephemeral(t('render_unavailable'));
    const userId = (interaction.member && interaction.member.user && interaction.member.user.id) || (interaction.user && interaction.user.id);
    const channelId = interaction.channel_id || (interaction.channel && interaction.channel.id);
    const id = crypto.randomUUID().replace(/-/g, '');
    const job = { scoreId, scoreIdB: scoreIdB || null, mode: apiMode || '', userId, channelId, appId: interaction.application_id, token: interaction.token, created: Date.now(), status: 'new' };
    try { await kv.put(`render-job:${id}`, JSON.stringify(job), { expirationTtl: 24 * 3600 }); }
    catch { return L.ephemeral(t('render_unavailable')); }
    return L.json({
        type: L.R.MESSAGE,
        data: {
            content: t('render_ready'),
            flags: L.EPHEMERAL,
            components: [{ type: 1, components: [{ type: 2, style: 5, label: t('btn_render_open'), url: `${origin}/?render=${id}` }] }],
            allowed_mentions: { parse: [] },
        },
    });
}

/* 🆚: the map's leaderboard scores that have a replay and the same speed
   (DT / HT), as a menu seen only by whoever pressed. */
const RATE_CLASS = (mods) => { const m = (mods || []).map((x) => (typeof x === 'string' ? x : x && x.acronym)); return m.some((x) => x === 'DT' || x === 'NC') ? 'fast' : m.some((x) => x === 'HT' || x === 'DC') ? 'slow' : 'normal'; };
async function versusPick(origin, apiMode, scoreId, mapId) {
    let list = [];
    try {
        const r = await fetch(`${origin}/.netlify/functions/replay-scores?b=${mapId}&mode=${apiMode}`);
        if (r.ok) list = ((await r.json()).scores || []).map((s, i) => ({ ...s, place: i + 1 }));
    } catch { list = []; }
    const me = list.find((s) => String(s.id) === String(scoreId));
    // the pressed score may not be on the board: its speed then comes from osu!
    let cls = me ? RATE_CLASS(me.mods) : null;
    if (!cls) {
        try {
            const token = await getOsuToken();
            const r = await fetch(`https://osu.ppy.sh/api/v2/scores/${scoreId}`, { headers: { Authorization: `Bearer ${token}`, 'x-api-version': '20240529' } });
            cls = r.ok ? RATE_CLASS((await r.json()).mods) : 'normal';
        } catch { cls = 'normal'; }
    }
    const options = list.filter((s) => s.replay !== false && String(s.id) !== String(scoreId) && RATE_CLASS(s.mods) === cls).slice(0, 25).map((s) => ({
        label: `#${s.place} ${s.user ? s.user.name : '?'}`.slice(0, 100),
        description: `${s.mods.length ? '+' + s.mods.join('') + ' · ' : ''}${(s.acc * 100).toFixed(2)}%${s.pp ? ` · ${Math.round(s.pp)}pp` : ''}`.slice(0, 100),
        value: String(s.id),
    }));
    if (!options.length) return L.ephemeral(t('vs_none'));
    return L.json({ type: L.R.MESSAGE, data: { flags: L.EPHEMERAL, content: t('vs_intro'), components: [{ type: 1, components: [{ type: 3, custom_id: `vssel|${apiMode}|${scoreId}`, placeholder: t('vs_pick'), options }] }], allowed_mentions: { parse: [] } } });
}

/* /versus: two osu! score links (or ids) → a 🆚 video of the two. */
function scoreLinkRef(text) {
    const s = String(text || '').trim();
    const m = /scores\/(?:(osu|taiko|fruits|mania)\/)?(\d{1,20})/.exec(s) || (/^\d{1,20}$/.test(s) ? [s, null, s] : null);
    return m ? { mode: m[1] || '', id: m[2] } : null;
}
async function cmdVersus(options, interaction, origin) {
    const a = scoreLinkRef(L.optVal(options, 'score_a'));
    const b = scoreLinkRef(L.optVal(options, 'score_b'));
    if (!a || !b) return L.ephemeral(t('vs_bad_link'));
    if (a.id === b.id) return L.ephemeral(t('vs_same'));
    return startRender(interaction, origin, a.mode || b.mode || '', a.id, b.id);
}

/* Answer at once ("thinking…"), then render the card and replace the
   placeholder with it: Discord allows 3 s for the first answer, the
   render takes several. */
function startScoreCard(interaction, origin, apiMode, scoreId) {
    const work = renderScoreCardInto(interaction, origin, apiMode, scoreId, getLocale());
    const ctx = getCtx();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work);
    return L.json({ type: L.R.DEFERRED_MESSAGE });
}

async function renderScoreCardInto(interaction, origin, apiMode, scoreId, locale) {
    const hook = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
    const say = (content) => fetch(hook, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    }).catch(() => null);
    try {
        let serve = null;
        try { ({ serveScoreCardPng: serve } = require('../../worker/score-card-png')); } catch { serve = null; }
        const env = getEnv();
        if (!serve || !env) return say(t('card_unavailable'));
        const lang = SITE_LANG[locale] || 'en';
        const url = new URL(`${origin}/card/${scoreId}.png?lang=${lang}${apiMode ? `&m=${apiMode}` : ''}`);
        const res = await serve(new Request(url.toString()), env, url, getCtx());
        if (res.status === 503) return say(t('card_unavailable'));
        if (!res.ok) return say(t('card_fail'));
        const png = await res.arrayBuffer();
        const form = new FormData();
        form.append('payload_json', JSON.stringify({
            content: '',
            embeds: [{ color: PINK, image: { url: 'attachment://score.png' }, footer: L.siteFooter() }],
            attachments: [{ id: 0, filename: 'score.png' }],
            components: [{ type: 1, components: [{ type: 2, style: 5, label: t('btn_site'), url: scoreCardSiteUrl(origin, scoreId, apiMode) }] }],
            allowed_mentions: { parse: [] },
        }));
        form.append('files[0]', new Blob([png], { type: 'image/png' }), 'score.png');
        await fetch(hook, { method: 'PATCH', body: form });
    } catch (err) {
        console.error('score card for discord failed:', err && (err.stack || err));
        await say(t('card_fail'));
    }
}

/* ➕ 加入收藏: queue the beatmapset under the caller's linked osu! id. */
async function addToCollectionInbox(interaction, setId) {
    const link = await getLink(L.invokerId(interaction));
    if (!link) return L.ephemeral(t('fav_need_link'));
    const store = getDiscordBotStore();
    const key = `inbox:${link.osuUserId}`;
    let list = [];
    try { list = (await store.get(key, { type: 'json' })) || []; } catch { list = []; }
    const id = Number(setId);
    if (list.some((x) => x.s === id)) return L.ephemeral(t('fav_already', { name: link.osuUsername }));
    list.push({ s: id, at: Date.now() });
    await store.setJSON(key, list.slice(-200));
    return L.ephemeral(t('fav_added', { name: link.osuUsername }));
}

// apiVersion '20240529' = the lazer score format (total_score, statistics
// great/ok/..., mod objects), which has the score lazer plays show; the
// legacy format gives those a score of 0.
async function fetchScores(token, userId, type, apiMode, limit, includeFails, apiVersion) {
    const p = new URLSearchParams({ mode: apiMode, limit: String(limit) });
    if (type === 'recent') p.set('include_fails', includeFails ? '1' : '0');
    const res = await fetch(`https://osu.ppy.sh/api/v2/users/${userId}/scores/${type}?${p}`, {
        headers: { Authorization: `Bearer ${token}`, ...(apiVersion ? { 'x-api-version': apiVersion } : {}) },
    });
    if (!res.ok) throw new Error(`osu! API ${res.status}`);
    return res.json();
}

/* --- /top pagination (5 scores/page, top 50, one embed per score with a
   thumbnail cover) — shared by the initial command and the ◀▶ buttons. --- */
const TOP_PER_PAGE = 5;
const TOP_MAX = 50;

function topScoreEmbed(s, rank, apiMode) {
    const bs = s.beatmapset || {};
    const bm = s.beatmap || {};
    const covers = bs.covers || {};
    const modStr = L.modsTag(s.mods);
    const mods = L.modsList(s.mods);
    const acc = s.accuracy != null ? `${(s.accuracy * 100).toFixed(2)}%` : '—';
    const pp = s.pp != null ? `${Math.round(s.pp)}pp` : (s.passed === false ? t('not_passed') : '—');
    return {
        title: `#${rank} · ${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]`.slice(0, 250),
        url: bm.url || (bm.id ? `https://osu.ppy.sh/b/${bm.id}` : undefined),
        description: [
            `${L.gradeTag(s.rank)}${modStr ? ' ' + modStr : ''}${mods.length ? ` **+${mods.join('')}**` : ''} · ${acc} · **${pp}**`,
            `${bm.difficulty_rating != null ? Number(bm.difficulty_rating).toFixed(2) : '?'}★ · ${L.ago(s.created_at)}`,
        ].join('\n'),
        thumbnail: { url: covers['list@2x'] || covers.list || covers.card || undefined },
        color: L.srColor(bm.difficulty_rating),
    };
}

// { id, username, avatar_url } is enough — the component path (no fresh
// osu! API user lookup) only has that much.
function topPage(u, apiMode, scores, page) {
    const total = Math.min(scores.length, TOP_MAX);
    const pages = Math.max(1, Math.ceil(total / TOP_PER_PAGE));
    page = Math.max(0, Math.min(pages - 1, Number(page) || 0));
    const start = page * TOP_PER_PAGE;

    const embeds = scores.slice(start, start + TOP_PER_PAGE)
        .map((s, i) => topScoreEmbed(s, start + i + 1, apiMode));
    if (embeds[0]) embeds[0].author = L.osuAuthor(u, apiMode);
    const last = embeds[embeds.length - 1];
    if (last) {
        last.footer = L.siteFooter(`${t('top_title', { name: u.username, mode: L.MODE_LABEL[apiMode], n: total })} · ${page + 1}/${pages}`);
    }

    const cid = (p) => `top|${u.id}|${apiMode}|${Math.max(0, p)}|${encodeURIComponent(u.username)}`;
    const pageScores = scores.slice(start, start + TOP_PER_PAGE);
    const components = [];
    if (pageScores.some((x) => x.id)) {
        components.push({ type: 1, components: [{
            type: 3,
            custom_id: 'cardsel',
            placeholder: t('card_pick'),
            options: pageScores.map((x, i) => ({ x, n: start + i + 1 })).filter((o) => o.x.id).map(({ x, n }) => ({
                label: `#${n} ${(x.beatmapset && x.beatmapset.title) || ''} [${(x.beatmap && x.beatmap.version) || ''}]`.slice(0, 100),
                value: `${apiMode}|${x.id}`,
            })),
        }] });
        const withReplay = pageScores.map((x, i) => ({ x, n: start + i + 1 })).filter((o) => o.x.id && hasReplay(o.x));
        if (withReplay.length) {
            components.push({ type: 1, components: [{
                type: 3,
                custom_id: 'rendsel',
                placeholder: t('render_pick'),
                options: withReplay.map(({ x, n }) => ({
                    label: `#${n} ${(x.beatmapset && x.beatmapset.title) || ''} [${(x.beatmap && x.beatmap.version) || ''}]`.slice(0, 100),
                    value: `${apiMode}|${x.id}`,
                })),
            }] });
        }
    }
    components.push({
        type: 1,
        components: [
            { type: 2, style: 2, label: t('page_prev'), custom_id: cid(page - 1), disabled: page === 0 },
            { type: 2, style: 2, label: t('page_next'), custom_id: cid(page + 1), disabled: page >= pages - 1 },
        ],
    });
    return { embeds, components };
}

/* One score in detail (/recent, /rs…, /top index): the hit counts, pp next
   to pp if FC, the map's numbers with the score's mods, and for a fail how
   far it got. `ex` comes from _score-calc (null if the map file couldn't be
   read: the embed then shows what the API alone gives). */
const trimNum = (v, d = 1) => (v == null || !Number.isFinite(v) ? '?' : String(Number(v.toFixed(d))));
const STATUS_LABEL = { ranked: 'Ranked', approved: 'Approved', qualified: 'Qualified', loved: 'Loved', pending: 'Pending', wip: 'WIP', graveyard: 'Graveyard' };

// Country code -> a Twemoji flag PNG (CC BY 4.0, credited on the 資源 page).
// Not osu-web's own flag art (AGPL).
function flagImageUrl(code) {
    if (!/^[A-Za-z]{2}$/.test(code || '')) return null;
    const cps = [...code.toUpperCase()].map((c) => (0x1f1e6 + c.charCodeAt(0) - 65).toString(16)).join('-');
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${cps}.png`;
}

function detailedScoreEmbed(score, user, apiMode, ex, { tries, heading, rankedDate } = {}) {
    const bs = score.beatmapset || {};
    const bm = score.beatmap || {};
    const mode = score.mode || apiMode;
    const modStr = L.modsTag(score.mods);
    const passed = score.passed !== false;
    const acc = score.accuracy != null ? `${(score.accuracy * 100).toFixed(2)}%` : '—';
    const pp = ex ? ex.pp : (score.pp != null ? Number(score.pp) : null);
    const ppFc = ex ? ex.ppFc : null;
    const maxCombo = (ex && ex.maxCombo) || bm.max_combo;

    const p1 = (v) => Number(v).toFixed(1);
    let ppPart;
    if (!passed) ppPart = ppFc != null ? `FC ${p1(ppFc)}pp` : t('not_passed');
    else if (pp == null) ppPart = '—';
    else if (ppFc != null && ppFc > pp && p1(ppFc) !== p1(pp)) ppPart = `**${p1(pp)}** / FC ${p1(ppFc)}pp`;
    else ppPart = `**${p1(pp)}pp**`;

    const hits = (() => {
        try {
            const { hitLine } = require('./_score-calc');
            return hitLine(score, mode).filter(([k]) => k !== 'miss').map(([k, v]) => `${k} ${v}`).join(' · ');
        } catch { return ''; }
    })();
    const missCount = (() => {
        try { return require('./_score-calc').hitCounts(score, { osu: 0, taiko: 1, fruits: 2, mania: 3 }[mode] ?? 0).misses; } catch { return 0; }
    })();

    const stars = ex && ex.stars != null ? ex.stars : bm.difficulty_rating;
    const len = ex ? ex.length : bm.total_length;
    const bpm = ex ? ex.bpm : bm.bpm;
    let attrLine = '';
    if (ex) {
        if (mode === 'mania') attrLine = `${ex.keys}K OD ${trimNum(ex.od)} HP ${trimNum(ex.hp)}`;
        else if (mode === 'taiko') attrLine = `OD ${trimNum(ex.od)} HP ${trimNum(ex.hp)}`;
        else attrLine = `CS ${trimNum(ex.cs)} AR ${trimNum(ex.ar)} OD ${trimNum(ex.od)} HP ${trimNum(ex.hp)}`;
    } else if (bm.cs != null) {
        attrLine = mode === 'mania' ? `${Math.round(bm.cs)}K OD ${bm.accuracy} HP ${bm.drain}` : `CS ${bm.cs} AR ${bm.ar} OD ${bm.accuracy} HP ${bm.drain}`;
    }
    // One line of grey code chips: length · map numbers · BPM.
    const mapLine = ['`' + L.fmtLen(len) + '`', attrLine ? '`' + attrLine + '`' : '', '`' + trimNum(bpm, 0) + ' BPM`'].filter(Boolean).join(' · ');

    const lines = [
        // ### heading: Discord sizes emojis with the text, so the grade and
        // mod badges come out larger than on a normal line.
        `### ${passed ? L.gradeTag(score.rank) : '**F**'}${modStr ? ' ' + modStr : ''} · ${L.fmtNum(score.total_score || score.score || score.legacy_total_score || 0)}`,
        [ppPart, `**${L.fmtNum(score.max_combo)}x**${maxCombo ? `/${L.fmtNum(maxCombo)}x` : ''}`, `${missCount} ❌`, acc].join(' · '),
        hits ? '`' + hits + '`' : '',
        mapLine,
    ];
    if (!passed && ex && ex.progress != null) {
        lines.push(`❌ ${t('fail_line', { p: Math.round(ex.progress * 100), pp: ex.ppIfPassed != null ? p1(ex.ppIfPassed) : '?' })}`);
    }

    const st = user && user.statistics;
    const rankBit = st && st.global_rank
        ? ` (#${L.fmtNum(st.global_rank)}${st.country_rank ? ` ${user.country_code} #${L.fmtNum(st.country_rank)}` : ''})`
        : '';
    const totalPp = st && st.pp ? `: ${L.fmtNum(Math.round(st.pp))}pp` : '';
    const rd = rankedDate || bs.ranked_date;
    const status = [STATUS_LABEL[bs.status || bm.status] || '', rd ? String(rd).slice(0, 10) : ''].filter(Boolean).join(' ');
    const footBits = [tries > 1 ? t('try_n', { n: tries }) : '', bs.creator ? t('mapped_by', { n: bs.creator }) : '', status].filter(Boolean);
    const covers = bs.covers || {};
    const mTag = L.modeTag(mode);

    return {
        author: user ? {
            // The flag is the author icon, as on Bathbot: a flag emoji in the
            // name shows as the letters "TW" on Windows.
            name: `${user.username}${totalPp}${rankBit}`,
            url: `https://osu.ppy.sh/users/${user.id}/${mode}`,
            icon_url: flagImageUrl(user.country_code) || user.avatar_url || undefined,
        } : undefined,
        title: `${heading ? heading + ' · ' : ''}${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]${stars != null ? ` [${Number(stars).toFixed(2)}★]` : ''}`.slice(0, 250),
        url: bm.url || (bm.id ? `https://osu.ppy.sh/b/${bm.id}` : undefined),
        description: lines.filter(Boolean).join('\n'),
        thumbnail: { url: covers['list@2x'] || covers.list || covers.card || undefined },
        color: passed ? L.srColor(stars) : 0x9aa0a6,
        // The mode icon leads the footer, as on Bathbot.
        footer: { text: footBits.join(' · ') || t('site_footer'), icon_url: L.emojiImageUrl(mTag) || L.SITE_ICON },
        timestamp: score.ended_at || score.created_at || undefined,
    };
}

// Deferred: fetching the map file and running rosu-pp can pass Discord's
// 3 s window, so answer "thinking…" now and edit the message when done.
function deferInto(interaction, work) {
    const hook = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
    const patch = (body) => fetch(hook, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
    }).catch(() => null);
    const job = (async () => {
        try {
            const out = await work();
            if (typeof out === 'string') await patch({ content: out });
            else await patch({ content: '', embeds: [out.embed], components: out.components || [] });
        } catch (err) {
            console.error('deferred command failed:', err && (err.stack || err));
            await patch({ content: t('export_fail') });
        }
    })();
    const ctx = getCtx();
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    return L.json({ type: L.R.DEFERRED_MESSAGE });
}

// The score's beatmapset carries no ranked date; the beatmap lookup does.
async function fetchRankedDate(token, score) {
    const bs = score.beatmapset || {};
    if (bs.ranked_date) return bs.ranked_date;
    if (!score.beatmap || !score.beatmap.id || !['ranked', 'approved', 'loved', 'qualified'].includes(bs.status)) return null;
    try {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${score.beatmap.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return null;
        const b = await r.json();
        return (b.beatmapset && b.beatmapset.ranked_date) || null;
    } catch { return null; }
}

async function cmdRecent(options, interaction, origin, forcedMode) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const apiMode = forcedMode || L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idx = Math.max(1, Math.min(50, Number(L.optVal(options, 'index')) || 1));

    return deferInto(interaction, async () => {
        const token = await getOsuToken();
        const u = await L.resolveOsuUser(token, who, apiMode);
        if (!u) return t('user_not_found', { name: who });

        const scores = await fetchScores(token, u.id, 'recent', apiMode, 50, true, '20240529');
        if (!scores.length) return t('recent_none', { name: u.username, mode: L.MODE_LABEL[apiMode] });
        const at = Math.min(idx, scores.length) - 1;
        const score = scores[at];
        // Tries: this play plus the older ones right before it on the same map.
        let tries = 1;
        const mapId = score.beatmap && score.beatmap.id;
        for (let i = at + 1; i < scores.length && scores[i].beatmap && scores[i].beatmap.id === mapId; i++) tries++;

        const { scoreExtras } = require('./_score-calc');
        const [ex, rankedDate] = await Promise.all([
            scoreExtras(score, score.mode || apiMode, L.modsList(score.mods)),
            fetchRankedDate(token, score),
        ]);
        const embed = detailedScoreEmbed(score, u, apiMode, ex, { tries, rankedDate });
        return { embed, components: scoreActionRow(score, apiMode, origin) };
    });
}

/* /help: every command, grouped, in the caller's language. Descriptions come
   from the same definitions Discord shows in its picker. Commands are
   clickable mentions (</name:id>) once their ids are known. */
const HELP_GROUPS = [
    ['help_sec_scores', ['link', 'recent', '#short', 'top', 'pp', 'leaderboard', 'versus']],
    ['help_sec_maps', ['map', 'mappool', 'tourneypool']],
    ['help_sec_collections', ['collection', 'gallery', 'collect-channel', 'follow', 'unfollow', 'following', 'skin']],
    ['help_sec_settings', ['unlink', 'language', 'help']],
];
const DISCORD_LOCALE = { zh: 'zh-TW', zhs: 'zh-CN', es: 'es-ES' };
let commandIds = null; // name -> id, cached per isolate

async function loadCommandIds(appId) {
    if (commandIds) return commandIds;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken || !appId) return {};
    try {
        const r = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, { headers: { Authorization: `Bot ${botToken}` } });
        if (!r.ok) return {};
        const list = await r.json();
        commandIds = Object.fromEntries(list.map((c) => [c.name, c.id]));
        return commandIds;
    } catch { return {}; }
}

async function cmdHelp(interaction) {
    const { commands } = require('./_discord-commands');
    const byName = Object.fromEntries(commands.map((c) => [c.name, c]));
    const ids = await loadCommandIds(interaction.application_id);
    const lang = getLocale();
    const dl = DISCORD_LOCALE[lang] || lang;
    const mention = (name) => (ids[name] ? `</${name}:${ids[name]}>` : `\`/${name}\``);
    const desc = (c) => (lang !== 'en' && c.description_localizations && c.description_localizations[dl]) || c.description;

    const fields = HELP_GROUPS.map(([sec, names]) => ({
        name: t(sec),
        value: names.map((n) => {
            if (n === '#short') return `${['rs', 'rt', 'rc', 'rm'].map(mention).join(' ')} — ${t('help_recent_short')}`;
            const c = byName[n];
            return c ? `${mention(n)} — ${desc(c)}` : '';
        }).filter(Boolean).join('\n').slice(0, 1024),
    }));
    return L.message({
        title: t('help_title'),
        description: t('help_intro'),
        color: PINK,
        fields,
        footer: L.siteFooter(),
    });
}

async function cmdTop(options, interaction, origin) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idxOpt = L.optVal(options, 'index');

    // one score in detail: the same embed as /rs (deferred: it reads the map file)
    if (idxOpt != null) {
        const idx = Math.max(1, Math.min(100, Number(idxOpt) || 1));
        return deferInto(interaction, async () => {
            const token = await getOsuToken();
            const u = await L.resolveOsuUser(token, who, apiMode);
            if (!u) return t('user_not_found', { name: who });
            const scores = await fetchScores(token, u.id, 'best', apiMode, idx, false, '20240529');
            if (scores.length < idx) return t('top_no_nth', { name: u.username, idx, mode: L.MODE_LABEL[apiMode] });
            const score = scores[idx - 1];
            const { scoreExtras } = require('./_score-calc');
            const [ex, rankedDate] = await Promise.all([
                scoreExtras(score, apiMode, L.modsList(score.mods)),
                fetchRankedDate(token, score),
            ]);
            const embed = detailedScoreEmbed(score, u, apiMode, ex, { heading: `#${idx}`, rankedDate });
            return { embed, components: scoreActionRow(score, apiMode, origin) };
        });
    }

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(t('user_not_found', { name: who }));

    const scores = await fetchScores(token, u.id, 'best', apiMode, TOP_MAX, false);
    if (!scores.length) return L.ephemeral(t('top_none', { name: u.username, mode: L.MODE_LABEL[apiMode] }));
    const v = topPage(u, apiMode, scores, 0);
    return L.message(v.embeds, v.components);
}

/* --- /collect-channel: build a collection from links in this channel --- */

function extractBeatmapRefs(text) {
    const beatmapIds = new Set();
    const setIds = new Set();
    const re = /osu\.ppy\.sh\/(beatmapsets\/(\d+)(?:#\w+\/(\d+))?|beatmaps\/(\d+)|b\/(\d+)|s\/(\d+))/gi;
    let m;
    while ((m = re.exec(text || ''))) {
        if (m[3]) beatmapIds.add(m[3]);            // beatmapsets/123#osu/456
        else if (m[2]) setIds.add(m[2]);           // beatmapsets/123 (no diff)
        else if (m[4] || m[5]) beatmapIds.add(m[4] || m[5]); // beatmaps/456 or b/456
        else if (m[6]) setIds.add(m[6]);           // s/123
    }
    return { beatmapIds: [...beatmapIds], setIds: [...setIds] };
}

async function cmdCollectChannel(options, interaction, origin) {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const channelId = interaction.channel_id || (interaction.channel && interaction.channel.id);
    const count = Math.max(20, Math.min(300, Number(L.optVal(options, 'count')) || 100));
    if (!botToken || !channelId) return L.ephemeral(t('export_fail'));

    // Read channel history (Discord caps at 100/call).
    const messages = [];
    let before = null;
    for (let i = 0; i < 3 && messages.length < count; i++) {
        const q = new URLSearchParams({ limit: String(Math.min(100, count - messages.length)) });
        if (before) q.set('before', before);
        const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?${q}`, {
            headers: { Authorization: `Bot ${botToken}` },
        });
        if (r.status === 403) return L.ephemeral(t('collect_need_perm'));
        if (!r.ok) return L.ephemeral(t('export_fail'));
        const batch = await r.json();
        if (!batch.length) break;
        messages.push(...batch);
        before = batch[batch.length - 1].id;
    }

    const all = { beatmapIds: new Set(), setIds: new Set() };
    for (const msg of messages) {
        const refs = extractBeatmapRefs(msg.content);
        refs.beatmapIds.forEach(x => all.beatmapIds.add(x));
        refs.setIds.forEach(x => all.setIds.add(x));
    }
    if (!all.beatmapIds.size && !all.setIds.size) return L.ephemeral(t('collect_no_links', { n: messages.length }));

    const token = await getOsuToken();
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const beatmaps = [];
    const seen = new Set();
    const push = (bm, bs) => {
        if (!bm || seen.has(bm.id)) return;
        seen.add(bm.id);
        beatmaps.push({
            mapId: bm.id, mapSetId: bm.beatmapset_id || (bs && bs.id) || 0,
            artist: (bs && bs.artist) || (bm.beatmapset && bm.beatmapset.artist) || '',
            title: (bs && bs.title) || (bm.beatmapset && bm.beatmapset.title) || '',
            diff: bm.version || '', md5: bm.checksum || '', mode: bm.mode_int || 0, stars: bm.difficulty_rating || 0,
        });
    };

    // All lookups in parallel: on Cloudflare each osu! call goes through
    // the Netlify relay, and up to 6 batches + 15 sets one after another
    // could pass Discord's 3 s window. Results are pushed in the original
    // order so the collection matches the channel's.
    const bmIds = [...all.beatmapIds];
    const batches = [];
    for (let i = 0; i < bmIds.length; i += 50) batches.push(bmIds.slice(i, i + 50));
    const [batchResults, setResults] = await Promise.all([
        Promise.all(batches.map(async ids => {
            const q = new URLSearchParams();
            ids.forEach(id => q.append('ids[]', id));
            const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps?${q}`, auth);
            return r.ok ? ((await r.json()).beatmaps || []) : [];
        })),
        Promise.all([...all.setIds].slice(0, 15).map(async sid => {
            const r = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${sid}`, auth);
            return r.ok ? r.json() : null;
        })),
    ]);
    for (const list of batchResults) for (const bm of list) push(bm, bm.beatmapset);
    for (const set of setResults) {
        if (!set) continue;
        const hardest = (set.beatmaps || []).slice().sort((a, b) => b.difficulty_rating - a.difficulty_rating)[0];
        push(hardest, set);
    }
    if (!beatmaps.length) return L.ephemeral(t('collect_no_links', { n: messages.length }));

    const chName = (interaction.channel && interaction.channel.name) || 'channel';
    const cols = [{ name: `#${chName}`, beatmaps }];
    return osdbResponse(cols, `channel-${chName}`);
}

/* --- /follow /unfollow /following ------------------------------------- */

async function getFollowing(discordId) {
    if (!discordId) return [];
    try {
        const v = await getDiscordBotStore().get(`following:${discordId}`, { type: 'json' });
        return Array.isArray(v) ? v : [];
    } catch { return []; }
}

async function resolvePublisher(query) {
    const index = (await getCollectionsStore().get('index', { type: 'json' })) || [];
    const q = String(query || '').toLowerCase().trim();
    if (/^\d+$/.test(q)) return index.find(e => String(e.id) === q) || null;
    return index.find(e => (e.username || '').toLowerCase() === q)
        || index.find(e => (e.username || '').toLowerCase().includes(q)) || null;
}

async function cmdFollow(options, interaction) {
    const uid = L.invokerId(interaction);
    const entry = await resolvePublisher(L.optVal(options, 'query'));
    if (!entry) return L.ephemeral(t('collection_not_found', { q: String(L.optVal(options, 'query') || '') }));

    const store = getDiscordBotStore();
    const mine = await getFollowing(uid);
    if (mine.includes(String(entry.id))) return L.ephemeral(t('follow_already', { name: entry.username }));
    mine.push(String(entry.id));
    await store.setJSON(`following:${uid}`, mine);

    const watchers = await store.get(`followers:${entry.id}`, { type: 'json' }).catch(() => null) || [];
    if (!watchers.includes(String(uid))) { watchers.push(String(uid)); await store.setJSON(`followers:${entry.id}`, watchers); }

    return L.ephemeral(t('follow_done', { name: entry.username }));
}

async function cmdUnfollow(options, interaction) {
    const uid = L.invokerId(interaction);
    const entry = await resolvePublisher(L.optVal(options, 'query'));
    const store = getDiscordBotStore();
    const mine = await getFollowing(uid);
    const id = entry ? String(entry.id) : null;
    const name = entry ? entry.username : String(L.optVal(options, 'query') || '');
    if (!id || !mine.includes(id)) return L.ephemeral(t('unfollow_not', { name }));

    await store.setJSON(`following:${uid}`, mine.filter(x => x !== id));
    const watchers = (await store.get(`followers:${id}`, { type: 'json' }).catch(() => null)) || [];
    await store.setJSON(`followers:${id}`, watchers.filter(x => x !== String(uid)));
    return L.ephemeral(t('unfollow_done', { name }));
}

async function cmdFollowing(interaction) {
    const mine = await getFollowing(L.invokerId(interaction));
    if (!mine.length) return L.ephemeral(t('following_empty'));
    const index = (await getCollectionsStore().get('index', { type: 'json' })) || [];
    const names = mine.map(id => {
        const e = index.find(x => String(x.id) === id);
        return e ? e.username : `#${id}`;
    });
    return L.ephemeral(t('following_list', { names: names.join(', ') }));
}

/* --- /map ----------------------------------------------------------------- */

function parseBeatmapId(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/);      // beatmapsets/123#osu/456
    if (m) return { beatmapId: m[1] };
    m = s.match(/\/beatmaps\/(\d+)/) || s.match(/\/b\/(\d+)/);   // /beatmaps/456 or /b/456
    if (m) return { beatmapId: m[1] };
    m = s.match(/\/beatmapsets\/(\d+)/) || s.match(/\/s\/(\d+)/); // /beatmapsets/123 (set only)
    if (m) return { setId: m[1] };
    if (/^\d+$/.test(s)) return { beatmapId: s };
    return {};
}

/* --- /leaderboard <map> [mode]: the map's global top 10 with grade and
   mod emojis, a menu to open any of them as a score card, and ➕. --- */
async function cmdLeaderboard(options) {
    const { beatmapId, setId } = parseBeatmapId(L.optVal(options, 'query'));
    const token = await getOsuToken();
    let bm;
    if (beatmapId) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 404) return L.ephemeral(t('map_not_found'));
        if (!r.ok) return L.ephemeral(t('api_fail'));
        bm = await r.json();
    } else if (setId) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return L.ephemeral(t('map_set_not_found'));
        const set = await r.json();
        bm = (set.beatmaps || []).slice().sort((a, b) => b.difficulty_rating - a.difficulty_rating)[0];
        if (!bm) return L.ephemeral(t('map_set_no_diffs'));
        bm.beatmapset = set;
    } else {
        return L.ephemeral(t('map_need_link'));
    }
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || L.API_MODE[bm.mode] || 'osu';
    const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${bm.id}/scores?mode=${apiMode}&limit=10`, {
        headers: { Authorization: `Bearer ${token}`, 'x-api-version': '20220705' },
    });
    if (!r.ok) return L.ephemeral(t('api_fail'));
    const scores = ((await r.json()).scores || []).slice(0, 10);
    const bs = bm.beatmapset || {};
    const covers = bs.covers || {};
    const head = {
        title: `${L.modeTag(apiMode) ? L.modeTag(apiMode) + ' ' : ''}${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]`.slice(0, 250),
        url: `https://osu.ppy.sh/b/${bm.id}`,
        color: L.srColor(bm.difficulty_rating),
        thumbnail: { url: covers['list@2x'] || covers.list || undefined },
    };
    if (!scores.length) return L.message({ ...head, description: t('lb_none'), footer: L.siteFooter() });
    const tick = String.fromCharCode(96);
    const lines = scores.map((sc, i) => {
        const name = (sc.user && sc.user.username) || `#${sc.user_id}`;
        const flag = sc.user && sc.user.country_code ? L.flagEmoji(sc.user.country_code) + ' ' : '';
        const acc = sc.accuracy != null ? `${(sc.accuracy * 100).toFixed(2)}%` : '—';
        const value = sc.pp != null ? `**${Math.round(sc.pp)}pp**` : `**${L.fmtNum(sc.legacy_total_score || sc.total_score)}**`;
        const mods = L.modsTag(sc.mods);
        return `${tick}#${String(i + 1).padStart(2, ' ')}${tick} ${L.gradeTag(sc.rank)} ${flag}**${name}**${mods ? ' ' + mods : ''} · ${acc} · ${L.fmtNum(sc.max_combo)}x · ${value}`;
    });
    const components = [{ type: 1, components: [{
        type: 3,
        custom_id: 'cardsel',
        placeholder: t('card_pick'),
        options: scores.filter((sc) => sc.id).map((sc, i) => ({
            label: `#${i + 1} ${(sc.user && sc.user.username) || sc.user_id}${sc.pp != null ? ` — ${Math.round(sc.pp)}pp` : ''}`.slice(0, 100),
            value: `|${sc.id}`,
        })),
    }] }];
    const lbReplays = scores.filter((sc) => sc.id && hasReplay(sc)).slice(0, 25);
    if (lbReplays.length) {
        components.push({ type: 1, components: [{
            type: 3,
            custom_id: 'rendsel',
            placeholder: t('render_pick'),
            options: lbReplays.map((sc) => ({
                label: `#${scores.indexOf(sc) + 1} ${(sc.user && sc.user.username) || sc.user_id}${sc.pp != null ? ` — ${Math.round(sc.pp)}pp` : ''}`.slice(0, 100),
                value: `|${sc.id}`,
            })),
        }] });
    }
    if (bs.id) components.push({ type: 1, components: [{ type: 2, style: 2, label: t('btn_fav'), custom_id: `fav|${bs.id}` }] });
    return L.message({
        ...head,
        description: lines.join('\n'),
        footer: L.siteFooter(`${t('lb_title')} · ${Number(bm.difficulty_rating || 0).toFixed(2)}★`),
    }, components);
}

async function cmdMap(options, origin) {
    const { beatmapId, setId } = parseBeatmapId(L.optVal(options, 'query'));
    const token = await getOsuToken();

    let bm;
    if (beatmapId) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 404) return L.ephemeral(t('map_not_found'));
        if (!r.ok) return L.ephemeral(t('api_fail'));
        bm = await r.json();
    } else if (setId) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return L.ephemeral(t('map_set_not_found'));
        const set = await r.json();
        bm = (set.beatmaps || []).slice().sort((a, b) => b.difficulty_rating - a.difficulty_rating)[0];
        if (bm) bm.beatmapset = set;
        if (!bm) return L.ephemeral(t('map_set_no_diffs'));
    } else {
        return L.ephemeral(t('map_need_link'));
    }

    const bs = bm.beatmapset || {};
    let ppLine = null;
    try {
        const r = await fetch(`${origin}/.netlify/functions/osu-pp?id=${bm.id}&acc=95,98,99,100`);
        if (r.ok) {
            const d = await r.json();
            if (d && d.pp) {
                ppLine = ['95', '98', '99', '100'].map(a => `${a}% → **${Math.round(d.pp[a])}**`).join(' · ');
            }
        }
    } catch { /* pp is a nice-to-have */ }

    // Mod-combo PP comparison at SS. Mania's score mods don't change pp
    // except DT's rate change, so only NM/DT are worth showing there —
    // HD/HR/HDDT/HDHR would just repeat the NM number.
    const modCombos = bm.mode === 'mania' ? ['', 'DT'] : ['', 'HD', 'HR', 'DT', 'HDDT', 'HDHR'];
    let modPpLine = null;
    try {
        const modResults = await Promise.all(modCombos.map(async (mods) => {
            const r = await fetch(`${origin}/.netlify/functions/osu-pp?id=${bm.id}&acc=100${mods ? `&mods=${mods}` : ''}`);
            if (!r.ok) return null;
            const d = await r.json();
            const pp = d && d.pp && d.pp['100'];
            return Number.isFinite(pp) ? Math.round(pp) : null;
        }));
        const parts = modCombos
            .map((mods, i) => (modResults[i] != null ? `${mods || 'NM'} **${modResults[i]}**` : null))
            .filter(Boolean);
        if (parts.length > 1) modPpLine = parts.join(' · ');
    } catch { /* nice-to-have */ }

    const mTag = L.modeTag(L.API_MODE[bm.mode]);
    const mpMode = { osu: 0, taiko: 1, fruits: 2, mania: 3 }[bm.mode] ?? 0;
    return L.message({
        title: `${mTag ? mTag + ' ' : ''}${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]`.slice(0, 250),
        url: bm.url || `https://osu.ppy.sh/b/${bm.id}`,
        description: bs.creator ? t('mapper', { n: bs.creator }) : undefined,
        color: L.srColor(bm.difficulty_rating),
        image: bs.covers ? { url: bs.covers.cover || bs.covers['cover@2x'] } : undefined,
        fields: [
            { name: t('f_difficulty'), value: `${Number(bm.difficulty_rating).toFixed(2)}★`, inline: true },
            { name: 'BPM', value: bm.bpm != null ? String(Math.round(bm.bpm)) : '—', inline: true },
            { name: t('f_length'), value: L.fmtLen(bm.total_length), inline: true },
            { name: 'AR / OD / CS / HP', value: `${bm.ar ?? '—'} / ${bm.accuracy ?? '—'} / ${bm.cs ?? '—'} / ${bm.drain ?? '—'}`, inline: true },
            { name: t('f_max_combo'), value: bm.max_combo != null ? `${L.fmtNum(bm.max_combo)}x` : '—', inline: true },
            { name: t('f_status'), value: bm.status || '—', inline: true },
            { name: t('f_mp'), value: `\`!mp map ${bm.id} ${mpMode}\``, inline: false },
            ...(ppLine ? [{ name: t('f_pp_fc'), value: ppLine, inline: false }] : []),
            ...(modPpLine ? [{ name: t('f_pp_mods'), value: modPpLine, inline: false }] : []),
        ],
        footer: L.siteFooter(bm.mode ? L.MODE_LABEL[L.API_MODE[bm.mode]] || bm.mode : undefined),
    });
}

/* --- /mappool ----------------------------------------------------------- */

async function autocompleteMappool(options, origin) {
    const opts = options || [];
    const focused = opts.find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();

    // Typing in round: — suggest the picked edition's actual round names.
    if (focused.name === 'round') {
        const folder = String((opts.find(o => o.name === 'edition') || {}).value || '').trim();
        if (!folder) return L.autocomplete([]);
        let rounds = [];
        try {
            const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(folder)}`);
            if (r.ok) rounds = (await r.json()).rounds || [];
        } catch { /* none */ }
        let names = rounds.map(rd => rd.name).filter(Boolean);
        if (q) names = names.filter(n => n.toLowerCase().includes(q));
        return L.autocomplete(names.slice(0, 25).map(n => ({ name: n.slice(0, 100), value: n.slice(0, 100) })));
    }

    let editions = [];
    try {
        const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list`);
        if (r.ok) editions = (await r.json()).editions || [];
    } catch { /* empty */ }
    let pool = editions;
    if (q) pool = editions.filter(e => (e.label || '').toLowerCase().includes(q) || (e.folder || '').toLowerCase().includes(q));
    pool = pool.sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, 25);
    return L.autocomplete(pool.map(e => ({
        name: `${e.label} · ${t('mappool_ac_meta', { r: e.roundCount, m: e.mapCount })}`.slice(0, 100),
        value: e.folder,
    })));
}

const MAPPOOL_PAGE = 9; // maps per message (Discord caps at 10 embeds; one slot spare)

// One embed per map (cover + mods + stats), a page at a time, with prev/next
// buttons for rounds longer than MAPPOOL_PAGE. `kind` picks the button
// namespace so the WC ('mp'/'mpx') and community ('cmp'/'cmpx') pools route
// their pagination / export clicks to their own handlers.
function mappoolRoundView(pool, roundIdx, page, origin, kind = 'wc') {
    const round = (pool.rounds || [])[roundIdx];
    if (!round) return null;
    const pfxPage = kind === 'community' ? 'cmp' : 'mp';
    const pfxExport = kind === 'community' ? 'cmpx' : 'mpx';

    const maps = [];
    for (const b of round.brackets || []) {
        (b.maps || []).forEach((m, si) => maps.push({ ...m, bracket: b.label || '', slot: si + 1 }));
    }
    const pages = Math.max(1, Math.ceil(maps.length / MAPPOOL_PAGE));
    const p = Math.max(0, Math.min(pages - 1, page));
    const slice = maps.slice(p * MAPPOOL_PAGE, p * MAPPOOL_PAGE + MAPPOOL_PAGE);

    const embeds = slice.map((m, i) => {
        const mt = L.modeTag(L.API_MODE[m.mode]);
        const name = m.resolved ? `${m.artist} - ${m.title} [${m.version}]` : `#${m.beatmapId}`;
        const mod = L.bracketMod(m.bracket);
        const modIconUrl = L.emojiImageUrl(L.MOD_EMOJI[mod], 128);
        const slotLabel = mod ? `**${mod}${m.slot || ''}**` : '';
        const badges = [slotLabel, mt].filter(Boolean).join('  ');
        const meta = [
            m.stars != null ? `${Number(m.stars).toFixed(2)}★` : null,
            m.bpm != null ? `${Math.round(m.bpm)} BPM` : null,
            m.length != null ? L.fmtLen(m.length) : null,
            m.creator ? t('mapper', { n: m.creator }) : null,
        ].filter(Boolean).join(' · ');
        return {
            author: i === 0 ? { name: `${pool.label} — ${round.name}` } : undefined,
            title: name.slice(0, 250),
            url: `https://osu.ppy.sh/b/${m.beatmapId}`,
            description: [badges, meta].filter(Boolean).join('\n') || undefined,
            color: m.stars != null ? L.srColor(m.stars) : PINK,
            thumbnail: modIconUrl ? { url: modIconUrl } : undefined,
            image: m.setId ? { url: `https://assets.ppy.sh/beatmaps/${m.setId}/covers/cover.jpg` } : undefined,
            footer: i === slice.length - 1
                ? L.siteFooter(t('mappool_page_footer', { round: round.name, p: p + 1, pages, n: maps.length }))
                : undefined,
        };
    });
    if (!embeds.length) embeds.push({ title: `${pool.label} — ${round.name}`, description: t('mappool_round_empty'), color: PINK });

    const row = [{ type: 2, style: 2, label: t('btn_export_round'), custom_id: `${pfxExport}|${pool.folder}|${roundIdx}` }];
    if (pages > 1) {
        row.unshift({ type: 2, style: 2, label: t('btn_prev'), custom_id: `${pfxPage}|${pool.folder}|${roundIdx}|${p - 1}`, disabled: p === 0 });
        row.push({ type: 2, style: 2, label: t('btn_next'), custom_id: `${pfxPage}|${pool.folder}|${roundIdx}|${p + 1}`, disabled: p >= pages - 1 });
    }
    return { embeds, components: [{ type: 1, components: row }] };
}

// A WC edition (or one round of it) -> [{ name, beatmaps }] for .osdb.
function wcPoolToCollections(pool, onlyRoundIdx) {
    const out = [];
    (pool.rounds || []).forEach((round, ri) => {
        if (onlyRoundIdx != null && ri !== onlyRoundIdx) return;
        const beatmaps = [];
        for (const b of round.brackets || []) {
            for (const m of b.maps || []) {
                beatmaps.push({
                    mapId: m.beatmapId, mapSetId: m.setId || 0,
                    artist: m.artist || '', title: m.title || '', diff: m.version || '',
                    md5: '', mode: MODE_INT[m.mode] || 0, stars: m.stars || 0,
                });
            }
        }
        if (beatmaps.length) out.push({ name: `${pool.label} — ${round.name}`, beatmaps });
    });
    return out;
}

async function cmdMappool(options, origin) {
    const folder = String(L.optVal(options, 'edition') || '').trim();
    const roundQ = String(L.optVal(options, 'round') || '').trim().toLowerCase();
    if (!folder) return L.ephemeral(t('mappool_need_edition'));

    const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(folder)}`);
    if (r.status === 404) return L.ephemeral(t('mappool_not_found'));
    if (!r.ok) return L.ephemeral(t('mappool_fail'));
    const pool = await r.json();
    const rounds = pool.rounds || [];

    if (roundQ) {
        const roundIdx = rounds.findIndex(rd => (rd.name || '').toLowerCase().includes(roundQ));
        if (roundIdx < 0) return L.ephemeral(t('mappool_round_not_found', { label: pool.label, q: roundQ }));
        const view = mappoolRoundView(pool, roundIdx, 0, origin);
        return L.message(view.embeds, view.components);
    }

    return L.message({
        title: t('mappool_rounds_title', { label: pool.label, n: rounds.length }),
        url: `${origin}/`,
        description: rounds.map(rd => {
            let n = 0;
            for (const b of rd.brackets || []) n += (b.maps || []).length;
            return `**${rd.name}** — ${t('n_sets', { n })}`;
        }).join('\n') || t('mappool_no_data'),
        color: PINK,
        footer: L.siteFooter(t('mappool_round_hint')),
    }, [{
        type: 1,
        components: [{ type: 2, style: 2, label: t('btn_export_osdb'), custom_id: `mpx|${pool.folder}|*` }],
    }]);
}

/* --- /tourneypool (community-authored tournament pools) --------------- */

// Give a community pool a `.label` / `.folder` so mappoolRoundView() and
// wcPoolToCollections() — written for the WC shape — render it unchanged.
// Per-map `.mode` is left in osu! API form ('osu'/'fruits'/…) as the list
// endpoint returns it: both L.API_MODE[…] and MODE_INT[…] accept that form.
function communityPoolNormalize(raw) {
    return {
        label: (raw.tournament && raw.tournament.name) || raw.id,
        folder: raw.id,
        mode: raw.mode,
        url: raw.tournament && raw.tournament.url,
        source: raw.tournament && raw.tournament.source,
        rounds: raw.rounds || [],
    };
}
const SITE2API_MODE = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };
function tpoolModeShort(mode) {
    if (mode === 'all') return t('tpool_mode_all');
    return L.MODE_LABEL[SITE2API_MODE[mode]] || mode;
}

async function autocompleteTourneypool(options, origin) {
    const opts = options || [];
    const focused = opts.find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();

    // Typing in round: — suggest the picked tournament's actual round names.
    if (focused.name === 'round') {
        const tid = String((opts.find(o => o.name === 'tournament') || {}).value || '').trim();
        if (!tid) return L.autocomplete([]);
        let rounds = [];
        try {
            const r = await fetch(`${origin}/.netlify/functions/community-mappools-list?id=${encodeURIComponent(tid)}`);
            if (r.ok) rounds = (await r.json()).rounds || [];
        } catch { /* none */ }
        let names = rounds.map(rd => rd.name).filter(Boolean);
        if (q) names = names.filter(n => n.toLowerCase().includes(q));
        return L.autocomplete(names.slice(0, 25).map(n => ({ name: n.slice(0, 100), value: n.slice(0, 100) })));
    }

    // Typing in tournament: — the pool list, narrowed by mode:/source: if set.
    let pools = [];
    try {
        const r = await fetch(`${origin}/.netlify/functions/community-mappools-list`);
        if (r.ok) pools = (await r.json()).pools || [];
    } catch { /* empty */ }
    const modeF = String((opts.find(o => o.name === 'mode') || {}).value || '');
    const sourceF = String((opts.find(o => o.name === 'source') || {}).value || '');
    if (modeF) pools = pools.filter(p => p.mode === modeF);
    if (sourceF) pools = pools.filter(p => (p.source || 'custom') === sourceF);
    if (q) pools = pools.filter(p => (p.tournamentName || '').toLowerCase().includes(q));
    pools = pools
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 25);
    return L.autocomplete(pools.map(p => ({
        name: `${p.tournamentName} · ${tpoolModeShort(p.mode)} · ${t('mappool_ac_meta', { r: p.roundCount, m: p.mapCount })}`.slice(0, 100),
        value: String(p.id).slice(0, 100),
    })));
}

const TPOOL_SRC_LABEL = { wybin: 'wyBin', forum: 'Forum', custom: 'Custom' };

// Render one community pool (or one of its rounds) -> { embeds, components }
// or { error }. Shared by the /tourneypool command and the tp|<id> button.
async function tourneyPoolRender(id, roundQ, origin) {
    const r = await fetch(`${origin}/.netlify/functions/community-mappools-list?id=${encodeURIComponent(id)}`);
    if (r.status === 404) return { error: t('tpool_not_found') };
    if (!r.ok) return { error: t('tpool_fail') };
    const pool = communityPoolNormalize(await r.json());
    const rounds = pool.rounds || [];
    if (!rounds.length) return { error: t('tpool_empty', { name: pool.label }) };

    if (roundQ) {
        const roundIdx = rounds.findIndex(rd => (rd.name || '').toLowerCase().includes(roundQ));
        if (roundIdx < 0) return { error: t('mappool_round_not_found', { label: pool.label, q: roundQ }) };
        const view = mappoolRoundView(pool, roundIdx, 0, origin, 'community');
        return { embeds: view.embeds, components: view.components };
    }

    // Community pools are usually one round ("Grand finals" holding every
    // bracket) — show its maps straight away rather than a one-line index.
    if (rounds.length === 1) {
        const view = mappoolRoundView(pool, 0, 0, origin, 'community');
        return { embeds: view.embeds, components: view.components };
    }

    // Multi-round: the rounds index + a button per round (≤10) that opens it
    // in place, plus a whole-pool .osdb export — no need to type round:<name>.
    const roundBtns = rounds.slice(0, 10).map((rd, ri) => ({
        type: 2, style: 2, label: String(rd.name || `#${ri + 1}`).slice(0, 80),
        custom_id: `cmp|${pool.folder}|${ri}|0`,
    }));
    const rows = [];
    for (let i = 0; i < roundBtns.length; i += 5) rows.push({ type: 1, components: roundBtns.slice(i, i + 5) });
    rows.push({ type: 1, components: [{ type: 2, style: 2, label: t('btn_export_osdb'), custom_id: `cmpx|${pool.folder}|*` }] });

    return {
        embeds: [{
            title: t('tpool_rounds_title', { label: pool.label, mode: tpoolModeShort(pool.mode), n: rounds.length }),
            url: pool.url || `${origin}/?cmpool=${encodeURIComponent(pool.folder)}`,
            description: rounds.map(rd => {
                let n = 0;
                for (const b of rd.brackets || []) n += (b.maps || []).length;
                return `**${rd.name}** — ${t('n_sets', { n })}`;
            }).join('\n') || t('mappool_no_data'),
            color: PINK,
            footer: L.siteFooter(t('tpool_pick_round')),
        }],
        components: rows,
    };
}

// No tournament given -> browse the pool list, filtered by mode / source.
async function tourneyPoolList(modeF, sourceF, origin) {
    let pools = [];
    try {
        const r = await fetch(`${origin}/.netlify/functions/community-mappools-list`);
        if (r.ok) pools = (await r.json()).pools || [];
    } catch { /* empty */ }
    if (modeF) pools = pools.filter(p => p.mode === modeF);
    if (sourceF) pools = pools.filter(p => (p.source || 'custom') === sourceF);
    pools.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!pools.length) return L.ephemeral(t('tpool_list_empty'));

    const top = pools.slice(0, 10);
    const desc = top.map(p => `**${p.tournamentName}** · ${tpoolModeShort(p.mode)} · ${t('mappool_ac_meta', { r: p.roundCount, m: p.mapCount })}`).join('\n');
    const btns = top.map(p => ({ type: 2, style: 2, label: String(p.tournamentName).slice(0, 78), custom_id: `tp|${p.id}` }));
    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push({ type: 1, components: btns.slice(i, i + 5) });

    const filt = [modeF && tpoolModeShort(modeF), sourceF && (TPOOL_SRC_LABEL[sourceF] || sourceF)].filter(Boolean).join(' · ');
    const more = pools.length > top.length ? ' · ' + t('tpool_list_more', { n: pools.length - top.length }) : '';
    return L.message({
        title: filt ? t('tpool_list_title_f', { filt, n: pools.length }) : t('tpool_list_title', { n: pools.length }),
        description: desc.slice(0, 4000),
        color: PINK,
        footer: L.siteFooter(t('tpool_list_hint') + more),
    }, rows);
}

async function cmdTourneypool(options, origin) {
    const id = String(L.optVal(options, 'tournament') || '').trim();
    const roundQ = String(L.optVal(options, 'round') || '').trim().toLowerCase();
    const modeF = String(L.optVal(options, 'mode') || '').trim();
    const sourceF = String(L.optVal(options, 'source') || '').trim();

    if (!id) return await tourneyPoolList(modeF, sourceF, origin);

    const v = await tourneyPoolRender(id, roundQ, origin);
    if (v.error) return L.ephemeral(v.error);
    return L.message(v.embeds, v.components);
}

/* --- /skin ------------------------------------------------------------ */

async function cmdSkin(options, origin) {
    const q = String(L.optVal(options, 'query') || '').trim();
    if (!q) return L.ephemeral(t('skin_need_query'));
    const r = await fetch(`${origin}/.netlify/functions/skin-screenshots-list?sort=likes&q=${encodeURIComponent(q)}`);
    if (!r.ok) return L.ephemeral(t('skin_fail'));
    const items = (await r.json()).items || [];
    if (!items.length) return L.ephemeral(t('skin_not_found', { q }));

    const top = items[0];
    const more = items.slice(1, 5).map(s => `• **${s.skinName}** — ${s.author || '?'}（♥${s.likeCount || 0}）`);
    return L.message({
        title: top.skinName,
        url: `${origin}/`,
        description: [
            top.author ? t('skin_author', { n: top.author }) : null,
            top.username ? t('skin_sharer', { n: top.username }) : null,
            more.length ? `\n${t('skin_more')}\n${more.join('\n')}` : null,
        ].filter(Boolean).join('\n'),
        color: PINK,
        image: { url: `${origin}/.netlify/functions/skin-screenshots-image?id=${top.id}` },
        footer: L.siteFooter(t('skin_footer')),
    });
}

/* --- /collection & /gallery ------------------------------------------------ */

// The publisher-facing bits shared by /collection, /gallery and the
// publish announcement (collections-publish.js reimplements its own).
function collectionDescBits(entry) {
    const bits = [t('n_sets', { n: entry.totalSets || 0 })];
    if (entry.maxRating) bits.push(t('sr_max', { x: Number(entry.maxRating).toFixed(2) }));
    if (entry.avgRating) bits.push(t('sr_avg', { x: Number(entry.avgRating).toFixed(2) }));
    if (entry.likeCount) bits.push(`♥ ${entry.likeCount}`);
    return bits;
}

function collectionButtons(entry, origin) {
    return [{
        type: 1,
        components: [
            { type: 2, style: 1, label: t('btn_random_map'), custom_id: `col:rand:${entry.id}` },
            { type: 2, style: 5, label: t('btn_open_collection'), url: `${origin}/c/${entry.id}` },
            { type: 2, style: 5, label: t('btn_owner_profile'), url: `https://osu.ppy.sh/users/${entry.id}` },
        ],
    }];
}

async function cmdCollection(options, origin) {
    const query = String(L.optVal(options, 'query') || '').trim();
    if (!query) return L.ephemeral(t('collection_need_query'));

    const store = getCollectionsStore();
    const index = (await store.get('index', { type: 'json' })) || [];

    let entry = null;
    if (/^\d+$/.test(query)) entry = index.find(e => String(e.id) === query) || null;
    if (!entry) {
        const q = query.toLowerCase();
        entry = index.find(e => (e.username || '').toLowerCase() === q)
            || index.find(e => (e.username || '').toLowerCase().includes(q))
            || index.find(e => (e.tags || []).some(tag => tag.toLowerCase().includes(q)))
            || null;
    }
    if (!entry) return L.ephemeral(t('collection_not_found', { q: query }));

    const full = await store.get(`full:${entry.id}`, { type: 'json' });
    // og-collection.js's own pick order: first non-empty mode, that mode's
    // first set. Mirrored here so the "cover art from" link points at
    // exactly the set the embed's image is showing.
    const MODE_API = { standard: 'osu', taiko: 'taiko', catch: 'fruits', mania: 'mania' };
    const modeBits = [];
    let coverSet = null;
    if (full && full.collection) {
        for (const m of ['standard', 'taiko', 'catch', 'mania']) {
            const arr = Array.isArray(full.collection[m]) ? full.collection[m] : [];
            if (!arr.length) continue;
            const tag = L.modeTag(MODE_API[m]);
            modeBits.push(`${tag ? tag + ' ' : ''}${arr.length}`);
            if (!coverSet && arr[0] && arr[0].beatmapset_id) coverSet = arr[0];
        }
    }
    const catNames = ((full && full.categories) || []).map(c => c && c.name).filter(Boolean);

    const flag = L.flagEmoji(entry.country);
    const embed = {
        author: {
            name: `${entry.username || ('#' + entry.id)}${flag ? ' ' + flag : ''}`,
            url: `https://osu.ppy.sh/users/${entry.id}`,
            icon_url: `https://a.ppy.sh/${entry.id}`,
        },
        title: t('collection_title', { name: entry.username || ('#' + entry.id) }),
        url: `${origin}/c/${entry.id}`,
        description: collectionDescBits(entry).join(' · '),
        color: entry.maxRating ? L.srColor(entry.maxRating) : PINK,
        image: { url: `${origin}/.netlify/functions/og-collection?id=${entry.id}` },
        fields: [],
        footer: L.siteFooter(),
        timestamp: entry.updatedAt || undefined,
    };
    if (modeBits.length) embed.fields.push({ name: t('f_mode_split'), value: modeBits.join('   ') });
    if (catNames.length) {
        // One per line (not comma-packed) so a long category list doesn't
        // read as one cramped run-on paragraph.
        const shown = catNames.slice(0, 15);
        const extra = catNames.length - shown.length;
        embed.fields.push({
            name: t('f_categories', { n: catNames.length }),
            value: (shown.map(n => `• ${n}`).join('\n') + (extra > 0 ? `\n+${extra}…` : '')).slice(0, 1024),
        });
    }
    if (coverSet) {
        const name = `${coverSet.artist || ''} - ${coverSet.title || ''}`.trim() || `#${coverSet.beatmapset_id}`;
        embed.fields.push({ name: t('f_cover_map'), value: `[${name}](https://osu.ppy.sh/s/${coverSet.beatmapset_id})` });
    }

    return L.message(embed, collectionButtons(entry, origin));
}

async function autocompleteCollection(options) {
    const focused = (options || []).find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();
    const index = (await getCollectionsStore().get('index', { type: 'json' })) || [];
    let pool = index;
    if (q) {
        pool = index.filter(e =>
            (e.username || '').toLowerCase().includes(q) ||
            String(e.id).includes(q) ||
            (e.tags || []).some(tag => tag.toLowerCase().includes(q)));
    }
    pool = pool.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 25);
    return L.autocomplete(pool.map(e => ({
        name: `${e.username || ('#' + e.id)} · ${t('n_sets', { n: e.totalSets || 0 })}`.slice(0, 100),
        value: String(e.id),
    })));
}

async function cmdGallery(options, origin) {
    const page = Math.max(0, Math.min(50, (Number(L.optVal(options, 'page')) || 1) - 1));
    const res = await fetch(`${origin}/.netlify/functions/collections-list?page=${page}&sort=recent`);
    if (!res.ok) return L.ephemeral(t('gallery_fail'));
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return L.ephemeral(t('gallery_empty'));

    const lines = items.slice(0, 12).map((e, i) => {
        const bits = [t('n_sets', { n: e.totalSets || 0 })];
        if (e.maxRating) bits.push(`${Number(e.maxRating).toFixed(1)}★`);
        if (e.likeCount) bits.push(`♥${e.likeCount}`);
        const n = String(page * 20 + i + 1).padStart(2, ' ');
        return `\`${n}\` **${e.username || ('#' + e.id)}** — ${bits.join(' · ')} · [${t('gallery_open')}](${origin}/c/${e.id})`;
    });
    return L.message({
        title: t('gallery_title'),
        url: `${origin}/`,
        description: lines.join('\n'),
        color: PINK,
        thumbnail: { url: `${origin}/.netlify/functions/og-collection?id=${items[0].id}` },
        footer: L.siteFooter(t('gallery_footer', { p: page + 1, total: data.total || items.length })),
    });
}

/* --- .osdb export response -------------------------------------------- */

function osdbResponse(collections, baseName) {
    const nonEmpty = (collections || []).filter(c => (c.beatmaps || []).length);
    if (!nonEmpty.length) return L.ephemeral(t('export_empty'));
    const filename = `${baseName.replace(/[^\w.\- ]+/g, '').trim().slice(0, 60) || 'collection'}.osdb`;
    const bytes = buildOsdb(nonEmpty, 'osu! Collection bot');
    const total = nonEmpty.reduce((s, c) => s + c.beatmaps.length, 0);
    // A cover from the first map so the confirmation isn't text-only.
    const coverSet = (nonEmpty[0].beatmaps.find(b => b.mapSetId) || {}).mapSetId;
    return messageWithFile({
        color: PINK,
        description: t('export_done', { name: filename }),
        thumbnail: coverSet ? { url: `https://assets.ppy.sh/beatmaps/${coverSet}/covers/list@2x.jpg` } : undefined,
        footer: L.siteFooter(`${total} · ${nonEmpty.length}`),
    }, { filename, body: bytes, contentType: 'application/octet-stream' });
}

/* --- message component (buttons) --------------------------------------- */

async function handleComponent(interaction, origin) {
    const id = (interaction.data && interaction.data.custom_id) || '';

    // 🖼 score card: card|<ruleset or ''>|<scoreId>, or a pick from a
    // /top or /leaderboard menu (value <ruleset or ''>|<scoreId>).
    if (id.startsWith('card|') || id === 'cardsel') {
        const raw = id === 'cardsel' ? String(((interaction.data && interaction.data.values) || [])[0] || '') : id.slice(5);
        const [mode, scoreId] = raw.split('|');
        if (!/^\d{1,20}$/.test(scoreId || '')) return L.json({ type: L.R.DEFERRED_UPDATE });
        return startScoreCard(interaction, origin, L.API_MODE[mode] ? L.API_MODE[mode] : '', scoreId);
    }
    // 🎬 Render: rend|<ruleset or ''>|<scoreId>
    if (id.startsWith('rend|') || id === 'rendsel') {
        const raw = id === 'rendsel' ? `rend|${String(((interaction.data && interaction.data.values) || [])[0] || '')}` : id;
        const [, mode, scoreId] = raw.split('|');
        if (!/^\d{1,20}$/.test(scoreId || '')) return L.json({ type: L.R.DEFERRED_UPDATE });
        return startRender(interaction, origin, L.API_MODE[mode] ? L.API_MODE[mode] : '', scoreId);
    }
    // 🆚 vs|<mode>|<scoreId>|<beatmapId>: pick the other score from the map's top 50
    if (id.startsWith('vs|')) {
        const [, mode, scoreId, mapId] = id.split('|');
        if (!/^\d{1,20}$/.test(scoreId || '') || !/^\d{1,10}$/.test(mapId || '')) return L.json({ type: L.R.DEFERRED_UPDATE });
        return versusPick(origin, L.API_MODE[mode] || 'osu', scoreId, mapId);
    }
    // vssel|<mode>|<scoreId> with the picked score as the value
    if (id.startsWith('vssel|')) {
        const [, mode, scoreId] = id.split('|');
        const other = String(((interaction.data && interaction.data.values) || [])[0] || '');
        if (!/^\d{1,20}$/.test(scoreId || '') || !/^\d{1,20}$/.test(other)) return L.json({ type: L.R.DEFERRED_UPDATE });
        return startRender(interaction, origin, L.API_MODE[mode] ? L.API_MODE[mode] : '', scoreId, other);
    }
    // ➕ 加入收藏: fav|<beatmapsetId>
    if (id.startsWith('fav|')) {
        const setId = id.slice(4);
        if (!/^\d{1,10}$/.test(setId)) return L.json({ type: L.R.DEFERRED_UPDATE });
        return addToCollectionInbox(interaction, setId);
    }

    // /top pagination: top|<userId>|<mode>|<page>|<usernameEncoded>. No fresh
    // osu! user lookup here — the username came along in the custom_id and
    // a.ppy.sh/<id> is a stable avatar URL, so this is one osu! API call.
    if (id.startsWith('top|')) {
        const [, userId, mode, pageS, nameEnc] = id.split('|');
        const apiMode = L.API_MODE[mode] || 'osu';
        const username = nameEnc ? decodeURIComponent(nameEnc) : `#${userId}`;
        let scores;
        try {
            const token = await getOsuToken();
            scores = await fetchScores(token, userId, 'best', apiMode, TOP_MAX, false);
        } catch {
            return L.updateMessage({ title: t('top_none', { name: username, mode: L.MODE_LABEL[apiMode] }), color: PINK });
        }
        if (!scores || !scores.length) {
            return L.updateMessage({ title: t('top_none', { name: username, mode: L.MODE_LABEL[apiMode] }), color: PINK });
        }
        const u = { id: userId, username, avatar_url: `https://a.ppy.sh/${userId}` };
        const v = topPage(u, apiMode, scores, Number(pageS) || 0);
        return L.updateMessage(v.embeds, v.components);
    }

    // .osdb export of a WC edition / one round: mpx|<folder>|<roundIdx|'*'>
    if (id.startsWith('mpx|')) {
        const [, folder, roundSel] = id.split('|');
        const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(folder)}`);
        if (!r.ok) return L.updateMessage({ title: t('export_fail'), color: PINK });
        const pool = await r.json();
        const onlyIdx = roundSel === '*' ? null : Number(roundSel);
        const cols = wcPoolToCollections(pool, onlyIdx);
        const base = onlyIdx != null && pool.rounds && pool.rounds[onlyIdx]
            ? `${pool.label} ${pool.rounds[onlyIdx].name}` : pool.label;
        return osdbResponse(cols, base);
    }

    // Buttons on old /farm messages (farm|… browse, farmx|… export): the
    // feature was retired with the site's Farm Maps tab.
    if (id.startsWith('farm|') || id.startsWith('farmx|')) {
        return L.updateMessage({ title: t('feature_retired'), color: PINK });
    }

    // /mappool round pagination: mp|<folder>|<roundIdx>|<page>  (folder can
    // contain "/", so "|" is the delimiter here rather than ":").
    if (id.startsWith('mp|')) {
        const [, folder, roundIdxStr, pageStr] = id.split('|');
        const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(folder)}`);
        if (!r.ok) return L.updateMessage({ title: t('mappool_fail_short'), color: PINK });
        const view = mappoolRoundView(await r.json(), Number(roundIdxStr), Number(pageStr), origin);
        if (!view) return L.updateMessage({ title: t('mappool_round_not_found2'), color: PINK });
        return L.updateMessage(view.embeds, view.components);
    }

    // /tourneypool: open one pool from the browse list — tp|<poolId>
    if (id.startsWith('tp|')) {
        const v = await tourneyPoolRender(id.slice(3), '', origin);
        if (v.error) return L.updateMessage({ title: v.error, color: PINK });
        return L.updateMessage(v.embeds, v.components);
    }

    // /tourneypool round pagination: cmp|<poolId>|<roundIdx>|<page>
    if (id.startsWith('cmp|')) {
        const [, poolId, roundIdxStr, pageStr] = id.split('|');
        const r = await fetch(`${origin}/.netlify/functions/community-mappools-list?id=${encodeURIComponent(poolId)}`);
        if (!r.ok) return L.updateMessage({ title: t('mappool_fail_short'), color: PINK });
        const view = mappoolRoundView(communityPoolNormalize(await r.json()), Number(roundIdxStr), Number(pageStr), origin, 'community');
        if (!view) return L.updateMessage({ title: t('mappool_round_not_found2'), color: PINK });
        return L.updateMessage(view.embeds, view.components);
    }

    // .osdb export of a community pool / one round: cmpx|<poolId>|<roundIdx|'*'>
    if (id.startsWith('cmpx|')) {
        const [, poolId, roundSel] = id.split('|');
        const r = await fetch(`${origin}/.netlify/functions/community-mappools-list?id=${encodeURIComponent(poolId)}`);
        if (!r.ok) return L.updateMessage({ title: t('export_fail'), color: PINK });
        const pool = communityPoolNormalize(await r.json());
        const onlyIdx = roundSel === '*' ? null : Number(roundSel);
        const cols = wcPoolToCollections(pool, onlyIdx);
        const base = onlyIdx != null && pool.rounds && pool.rounds[onlyIdx]
            ? `${pool.label} ${pool.rounds[onlyIdx].name}` : pool.label;
        return osdbResponse(cols, base);
    }

    const [ns, action, arg] = id.split(':');

    if (ns === 'col' && action === 'rand') {
        const store = getCollectionsStore();
        const full = await store.get(`full:${arg}`, { type: 'json' });
        if (!full || !full.collection) return L.updateMessage({ title: t('collection_gone'), color: PINK });

        const seen = new Map();
        for (const mode of ['standard', 'taiko', 'catch', 'mania']) {
            for (const set of full.collection[mode] || []) {
                if (set && set.beatmapset_id != null && !seen.has(set.beatmapset_id)) seen.set(set.beatmapset_id, set);
            }
        }
        const sets = [...seen.values()];
        if (!sets.length) return L.updateMessage({ title: t('collection_empty'), color: PINK });
        const s = sets[Math.floor(Math.random() * sets.length)];
        const sid = s.beatmapset_id;

        return L.updateMessage({
            author: { name: t('collection_from', { name: full.username || ('#' + arg) }), url: `${origin}/c/${arg}` },
            title: `${s.artist || ''} - ${s.title || ''}`.trim() || `Beatmapset #${sid}`,
            url: `https://osu.ppy.sh/s/${sid}`,
            description: s.creator ? t('mapper', { n: s.creator }) : undefined,
            color: PINK,
            image: { url: `https://assets.ppy.sh/beatmaps/${sid}/covers/cover.jpg` },
            footer: L.siteFooter(t('n_sets_total', { n: sets.length })),
        }, [{
            type: 1,
            components: [
                { type: 2, style: 1, label: t('btn_reroll'), custom_id: `col:rand:${arg}` },
                { type: 2, style: 5, label: t('btn_open_collection'), url: `${origin}/c/${arg}` },
            ],
        }]);
    }

    return L.json({ type: L.R.DEFERRED_UPDATE });
}

/* --- handler ---------------------------------------------------------- */

// Each interaction gets its own locale slot (see runWithLocale): on
// Cloudflare one isolate answers several interactions at once.
exports.handler = (event) => runWithLocale(() => handleInteraction(event));

async function handleInteraction(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : (event.body || '');

    const h = event.headers || {};
    const ok = await L.verifySignature(
        rawBody,
        h['x-signature-ed25519'] || h['X-Signature-Ed25519'],
        h['x-signature-timestamp'] || h['X-Signature-Timestamp'],
        process.env.DISCORD_PUBLIC_KEY,
    );
    if (!ok) return { statusCode: 401, body: 'invalid request signature' };

    let interaction;
    try {
        interaction = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: 'bad json' };
    }

    if (interaction.type === L.T.PING) return L.json({ type: L.R.PONG });

    // Localize responses for the rest of this request (module-scoped in
    // _discord-i18n; one request per invoke): the user's saved /language
    // choice wins, else their Discord client locale.
    const savedLang = await getUserLang(L.invokerId(interaction));
    setLocale(savedLang || interaction.locale);

    const origin = L.originOf(event);
    const name = interaction.data && interaction.data.name;
    const options = L.optsOf(interaction);

    try {
        if (interaction.type === L.T.AUTOCOMPLETE) {
            if (name === 'collection' || name === 'follow' || name === 'unfollow') return await autocompleteCollection(options);
            if (name === 'mappool') return await autocompleteMappool(options, origin);
            if (name === 'tourneypool') return await autocompleteTourneypool(options, origin);
            return L.autocomplete([]);
        }

        if (interaction.type === L.T.COMPONENT) {
            return await handleComponent(interaction, origin);
        }

        if (interaction.type === L.T.COMMAND) {
            switch (name) {
                case 'collection': return await cmdCollection(options, origin);
                case 'gallery': return await cmdGallery(options, origin);
                case 'pp': return await cmdPp(options, interaction);
                // Retired with the site's Farm Maps tab; answers until the
                // command list is re-registered without them.
                case 'farm':
                case 'practice': return L.ephemeral(t('feature_retired'));
                case 'recent': return await cmdRecent(options, interaction, origin);
                case 'rs': return await cmdRecent(options, interaction, origin, 'osu');
                case 'rt': return await cmdRecent(options, interaction, origin, 'taiko');
                case 'rc': return await cmdRecent(options, interaction, origin, 'fruits');
                case 'rm': return await cmdRecent(options, interaction, origin, 'mania');
                case 'help': return await cmdHelp(interaction);
                case 'versus': return await cmdVersus(options, interaction, origin);
                case 'top': return await cmdTop(options, interaction, origin);
                case 'leaderboard': return await cmdLeaderboard(options);
                case 'map': return await cmdMap(options, origin);
                case 'collect-channel': return await cmdCollectChannel(options, interaction, origin);
                case 'follow': return await cmdFollow(options, interaction);
                case 'unfollow': return await cmdUnfollow(options, interaction);
                case 'following': return await cmdFollowing(interaction);
                case 'mappool': return await cmdMappool(options, origin);
                case 'tourneypool': return await cmdTourneypool(options, origin);
                case 'skin': return await cmdSkin(options, origin);
                case 'link': return await cmdLink(options, interaction);
                case 'unlink': return await cmdUnlink(interaction);
                case 'language': return await cmdLanguage(options, interaction);
                default: return L.ephemeral(t('unknown_command'));
            }
        }

        return L.json({ type: L.R.PONG });
    } catch (err) {
        return L.ephemeral(t('error_generic', { msg: String((err && err.message) || err).slice(0, 200) }));
    }
}
