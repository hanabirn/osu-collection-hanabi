/* Discord bot — HTTP Interactions endpoint (no persistent gateway).
   Discord POSTs every slash-command / autocomplete / message-component
   interaction here; we verify the Ed25519 signature (see _discord-lib.js),
   then answer synchronously within the 3 s window. Every command is one or
   two blob reads / internal fetches, comfortably under budget, so there is
   no deferred-response dance.

   Endpoint URL (set in the Discord developer portal):
     https://osu-collection-hanabi.netlify.app/discord
   (netlify.toml rewrites /discord -> here.)

   Env: DISCORD_PUBLIC_KEY (signature). OSU_CLIENT_ID/SECRET (osu! API v2,
   via _osu-auth) and NETLIFY_BLOBS_* are already set for the rest of the
   site. Command definitions: scripts/register-discord-commands.mjs — run
   `npm run discord:register` after changing them. */
const { getCollectionsStore, getDiscordBotStore } = require('./_blobs-store');
const { getOsuToken } = require('./_osu-auth');
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

async function cmdLink(options, interaction) {
    const name = String(L.optVal(options, 'username') || '').trim();
    if (!name) return L.ephemeral('請提供 osu! 使用者名稱或 ID。');
    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, name, '');
    if (!u) return L.ephemeral(`找不到玩家「${name}」。`);
    await getDiscordBotStore().setJSON(`link:${L.invokerId(interaction)}`, {
        osuUserId: u.id, osuUsername: u.username, linkedAt: new Date().toISOString(),
    });
    return L.ephemeral(`已綁定 **${u.username}**（#${u.id}）。現在 \`/pp\`、\`/recent\`、\`/top\` 可以不帶名稱。`);
}

async function cmdUnlink(interaction) {
    await getDiscordBotStore().delete(`link:${L.invokerId(interaction)}`);
    return L.ephemeral('已解除綁定。');
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
    if (!who) return L.ephemeral('請帶上 osu! 名稱，或先用 `/link` 綁定你的帳號。');
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(`找不到玩家「${who}」。`);
    const s = u.statistics || {};
    const g = s.grade_counts || {};
    const playHours = s.play_time != null ? `${Math.round(s.play_time / 3600).toLocaleString('en-US')} 小時` : '—';
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
            { name: 'PP', value: s.pp != null ? `${Math.round(s.pp).toLocaleString('en-US')}pp` : '—', inline: true },
            { name: '全球排名', value: s.global_rank ? `#${L.fmtNum(s.global_rank)}` : '—', inline: true },
            { name: `${u.country_code || '國內'} 排名`, value: s.country_rank ? `#${L.fmtNum(s.country_rank)}` : '—', inline: true },
            { name: '準度', value: s.hit_accuracy != null ? `${s.hit_accuracy.toFixed(2)}%` : '—', inline: true },
            { name: '遊玩次數', value: L.fmtNum(s.play_count), inline: true },
            { name: '等級', value: s.level && s.level.current != null ? String(s.level.current) : '—', inline: true },
            { name: '最大連擊', value: L.fmtNum(s.maximum_combo), inline: true },
            { name: '遊玩時間', value: playHours, inline: true },
            { name: '成績', value: `${L.GRADE_EMOJI.SS}${L.fmtNum((g.ss || 0) + (g.ssh || 0))} ${L.GRADE_EMOJI.S}${L.fmtNum((g.s || 0) + (g.sh || 0))} ${L.GRADE_EMOJI.A}${L.fmtNum(g.a || 0)}`, inline: false },
        ],
        footer: L.siteFooter(rankChart ? '排名走勢：近 90 天 · osu! API v2' : 'osu! API v2'),
    });
}

/* --- /recent & /top ------------------------------------------------------- */

function scoreEmbed(score, user, apiMode) {
    const bs = score.beatmapset || {};
    const bm = score.beatmap || {};
    const modStr = L.modsTag(score.mods);
    const acc = score.accuracy != null ? `${(score.accuracy * 100).toFixed(2)}%` : '—';
    const pp = score.pp != null ? `${Math.round(score.pp)}pp` : (score.passed === false ? '未通過' : '—');
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
            `★${bm.difficulty_rating != null ? Number(bm.difficulty_rating).toFixed(2) : '?'} · ${L.ago(score.created_at)}`,
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
    if (!who) return L.ephemeral('請帶上 osu! 名稱，或先用 `/link` 綁定你的帳號。');
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idx = Math.max(1, Math.min(50, Number(L.optVal(options, 'index')) || 1));

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(`找不到玩家「${who}」。`);

    const scores = await fetchScores(token, u.id, 'recent', apiMode, idx, true);
    if (!scores.length) return L.ephemeral(`${u.username} 最近沒有 ${L.MODE_LABEL[apiMode]} 成績（osu! 只保留最近 24 小時內的遊玩）。`);
    const score = scores[Math.min(idx, scores.length) - 1];
    return L.message(scoreEmbed(score, u, apiMode));
}

async function cmdTop(options, interaction) {
    const who = await resolveWho(options, interaction);
    if (!who) return L.ephemeral('請帶上 osu! 名稱，或先用 `/link` 綁定你的帳號。');
    const apiMode = L.API_MODE[L.optVal(options, 'mode')] || 'osu';
    const idxOpt = L.optVal(options, 'index');

    const token = await getOsuToken();
    const u = await L.resolveOsuUser(token, who, apiMode);
    if (!u) return L.ephemeral(`找不到玩家「${who}」。`);

    if (idxOpt != null) {
        const idx = Math.max(1, Math.min(100, Number(idxOpt) || 1));
        const scores = await fetchScores(token, u.id, 'best', apiMode, idx, false);
        if (scores.length < idx) return L.ephemeral(`${u.username} 沒有第 ${idx} 名的 ${L.MODE_LABEL[apiMode]} 成績。`);
        const e = scoreEmbed(scores[idx - 1], u, apiMode);
        e.title = `#${idx} · ${e.title}`;
        return L.message(e);
    }

    const scores = await fetchScores(token, u.id, 'best', apiMode, 5, false);
    if (!scores.length) return L.ephemeral(`${u.username} 沒有 ${L.MODE_LABEL[apiMode]} 的最佳成績。`);
    // A compact description block. (Tried one embed per play with the mod
    // hexagon as a thumbnail — Discord blows small non-square PNGs up to fill
    // the box, so the grade badges looked huge and the mod glyphs
    // unreadable. Inline emoji it is; the acronym text carries the detail.)
    const body = scores.map((s, i) => {
        const bs = s.beatmapset || {}; const bm = s.beatmap || {};
        const mods = L.modsList(s.mods);
        const modStr = L.modsTag(s.mods);
        const modText = mods.length ? ` **+${mods.join('')}**` : '';
        const head = `**#${i + 1}** ${L.gradeTag(s.rank)}${modStr ? ' ' + modStr : ''}${modText} · **${s.pp != null ? Math.round(s.pp) + 'pp' : '—'}**`;
        const line = `[${bs.artist || ''} - ${bs.title || ''} [${bm.version || ''}]](${bm.url || 'https://osu.ppy.sh/b/' + bm.id})`;
        const meta = `${s.accuracy != null ? (s.accuracy * 100).toFixed(2) + '%' : '—'} · ★${bm.difficulty_rating != null ? Number(bm.difficulty_rating).toFixed(2) : '?'} · ${L.ago(s.created_at)}`;
        return `${head}\n${line}\n${meta}`;
    }).join('\n\n');
    return L.message({
        author: L.osuAuthor(u, apiMode),
        title: `${L.modeTag(apiMode) ? L.modeTag(apiMode) + ' ' : ''}${u.username} — ${L.MODE_LABEL[apiMode]} 最佳 ${scores.length} 名`,
        url: `https://osu.ppy.sh/users/${u.id}/${apiMode}`,
        color: L.srColor(scores[0].beatmap && scores[0].beatmap.difficulty_rating),
        description: body.slice(0, 4096),
        footer: L.siteFooter('osu! API v2'),
    });
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
        if (r.status === 404) return L.ephemeral('找不到這張圖。');
        if (!r.ok) return L.ephemeral('osu! API 查詢失敗，稍後再試。');
        bm = await r.json();
    } else if (setId) {
        const r = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${setId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return L.ephemeral('找不到這個圖組。');
        const set = await r.json();
        bm = (set.beatmaps || []).slice().sort((a, b) => b.difficulty_rating - a.difficulty_rating)[0];
        if (bm) bm.beatmapset = set;
        if (!bm) return L.ephemeral('這個圖組沒有難度資料。');
    } else {
        return L.ephemeral('請貼 osu! 圖譜連結或 ID。');
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
        description: bs.creator ? `mapper：${bs.creator}` : undefined,
        color: L.srColor(bm.difficulty_rating),
        image: bs.covers ? { url: bs.covers.cover || bs.covers['cover@2x'] } : undefined,
        fields: [
            { name: '難度', value: `★${Number(bm.difficulty_rating).toFixed(2)}`, inline: true },
            { name: 'BPM', value: bm.bpm != null ? String(Math.round(bm.bpm)) : '—', inline: true },
            { name: '長度', value: L.fmtLen(bm.total_length), inline: true },
            { name: 'AR / OD / CS / HP', value: `${bm.ar ?? '—'} / ${bm.accuracy ?? '—'} / ${bm.cs ?? '—'} / ${bm.drain ?? '—'}`, inline: true },
            { name: '最大連擊', value: bm.max_combo != null ? `${L.fmtNum(bm.max_combo)}x` : '—', inline: true },
            { name: '狀態', value: bm.status || '—', inline: true },
            ...(ppLine ? [{ name: 'PP（FC）', value: ppLine, inline: false }] : []),
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
        name: `${e.label} · ${e.roundCount} 輪 / ${e.mapCount} 圖`.slice(0, 100),
        value: e.folder,
    })));
}

const MAPPOOL_PAGE = 9; // maps per message (Discord caps at 10 embeds; one slot spare)

// One embed per map (cover + mods + stats), a page at a time, with prev/next
// buttons for rounds longer than MAPPOOL_PAGE.
function mappoolRoundView(pool, roundIdx, page, origin) {
    const round = (pool.rounds || [])[roundIdx];
    if (!round) return null;

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
        // The mod hexagon rides as the embed thumbnail (top-right, ~80 px) so
        // it's actually visible — an inline custom emoji is tiny. Its text
        // form (HD2 / FM / TB) still leads the description for clarity; the
        // ruleset emoji stays inline there.
        const mod = L.bracketMod(m.bracket);
        const modIconUrl = L.emojiImageUrl(L.MOD_EMOJI[mod], 128);
        const slotLabel = mod ? `**${mod}${m.slot || ''}**` : '';
        const badges = [slotLabel, mt].filter(Boolean).join('  ');
        const meta = [
            m.stars != null ? `★${Number(m.stars).toFixed(2)}` : null,
            m.bpm != null ? `${Math.round(m.bpm)} BPM` : null,
            m.length != null ? L.fmtLen(m.length) : null,
            m.creator ? `mapper：${m.creator}` : null,
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
                ? L.siteFooter(`${round.name} · 第 ${p + 1}/${pages} 頁 · 共 ${maps.length} 圖`)
                : undefined,
        };
    });
    if (!embeds.length) embeds.push({ title: `${pool.label} — ${round.name}`, description: '（這一輪還沒有解析好的圖）', color: PINK });

    const components = pages > 1 ? [{
        type: 1,
        components: [
            { type: 2, style: 2, label: '◀ 上一頁', custom_id: `mp|${pool.folder}|${roundIdx}|${p - 1}`, disabled: p === 0 },
            { type: 2, style: 2, label: '下一頁 ▶', custom_id: `mp|${pool.folder}|${roundIdx}|${p + 1}`, disabled: p >= pages - 1 },
        ],
    }] : [];
    return { embeds, components };
}

async function cmdMappool(options, origin) {
    const folder = String(L.optVal(options, 'edition') || '').trim();
    const roundQ = String(L.optVal(options, 'round') || '').trim().toLowerCase();
    if (!folder) return L.ephemeral('請選一個賽事版本（例如 OWC/2024）。');

    const r = await fetch(`${origin}/.netlify/functions/wc-mappools-list?folder=${encodeURIComponent(folder)}`);
    if (r.status === 404) return L.ephemeral('找不到這個賽事版本。用自動補完選一個。');
    if (!r.ok) return L.ephemeral('世界盃圖池查詢失敗，稍後再試。');
    const pool = await r.json();
    const rounds = pool.rounds || [];

    if (roundQ) {
        const roundIdx = rounds.findIndex(rd => (rd.name || '').toLowerCase().includes(roundQ));
        if (roundIdx < 0) return L.ephemeral(`「${pool.label}」沒有符合「${roundQ}」的輪次。`);
        const view = mappoolRoundView(pool, roundIdx, 0, origin);
        return L.message(view.embeds, view.components);
    }

    return L.message({
        title: `${pool.label} — ${rounds.length} 輪`,
        url: `${origin}/`,
        description: rounds.map(rd => {
            let n = 0;
            for (const b of rd.brackets || []) n += (b.maps || []).length;
            return `**${rd.name}** — ${n} 圖`;
        }).join('\n') || '（尚無資料）',
        color: PINK,
        footer: L.siteFooter('用 /mappool round:<輪次> 看單輪圖池'),
    });
}

/* --- /skin ------------------------------------------------------------ */

async function cmdSkin(options, origin) {
    const q = String(L.optVal(options, 'query') || '').trim();
    if (!q) return L.ephemeral('請輸入皮膚名稱或作者。');
    const r = await fetch(`${origin}/.netlify/functions/skin-screenshots-list?sort=likes&q=${encodeURIComponent(q)}`);
    if (!r.ok) return L.ephemeral('皮膚庫查詢失敗，稍後再試。');
    const items = (await r.json()).items || [];
    if (!items.length) return L.ephemeral(`找不到符合「${q}」的皮膚。`);

    const top = items[0];
    const more = items.slice(1, 5).map(s => `• **${s.skinName}** — ${s.author || '?'}（♥${s.likeCount || 0}）`);
    return L.message({
        title: top.skinName,
        url: `${origin}/`,
        description: [
            top.author ? `作者：${top.author}` : null,
            top.username ? `分享者：${top.username}` : null,
            more.length ? `\n其他結果：\n${more.join('\n')}` : null,
        ].filter(Boolean).join('\n'),
        color: PINK,
        image: { url: `${origin}/.netlify/functions/skin-screenshots-image?id=${top.id}` },
        footer: L.siteFooter('皮膚庫'),
    });
}

/* --- /collection & /gallery ------------------------------------------------ */

function collectionButtons(entry, origin) {
    return [{
        type: 1,
        components: [
            { type: 2, style: 1, label: '🎲 隨機一張圖', custom_id: `col:rand:${entry.id}` },
            { type: 2, style: 5, label: '開啟收藏', url: `${origin}/c/${entry.id}` },
            { type: 2, style: 5, label: '發佈者主頁', url: `https://osu.ppy.sh/users/${entry.id}` },
        ],
    }];
}

async function cmdCollection(options, origin) {
    const query = String(L.optVal(options, 'query') || '').trim();
    if (!query) return L.ephemeral('請輸入發佈者名稱、收藏 ID 或分類關鍵字。');

    const store = getCollectionsStore();
    const index = (await store.get('index', { type: 'json' })) || [];

    let entry = null;
    if (/^\d+$/.test(query)) entry = index.find(e => String(e.id) === query) || null;
    if (!entry) {
        const q = query.toLowerCase();
        entry = index.find(e => (e.username || '').toLowerCase() === q)
            || index.find(e => (e.username || '').toLowerCase().includes(q))
            || index.find(e => (e.tags || []).some(t => t.toLowerCase().includes(q)))
            || null;
    }
    if (!entry) return L.ephemeral(`找不到符合「${query}」的已發佈收藏。試試 \`/gallery\`。`);

    const full = await store.get(`full:${entry.id}`, { type: 'json' });
    const modeBits = [];
    if (full && full.collection) {
        for (const [m, label] of [['standard', 'std'], ['taiko', 'taiko'], ['catch', 'catch'], ['mania', 'mania']]) {
            const n = Array.isArray(full.collection[m]) ? full.collection[m].length : 0;
            if (n) modeBits.push(`${label} ${n}`);
        }
    }
    const catNames = ((full && full.categories) || []).map(c => c && c.name).filter(Boolean);
    const descBits = [`${entry.totalSets || 0} 圖組`];
    if (entry.maxRating) descBits.push(`最高 ${Number(entry.maxRating).toFixed(2)}★`);
    if (entry.avgRating) descBits.push(`平均 ${Number(entry.avgRating).toFixed(2)}★`);
    if (entry.likeCount) descBits.push(`♥ ${entry.likeCount}`);

    const embed = {
        title: `${entry.username || ('#' + entry.id)} 的 osu! 收藏`,
        url: `${origin}/c/${entry.id}`,
        description: descBits.join(' · '),
        color: entry.maxRating ? L.srColor(entry.maxRating) : PINK,
        image: { url: `${origin}/.netlify/functions/og-collection?id=${entry.id}` },
        fields: [],
        footer: L.siteFooter(),
        timestamp: entry.updatedAt || undefined,
    };
    if (modeBits.length) embed.fields.push({ name: '模式分佈', value: modeBits.join(' · ') });
    if (catNames.length) embed.fields.push({ name: `分類 (${catNames.length})`, value: catNames.join(', ').slice(0, 1024) });

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
            (e.tags || []).some(t => t.toLowerCase().includes(q)));
    }
    pool = pool.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 25);
    return L.autocomplete(pool.map(e => ({
        name: `${e.username || ('#' + e.id)} · ${e.totalSets || 0} 圖組`.slice(0, 100),
        value: String(e.id),
    })));
}

async function cmdGallery(options, origin) {
    const page = Math.max(0, Math.min(50, (Number(L.optVal(options, 'page')) || 1) - 1));
    const res = await fetch(`${origin}/.netlify/functions/collections-list?page=${page}&sort=recent`);
    if (!res.ok) return L.ephemeral('讀取收藏廣場失敗，稍後再試。');
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return L.ephemeral('這一頁沒有收藏。');

    const lines = items.slice(0, 12).map((e, i) => {
        const bits = [`${e.totalSets || 0} 圖組`];
        if (e.maxRating) bits.push(`${Number(e.maxRating).toFixed(1)}★`);
        if (e.likeCount) bits.push(`♥${e.likeCount}`);
        const n = String(page * 20 + i + 1).padStart(2, ' ');
        return `\`${n}\` **${e.username || ('#' + e.id)}** — ${bits.join(' · ')} · [開啟](${origin}/c/${e.id})`;
    });
    return L.message({
        title: '收藏廣場 — 最新發佈',
        url: `${origin}/`,
        description: lines.join('\n'),
        color: PINK,
        footer: L.siteFooter(`第 ${page + 1} 頁 · 共 ${data.total || items.length} 份`),
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
    const band = `${ppMin || '不限'}–${ppMax || '不限'} PP`;

    const probe = await fetch(`${origin}/.netlify/functions/farm-maps-list?${qs}&page=0`);
    if (!probe.ok) return { error: '農分圖資料庫查詢失敗，稍後再試。' };
    const d0 = await probe.json();
    const total = d0.total || 0;
    if (!total) return { error: `${L.MODE_LABEL[mode]} · ${mods} 在 ${band} 沒有農分圖，放寬條件看看。` };

    const pageSize = d0.pageSize || 20;
    const idx = index < 0 ? Math.floor(Math.random() * total) : (((index % total) + total) % total);
    const pg = Math.floor(idx / pageSize);
    let items = d0.items || [];
    if (pg > 0) {
        const r = await fetch(`${origin}/.netlify/functions/farm-maps-list?${qs}&page=${pg}`);
        if (r.ok) items = (await r.json()).items || [];
    }
    const m = items[idx % pageSize];
    if (!m) return { error: '抽取失敗，再試一次。' };

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
            description: [modChips, m.creator ? `mapper：${m.creator}` : null].filter(Boolean).join('\n') || undefined,
            color: L.srColor(m.star),
            image: setId ? { url: `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` } : undefined,
            fields: [
                { name: `PP（${mods}）`, value: m.pp != null ? `~${Math.round(m.pp)}pp` : '—', inline: true },
                { name: '星數', value: m.star != null ? `${Number(m.star).toFixed(2)}★` : '—', inline: true },
                { name: 'BPM', value: m.bpm != null ? String(Math.round(m.bpm)) : '—', inline: true },
                { name: '長度', value: m.total_length ? L.fmtLen(m.total_length) : '—', inline: true },
                { name: 'AR / OD / CS', value: `${m.ar ?? '—'} / ${m.od ?? '—'} / ${m.cs ?? '—'}`, inline: true },
                { name: '排名', value: `${idx + 1} / ${L.fmtNum(total)}`, inline: true },
            ],
            footer: L.siteFooter(`Farm Maps · ${band}`),
        },
        components: [{
            type: 1,
            components: [
                { type: 2, style: 2, label: '◀ 上一張', custom_id: cid(idx - 1) },
                { type: 2, style: 1, label: '🎲 隨機', custom_id: cid(-1) },
                { type: 2, style: 2, label: '下一張 ▶', custom_id: cid(idx + 1) },
            ],
        }],
    };
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

/* --- message component (buttons) --------------------------------------- */

async function handleComponent(interaction, origin) {
    const id = (interaction.data && interaction.data.custom_id) || '';

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
        if (!r.ok) return L.updateMessage({ title: '世界盃圖池查詢失敗', color: PINK });
        const view = mappoolRoundView(await r.json(), Number(roundIdxStr), Number(pageStr), origin);
        if (!view) return L.updateMessage({ title: '找不到輪次', color: PINK });
        return L.updateMessage(view.embeds, view.components);
    }

    const [ns, action, arg] = id.split(':');

    if (ns === 'col' && action === 'rand') {
        const store = getCollectionsStore();
        const full = await store.get(`full:${arg}`, { type: 'json' });
        if (!full || !full.collection) return L.updateMessage({ title: '這份收藏已不存在', color: PINK });

        const seen = new Map();
        for (const mode of ['standard', 'taiko', 'catch', 'mania']) {
            for (const set of full.collection[mode] || []) {
                if (set && set.beatmapset_id != null && !seen.has(set.beatmapset_id)) seen.set(set.beatmapset_id, set);
            }
        }
        const sets = [...seen.values()];
        if (!sets.length) return L.updateMessage({ title: '這份收藏是空的', color: PINK });
        const s = sets[Math.floor(Math.random() * sets.length)];
        const sid = s.beatmapset_id;

        return L.updateMessage({
            author: { name: `來自 ${full.username || ('#' + arg)} 的收藏`, url: `${origin}/c/${arg}` },
            title: `${s.artist || ''} - ${s.title || ''}`.trim() || `Beatmapset #${sid}`,
            url: `https://osu.ppy.sh/s/${sid}`,
            description: s.creator ? `mapper：${s.creator}` : undefined,
            color: PINK,
            image: { url: `https://assets.ppy.sh/beatmaps/${sid}/covers/cover.jpg` },
            footer: L.siteFooter(`共 ${sets.length} 圖組`),
        }, [{
            type: 1,
            components: [
                { type: 2, style: 1, label: '🎲 再抽一張', custom_id: `col:rand:${arg}` },
                { type: 2, style: 5, label: '開啟收藏', url: `${origin}/c/${arg}` },
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

    const origin = L.originOf(event);
    const name = interaction.data && interaction.data.name;
    const options = L.optsOf(interaction);

    try {
        if (interaction.type === L.T.AUTOCOMPLETE) {
            if (name === 'collection') return await autocompleteCollection(options);
            if (name === 'mappool') return await autocompleteMappool(options, origin);
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
                case 'mappool': return await cmdMappool(options, origin);
                case 'skin': return await cmdSkin(options, origin);
                case 'link': return await cmdLink(options, interaction);
                case 'unlink': return await cmdUnlink(interaction);
                default: return L.ephemeral('未知指令。');
            }
        }

        return L.json({ type: L.R.PONG });
    } catch (err) {
        return L.ephemeral(`發生錯誤：${String((err && err.message) || err).slice(0, 200)}`);
    }
};
