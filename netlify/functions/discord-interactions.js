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
     https://osu-collection-hanabi.netlify.app/discord
   (netlify.toml rewrites /discord -> here.)

   Env: DISCORD_PUBLIC_KEY (signature). OSU_CLIENT_ID/SECRET (osu! API v2,
   via _osu-auth) and NETLIFY_BLOBS_* are already set for the rest of the
   site. Command definitions: scripts/register-discord-commands.mjs — run
   `npm run discord:register` after changing them. */
const { getCollectionsStore, getDiscordBotStore } = require('./_blobs-store');
const { getOsuToken } = require('./_osu-auth');
const { setLocale, t, LANG_NAMES, KNOWN_KEYS } = require('./_discord-i18n');
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
            { name: t('f_grades'), value: `${L.GRADE_EMOJI.SS}${L.fmtNum((g.ss || 0) + (g.ssh || 0))} ${L.GRADE_EMOJI.S}${L.fmtNum((g.s || 0) + (g.sh || 0))} ${L.GRADE_EMOJI.A}${L.fmtNum(g.a || 0)}`, inline: false },
        ],
        footer: L.siteFooter(rankChart ? t('footer_rank_trend') : t('api_v2')),
    });
}

/* --- /recent & /top ------------------------------------------------------- */

function scoreEmbed(score, user, apiMode) {
    const bs = score.beatmapset || {};
    const bm = score.beatmap || {};
    const modStr = L.modsTag(score.mods);
    const acc = score.accuracy != null ? `${(score.accuracy * 100).toFixed(2)}%` : '—';
    const pp = score.pp != null ? `${Math.round(score.pp)}pp` : (score.passed === false ? t('not_passed') : '—');
    const combo = `${L.fmtNum(score.max_combo)}x${bm.max_combo ? ` / ${L.fmtNum(bm.max_combo)}x` : ''}`;
    const covers = bs.covers || {};
    const mTag = L.modeTag(L.API_MODE[bm.mode] || apiMode);
    return {
        author: L.osuAuthor(user, apiMode),
        title: `${mTag ? mTag + ' ' : ''}${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]`.slice(0, 250),
        url: bm.url || (bm.id ? `https://osu.ppy.sh/b/${bm.id}` : undefined),
        description: [
            `${L.gradeTag(score.rank)}${modStr ? ' ' + modStr : ''} · ${acc} · **${pp}**`,
            `${L.fmtNum(score.score)} · ${combo}`,
            `${bm.difficulty_rating != null ? Number(bm.difficulty_rating).toFixed(2) : '?'}★ · ${L.ago(score.created_at)}`,
        ].join('\n'),
        thumbnail: { url: covers['list@2x'] || covers.list || covers.card || undefined },
        color: L.srColor(bm.difficulty_rating),
        footer: L.siteFooter(),
    };
}

async function fetchScores(token, userId, type, apiMode, limit, includeFails) {
    const p = new URLSearchParams({ mode: apiMode, limit: String(limit) });
    if (type === 'recent') p.set('include_fails', includeFails ? '1' : '0');
    const res = await fetch(`https://osu.ppy.sh/api/v2/users/${userId}/scores/${type}?${p}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`osu! API ${res.status}`);
    return res.json();
}

async function cmdRecent(options, interaction) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idx = Math.max(1, Math.min(50, Number(L.optVal(options, 'index')) || 1));

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(t('user_not_found', { name: who }));

    const scores = await fetchScores(token, u.id, 'recent', apiMode, idx, true);
    if (!scores.length) return L.ephemeral(t('recent_none', { name: u.username, mode: L.MODE_LABEL[apiMode] }));
    const score = scores[Math.min(idx, scores.length) - 1];
    return L.message(scoreEmbed(score, u, apiMode));
}

async function cmdTop(options, interaction) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idxOpt = L.optVal(options, 'index');

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(t('user_not_found', { name: who }));

    if (idxOpt != null) {
        const idx = Math.max(1, Math.min(100, Number(idxOpt) || 1));
        const scores = await fetchScores(token, u.id, 'best', apiMode, idx, false);
        if (scores.length < idx) return L.ephemeral(t('top_no_nth', { name: u.username, idx, mode: L.MODE_LABEL[apiMode] }));
        const e = scoreEmbed(scores[idx - 1], u, apiMode);
        e.title = `#${idx} · ${e.title}`;
        return L.message(e);
    }

    const scores = await fetchScores(token, u.id, 'best', apiMode, 5, false);
    if (!scores.length) return L.ephemeral(t('top_none', { name: u.username, mode: L.MODE_LABEL[apiMode] }));
    const body = scores.map((s, i) => {
        const bs = s.beatmapset || {}; const bm = s.beatmap || {};
        const mods = L.modsList(s.mods);
        const modStr = L.modsTag(s.mods);
        const modText = mods.length ? ` **+${mods.join('')}**` : '';
        const head = `**#${i + 1}** ${L.gradeTag(s.rank)}${modStr ? ' ' + modStr : ''}${modText} · **${s.pp != null ? Math.round(s.pp) + 'pp' : '—'}**`;
        const line = `[${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]](${bm.url || 'https://osu.ppy.sh/b/' + bm.id})`;
        const meta = `${s.accuracy != null ? (s.accuracy * 100).toFixed(2) + '%' : '—'} · ${bm.difficulty_rating != null ? Number(bm.difficulty_rating).toFixed(2) : '?'}★ · ${L.ago(s.created_at)}`;
        return `${head}\n${line}\n${meta}`;
    }).join('\n\n');
    return L.message({
        author: L.osuAuthor(u, apiMode),
        title: `${L.modeTag(apiMode) ? L.modeTag(apiMode) + ' ' : ''}${t('top_title', { name: u.username, mode: L.MODE_LABEL[apiMode], n: scores.length })}`,
        url: `https://osu.ppy.sh/users/${u.id}/${apiMode}`,
        color: L.srColor(scores[0].beatmap && scores[0].beatmap.difficulty_rating),
        description: body.slice(0, 4096),
        footer: L.siteFooter(t('api_v2')),
    });
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

    const bmIds = [...all.beatmapIds];
    for (let i = 0; i < bmIds.length; i += 50) {
        const q = new URLSearchParams();
        bmIds.slice(i, i + 50).forEach(id => q.append('ids[]', id));
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmaps?${q}`, auth);
        if (r.ok) for (const bm of (await r.json()).beatmaps || []) push(bm, bm.beatmapset);
    }
    for (const sid of [...all.setIds].slice(0, 15)) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${sid}`, auth);
        if (!r.ok) continue;
        const set = await r.json();
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

/* --- /practice ------------------------------------------------------------ */

async function cmdPractice(options, interaction, origin) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral(t('need_name_or_link'));
    const targetPp = Number(L.optVal(options, 'target_pp'));
    const kind = Number.isFinite(targetPp) && targetPp > 0 ? 'goal' : 'push';

    const qs = new URLSearchParams({ user: who, kind });
    if (kind === 'goal') qs.set('target', String(targetPp));
    const r = await fetch(`${origin}/.netlify/functions/practice-generate?${qs}`);
    const data = await r.json().catch(() => ({}));

    if (r.status === 404) return L.ephemeral(t('user_not_found', { name: who }));
    if (r.status === 422 && data.error === 'not enough top plays') return L.ephemeral(t('practice_need_plays'));
    if (r.status === 422) return L.ephemeral(t('practice_thin'));
    if (data.error === 'goal already reached') return L.ephemeral(t('practice_goal_reached'));
    if (!r.ok || !Array.isArray(data.maps) || !data.maps.length) return L.ephemeral(t('practice_thin'));

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
    return messageWithFile({
        title: t('practice_title', { name: data.name }),
        description: `${t('practice_summary', { count: data.count, note: data.note })}\n\n${preview}${extra > 0 ? `\n${t('practice_more', { n: extra })}` : ''}`,
        color: PINK,
        thumbnail: coverSet ? { url: `https://assets.ppy.sh/beatmaps/${coverSet}/covers/list@2x.jpg` } : undefined,
        footer: L.siteFooter(t('export_done', { name: filename })),
    }, { filename, body: bytes, contentType: 'application/octet-stream' });
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

    const mTag = L.modeTag(L.API_MODE[bm.mode]);
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
            ...(ppLine ? [{ name: t('f_pp_fc'), value: ppLine, inline: false }] : []),
        ],
        footer: L.siteFooter(bm.mode ? L.MODE_LABEL[L.API_MODE[bm.mode]] || bm.mode : undefined),
    });
}

/* --- /mappool ----------------------------------------------------------- */

async function autocompleteMappool(options, origin) {
    const focused = (options || []).find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();
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
    const focused = (options || []).find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();
    let pools = [];
    try {
        const r = await fetch(`${origin}/.netlify/functions/community-mappools-list`);
        if (r.ok) pools = (await r.json()).pools || [];
    } catch { /* empty */ }
    if (q) pools = pools.filter(p => (p.tournamentName || '').toLowerCase().includes(q));
    pools = pools
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 25);
    return L.autocomplete(pools.map(p => ({
        name: `${p.tournamentName} · ${tpoolModeShort(p.mode)} · ${t('mappool_ac_meta', { r: p.roundCount, m: p.mapCount })}`.slice(0, 100),
        value: String(p.id).slice(0, 100),
    })));
}

async function cmdTourneypool(options, origin) {
    const id = String(L.optVal(options, 'tournament') || '').trim();
    const roundQ = String(L.optVal(options, 'round') || '').trim().toLowerCase();
    if (!id) return L.ephemeral(t('tpool_need_name'));

    const r = await fetch(`${origin}/.netlify/functions/community-mappools-list?id=${encodeURIComponent(id)}`);
    if (r.status === 404) return L.ephemeral(t('tpool_not_found'));
    if (!r.ok) return L.ephemeral(t('tpool_fail'));
    const pool = communityPoolNormalize(await r.json());
    const rounds = pool.rounds || [];
    if (!rounds.length) return L.ephemeral(t('tpool_empty', { name: pool.label }));

    if (roundQ) {
        const roundIdx = rounds.findIndex(rd => (rd.name || '').toLowerCase().includes(roundQ));
        if (roundIdx < 0) return L.ephemeral(t('mappool_round_not_found', { label: pool.label, q: roundQ }));
        const view = mappoolRoundView(pool, roundIdx, 0, origin, 'community');
        return L.message(view.embeds, view.components);
    }

    return L.message({
        title: t('tpool_rounds_title', { label: pool.label, mode: tpoolModeShort(pool.mode), n: rounds.length }),
        url: pool.url || `${origin}/?cmpool=${encodeURIComponent(pool.folder)}`,
        description: rounds.map(rd => {
            let n = 0;
            for (const b of rd.brackets || []) n += (b.maps || []).length;
            return `**${rd.name}** — ${t('n_sets', { n })}`;
        }).join('\n') || t('mappool_no_data'),
        color: PINK,
        footer: L.siteFooter(t('tpool_round_hint')),
    }, [{
        type: 1,
        components: [{ type: 2, style: 2, label: t('btn_export_osdb'), custom_id: `cmpx|${pool.folder}|*` }],
    }]);
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
    const modeBits = [];
    if (full && full.collection) {
        for (const [m, label] of [['standard', 'std'], ['taiko', 'taiko'], ['catch', 'catch'], ['mania', 'mania']]) {
            const n = Array.isArray(full.collection[m]) ? full.collection[m].length : 0;
            if (n) modeBits.push(`${label} ${n}`);
        }
    }
    const catNames = ((full && full.categories) || []).map(c => c && c.name).filter(Boolean);

    const embed = {
        author: {
            name: entry.username || ('#' + entry.id),
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
    if (modeBits.length) embed.fields.push({ name: t('f_mode_split'), value: modeBits.join(' · ') });
    if (catNames.length) embed.fields.push({ name: t('f_categories', { n: catNames.length }), value: catNames.join(', ').slice(0, 1024) });

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

// The precomputed mod combos the farm dataset carries pp/stars for.
const FARM_MODS = ['NM', 'HD', 'HR', 'DT', 'HDDT', 'HDHR'];

// One farm pick at position `index` (pp-desc) within a mode/mods/pp-band
// filter, plus ◀ 🎲 ▶ buttons that re-run this via a component interaction.
// index < 0 = pick a random position. Returns { error } or { embed, components }.
async function farmView({ mode, mods, ppMin, ppMax, index }, origin) {
    // mania pp doesn't scale with mods (and HR/EZ aren't mania mods at all),
    // so the mods filter is meaningless there — pin it to NM.
    if (mode === 'mania') mods = 'NM';
    const qs = new URLSearchParams({ mode, mods, sort: 'pp_desc', farmOnly: '1' });
    if (ppMin) qs.set('ppMin', String(ppMin));
    if (ppMax) qs.set('ppMax', String(ppMax));
    const any = t('farm_unlimited');
    const band = t('pp_band', { lo: ppMin || any, hi: ppMax || any });

    const probe = await fetch(`${origin}/.netlify/functions/farm-maps-list?${qs}&page=0`);
    if (!probe.ok) return { error: t('farm_query_fail') };
    const d0 = await probe.json();
    const total = d0.total || 0;
    if (!total) return { error: t('farm_none', { mode: L.MODE_LABEL[mode], mods, band }) };

    const pageSize = d0.pageSize || 20;
    const idx = index < 0 ? Math.floor(Math.random() * total) : (((index % total) + total) % total);
    const pg = Math.floor(idx / pageSize);
    let items = d0.items || [];
    if (pg > 0) {
        const r = await fetch(`${origin}/.netlify/functions/farm-maps-list?${qs}&page=${pg}`);
        if (r.ok) items = (await r.json()).items || [];
    }
    const m = items[idx % pageSize];
    if (!m) return { error: t('farm_pick_fail') };

    const setId = m.beatmapset_id || null;
    const mapId = m.beatmap_id || null;
    const mt = L.modeTag(mode);
    const modChips = mods !== 'NM' ? L.modsTag(mods.match(/../g)) : '';
    const name = `${m.artist || ''} - ${m.title || ''}`.trim() || `Beatmapset ${setId || ''}`.trim();
    const cid = (i) => `farm|${mode}|${mods}|${ppMin}|${ppMax}|${i}`;

    return {
        embed: {
            title: `${mt ? mt + ' ' : ''}${name}${m.version ? ` [${m.version}]` : ''}`.slice(0, 250),
            url: mapId ? `https://osu.ppy.sh/b/${mapId}` : (setId ? `https://osu.ppy.sh/s/${setId}` : `${origin}/`),
            description: [modChips, m.creator ? t('mapper', { n: m.creator }) : null].filter(Boolean).join('\n') || undefined,
            color: L.srColor(m.star),
            image: setId ? { url: `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` } : undefined,
            fields: [
                { name: t('farm_f_pp', { mods }), value: m.pp != null ? `~${Math.round(m.pp)}pp` : '—', inline: true },
                { name: t('f_stars'), value: m.star != null ? `${Number(m.star).toFixed(2)}★` : '—', inline: true },
                { name: 'BPM', value: m.bpm != null ? String(Math.round(m.bpm)) : '—', inline: true },
                { name: t('f_length'), value: m.total_length ? L.fmtLen(m.total_length) : '—', inline: true },
                { name: 'AR / OD / CS', value: `${m.ar ?? '—'} / ${m.od ?? '—'} / ${m.cs ?? '—'}`, inline: true },
            ],
            footer: L.siteFooter(`${t('farm_footer', { band })} · ${idx + 1}/${L.fmtNum(total)}`),
        },
        components: [
            {
                type: 1,
                components: [
                    { type: 2, style: 2, label: t('farm_btn_prev'), custom_id: cid(idx - 1) },
                    { type: 2, style: 1, label: t('farm_btn_random'), custom_id: cid(-1) },
                    { type: 2, style: 2, label: t('farm_btn_next'), custom_id: cid(idx + 1) },
                ],
            },
            {
                type: 1,
                components: [
                    { type: 2, style: 2, label: t('btn_export_osdb'), custom_id: `farmx|${mode}|${mods}|${ppMin}|${ppMax}` },
                ],
            },
        ],
    };
}

// Pull up to `cap` maps of a farm filter across pages -> one .osdb collection.
async function farmBandToCollection(mode, mods, ppMin, ppMax, origin, cap = 120) {
    if (mode === 'mania') mods = 'NM';
    const qs = new URLSearchParams({ mode, mods, sort: 'pp_desc', farmOnly: '1' });
    if (ppMin) qs.set('ppMin', String(ppMin));
    if (ppMax) qs.set('ppMax', String(ppMax));
    const beatmaps = [];
    for (let page = 0; beatmaps.length < cap && page < 8; page++) {
        const r = await fetch(`${origin}/.netlify/functions/farm-maps-list?${qs}&page=${page}`);
        if (!r.ok) break;
        const items = (await r.json()).items || [];
        if (!items.length) break;
        for (const m of items) {
            beatmaps.push({
                mapId: m.beatmap_id, mapSetId: m.beatmapset_id || 0,
                artist: m.artist || '', title: m.title || '', diff: m.version || '',
                md5: '', mode: MODE_INT[mode] || 0, stars: m.star || 0,
            });
            if (beatmaps.length >= cap) break;
        }
    }
    const any = t('farm_unlimited');
    const band = t('pp_band', { lo: ppMin || any, hi: ppMax || any });
    return beatmaps.length ? [{ name: `Farm ${mods} ${band}`, beatmaps }] : [];
}

async function cmdFarm(options, origin) {
    // farm-maps-list keys datasets by the API ruleset name (osu/taiko/fruits/
    // mania). API_MODE maps both "catch" and "fruits" -> "fruits", so an old
    // "catch" value still resolves instead of silently falling back to osu.
    const mode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const mods = FARM_MODS.includes(L.optVal(options, 'mods')) ? L.optVal(options, 'mods') : 'NM';
    let ppMin = Math.max(0, Number(L.optVal(options, 'pp_min')) || 0);
    let ppMax = Math.max(0, Number(L.optVal(options, 'pp_max')) || 0);
    if (ppMin && ppMax && ppMax < ppMin) [ppMin, ppMax] = [ppMax, ppMin];
    if (ppMin && !ppMax) ppMax = Math.round(ppMin * 1.4);

    const v = await farmView({ mode, mods, ppMin, ppMax, index: -1 }, origin);
    if (v.error) return L.ephemeral(v.error);
    return L.message(v.embed, v.components);
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

    // .osdb export of a farm filter band: farmx|<mode>|<mods>|<ppMin>|<ppMax>
    if (id.startsWith('farmx|')) {
        const [, mode, mods, ppMinS, ppMaxS] = id.split('|');
        const cols = await farmBandToCollection(mode, mods, Number(ppMinS) || 0, Number(ppMaxS) || 0, origin);
        return osdbResponse(cols, `Farm ${mode} ${mods}`);
    }

    // /farm browse: farm|<mode>|<mods>|<ppMin>|<ppMax>|<index>  (index -1 = random)
    if (id.startsWith('farm|')) {
        const [, mode, mods, ppMinS, ppMaxS, idxS] = id.split('|');
        const v = await farmView({
            mode, mods, ppMin: Number(ppMinS) || 0, ppMax: Number(ppMaxS) || 0, index: Number(idxS),
        }, origin);
        if (v.error) return L.updateMessage({ title: v.error, color: PINK });
        return L.updateMessage(v.embed, v.components);
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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : (event.body || '');

    const h = event.headers || {};
    const ok = L.verifySignature(
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
                case 'farm': return await cmdFarm(options, origin);
                case 'recent': return await cmdRecent(options, interaction);
                case 'top': return await cmdTop(options, interaction);
                case 'map': return await cmdMap(options, origin);
                case 'practice': return await cmdPractice(options, interaction, origin);
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
};
