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
    const spark = L.sparkline(rankHist.slice(-30));

    return L.message({
        author: L.osuAuthor(u, apiMode),
        title: `${L.modeTag(apiMode) ? L.modeTag(apiMode) + ' ' : ''}${u.username} — ${L.MODE_LABEL[apiMode]}`,
        url: `https://osu.ppy.sh/users/${u.id}/${apiMode}`,
        color: L.rankColor(s.global_rank),
        thumbnail: u.avatar_url ? { url: u.avatar_url } : undefined,
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
            ...(spark ? [{ name: '近 30 天排名走勢', value: `\`${spark}\``, inline: false }] : []),
        ],
        footer: L.siteFooter('osu! API v2'),
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
    // A description block, not fields — fields box each entry into a narrow
    // column and wrap the trailing "N 年前" mid-word.
    const body = scores.map((s, i) => {
        const bs = s.beatmapset || {}; const bm = s.beatmap || {};
        const modStr = L.modsTag(s.mods);
        const head = `**#${i + 1}** ${L.gradeTag(s.rank)}${modStr ? ' ' + modStr : ''} · **${s.pp != null ? Math.round(s.pp) + 'pp' : '—'}**`;
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
        const round = rounds.find(rd => (rd.name || '').toLowerCase().includes(roundQ));
        if (!round) return L.ephemeral(`「${pool.label}」沒有符合「${roundQ}」的輪次。`);
        const lines = [];
        for (const b of round.brackets || []) {
            for (const m of b.maps || []) {
                const tag = b.label ? `\`${b.label}\` ` : '';
                const mt = L.modeTag(L.API_MODE[m.mode]);
                const name = m.resolved ? `${m.artist} - ${m.title} [${m.version}]` : `#${m.beatmapId}`;
                const sr = m.stars != null ? ` ★${Number(m.stars).toFixed(2)}` : '';
                lines.push(`${mt ? mt + ' ' : ''}${tag}[${name}](https://osu.ppy.sh/b/${m.beatmapId})${sr}`);
                if (lines.length >= 24) break;
            }
        }
        return L.message({
            title: `${pool.label} — ${round.name}`,
            url: round.mappackUrl || `${origin}/`,
            description: lines.join('\n') || '（這一輪還沒有解析好的圖）',
            color: PINK,
            footer: L.siteFooter('世界盃圖池'),
        });
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

async function cmdFarm(options, origin) {
    const mode = L.optVal(options, 'mode') || 'osu';
    const ppMin = Number(L.optVal(options, 'pp_min'));
    const build = (page) => {
        const p = new URLSearchParams({ mode, sort: 'pp_desc', farmOnly: '1', page: String(page) });
        if (Number.isFinite(ppMin) && ppMin > 0) p.set('ppMin', String(ppMin));
        return `${origin}/.netlify/functions/farm-maps-list?${p}`;
    };
    let res = await fetch(build(Math.floor(Math.random() * 5)));
    let items = res.ok ? ((await res.json()).items || []) : [];
    if (!items.length) {
        res = await fetch(build(0));
        items = res.ok ? ((await res.json()).items || []) : [];
    }
    if (!items.length) return L.ephemeral('農分圖資料庫目前沒有符合條件的圖。');

    const m = items[Math.floor(Math.random() * items.length)];
    const setId = m.beatmapset_id || m.beatmapsetId || null;
    const mapId = m.beatmap_id || m.beatmapId || m.id || null;
    const fields = [
        { name: 'PP', value: m.pp != null ? `~${Math.round(m.pp)}pp` : '—', inline: true },
        { name: '星數', value: m.star != null ? `${Number(m.star).toFixed(2)}★` : '—', inline: true },
        { name: 'BPM', value: m.bpm != null ? String(Math.round(m.bpm)) : '—', inline: true },
    ];
    if (m.total_length) fields.push({ name: '長度', value: L.fmtLen(m.total_length), inline: true });
    const name = `${m.artist || ''} - ${m.title || ''}`.trim() || `Beatmapset ${setId || ''}`.trim();
    return L.message({
        title: (name + (m.version ? ` [${m.version}]` : '')).slice(0, 250),
        url: mapId ? `https://osu.ppy.sh/b/${mapId}` : (setId ? `https://osu.ppy.sh/s/${setId}` : `${origin}/`),
        description: m.creator ? `mapper：${m.creator}` : undefined,
        color: L.srColor(m.star),
        image: setId ? { url: `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` } : undefined,
        fields,
        footer: L.siteFooter('Farm Maps'),
    });
}

/* --- message component (buttons) --------------------------------------- */

async function handleComponent(interaction, origin) {
    const id = (interaction.data && interaction.data.custom_id) || '';
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
