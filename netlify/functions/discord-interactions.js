/* Discord bot — HTTP Interactions endpoint (no persistent gateway).
   Discord POSTs every slash-command / autocomplete interaction here; we
   verify the Ed25519 signature, then answer synchronously within the 3 s
   window (all four commands are one or two blob reads / one internal fetch,
   comfortably under budget, so no deferred-response dance is needed).

   Set this function's URL as the application's "Interactions Endpoint URL"
   in the Discord developer portal:
     https://osu-collection-hanabi.netlify.app/discord
   (netlify.toml rewrites /discord -> here; the raw
   /.netlify/functions/discord-interactions path also works.)

   Env: DISCORD_PUBLIC_KEY (signature check). OSU_CLIENT_ID/SECRET (for /pp,
   via _osu-auth) and NETLIFY_BLOBS_* (for /collection, /gallery) are already
   set for the rest of the site. Command definitions live in
   scripts/register-discord-commands.mjs — run that once after deploy. */
const crypto = require('crypto');
const { getCollectionsStore } = require('./_blobs-store');
const { getOsuToken } = require('./_osu-auth');

const PINK = 0xff66aa;
const SITE_FOOTER = 'osu! 歌曲收藏';

// Discord interaction + response type numbers we use.
const T_PING = 1;
const T_COMMAND = 2;
const T_AUTOCOMPLETE = 4;
const R_PONG = 1;
const R_MESSAGE = 4;
const R_AUTOCOMPLETE = 8;
const EPHEMERAL = 64;

/* --- signature ------------------------------------------------------------ */

// Discord's public key is 32 raw bytes (hex). Node can't build a KeyObject
// from raw Ed25519 bytes directly, so wrap it in the fixed SPKI DER prefix.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifySignature(rawBody, signatureHex, timestamp, publicKeyHex) {
    if (!signatureHex || !timestamp || !publicKeyHex) return false;
    try {
        const key = crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
            format: 'der',
            type: 'spki',
        });
        return crypto.verify(
            null,
            Buffer.from(timestamp + rawBody),
            key,
            Buffer.from(signatureHex, 'hex'),
        );
    } catch {
        return false;
    }
}

/* --- small helpers ------------------------------------------------------- */

const json = (obj, statusCode = 200) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
});

const message = (embed, components) => json({
    type: R_MESSAGE,
    data: {
        embeds: [embed],
        components: components || [],
        allowed_mentions: { parse: [] },
    },
});

const ephemeral = (content) => json({
    type: R_MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

const optsOf = (interaction) => (interaction.data && interaction.data.options) || [];
const optVal = (options, name) => {
    const o = options.find(x => x.name === name);
    return o ? o.value : undefined;
};

function fmtLen(sec) {
    sec = Math.round(sec || 0);
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
}

// Join a list into a value that stays under Discord's 1024-char field cap.
function joinCapped(items, cap = 1024) {
    const out = [];
    let len = 0;
    for (let i = 0; i < items.length; i++) {
        const piece = (out.length ? ', ' : '') + items[i];
        if (len + piece.length > cap - 12) {
            out.push(`… (+${items.length - i})`);
            break;
        }
        out.push(items[i]);
        len += piece.length;
    }
    return out.join(', ');
}

function originOf(event) {
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host || 'osu-collection-hanabi.netlify.app';
    return `${proto}://${host}`;
}

/* --- commands ---------------------------------------------------------- */

async function cmdCollection(options, origin) {
    const query = String(optVal(options, 'query') || '').trim();
    if (!query) return ephemeral('請輸入發佈者名稱、收藏 ID 或分類關鍵字。');

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
    if (!entry) return ephemeral(`找不到符合「${query}」的已發佈收藏。試試 \`/gallery\` 瀏覽。`);

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
        color: PINK,
        image: { url: `${origin}/.netlify/functions/og-collection?id=${entry.id}` },
        fields: [],
        footer: { text: SITE_FOOTER },
        timestamp: entry.updatedAt || undefined,
    };
    if (modeBits.length) embed.fields.push({ name: '模式分佈', value: modeBits.join(' · ') });
    if (catNames.length) embed.fields.push({ name: `分類 (${catNames.length})`, value: joinCapped(catNames) });

    const components = [{
        type: 1,
        components: [
            { type: 2, style: 5, label: '開啟收藏', url: `${origin}/c/${entry.id}` },
            { type: 2, style: 5, label: '發佈者主頁', url: `https://osu.ppy.sh/users/${entry.id}` },
        ],
    }];
    return message(embed, components);
}

async function autocompleteCollection(options) {
    const focused = options.find(o => o.focused) || {};
    const q = String(focused.value || '').toLowerCase().trim();

    const store = getCollectionsStore();
    const index = (await store.get('index', { type: 'json' })) || [];

    let pool = index;
    if (q) {
        pool = index.filter(e =>
            (e.username || '').toLowerCase().includes(q) ||
            String(e.id).includes(q) ||
            (e.tags || []).some(t => t.toLowerCase().includes(q)));
    }
    pool = pool
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 25);

    return json({
        type: R_AUTOCOMPLETE,
        data: {
            choices: pool.map(e => ({
                name: `${e.username || ('#' + e.id)} · ${e.totalSets || 0} 圖組`.slice(0, 100),
                value: String(e.id),
            })),
        },
    });
}

async function cmdGallery(options, origin) {
    const page = Math.max(0, Math.min(50, (Number(optVal(options, 'page')) || 1) - 1));
    const res = await fetch(`${origin}/.netlify/functions/collections-list?page=${page}&sort=recent`);
    if (!res.ok) return ephemeral('讀取收藏廣場失敗，稍後再試。');
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return ephemeral('這一頁沒有收藏。');

    const lines = items.slice(0, 12).map((e, i) => {
        const bits = [`${e.totalSets || 0} 圖組`];
        if (e.maxRating) bits.push(`${Number(e.maxRating).toFixed(1)}★`);
        if (e.likeCount) bits.push(`♥${e.likeCount}`);
        const n = String(page * 20 + i + 1).padStart(2, ' ');
        return `\`${n}\` **${e.username || ('#' + e.id)}** — ${bits.join(' · ')} · [開啟](${origin}/c/${e.id})`;
    });

    return message({
        title: '收藏廣場 — 最新發佈',
        url: `${origin}/`,
        description: lines.join('\n'),
        color: PINK,
        footer: { text: `第 ${page + 1} 頁 · 共 ${data.total || items.length} 份 · ${SITE_FOOTER}` },
    });
}

async function cmdPp(options) {
    const name = String(optVal(options, 'username') || '').trim();
    const mode = optVal(options, 'mode') || 'osu';
    if (!name) return ephemeral('請提供 osu! 使用者名稱或 ID。');

    const token = await getOsuToken();
    const res = await fetch(
        `https://osu.ppy.sh/api/v2/users/${encodeURIComponent(name)}/${mode}?key=username`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return ephemeral(`找不到玩家「${name}」。`);
    if (!res.ok) return ephemeral('osu! API 查詢失敗，稍後再試。');

    const u = await res.json();
    const s = u.statistics || {};
    const modeLabel = { osu: 'osu!', taiko: 'osu!taiko', fruits: 'osu!catch', mania: 'osu!mania' }[mode] || mode;
    const num = (v) => (v != null ? Number(v).toLocaleString('en-US') : '—');

    const embed = {
        title: `${u.username} — ${modeLabel}`,
        url: `https://osu.ppy.sh/users/${u.id}/${mode}`,
        color: PINK,
        thumbnail: u.avatar_url ? { url: u.avatar_url } : undefined,
        fields: [
            { name: 'PP', value: s.pp != null ? `${Math.round(s.pp).toLocaleString('en-US')}pp` : '—', inline: true },
            { name: '全球排名', value: s.global_rank ? `#${num(s.global_rank)}` : '—', inline: true },
            { name: `${u.country_code || '國內'} 排名`, value: s.country_rank ? `#${num(s.country_rank)}` : '—', inline: true },
            { name: '準度', value: s.hit_accuracy != null ? `${s.hit_accuracy.toFixed(2)}%` : '—', inline: true },
            { name: '遊玩次數', value: num(s.play_count), inline: true },
            { name: '等級', value: s.level && s.level.current != null ? String(s.level.current) : '—', inline: true },
        ],
        footer: { text: `${SITE_FOOTER} · 資料來自 osu! API v2` },
    };
    return message(embed);
}

async function cmdFarm(options, origin) {
    const mode = optVal(options, 'mode') || 'osu';
    const ppMin = Number(optVal(options, 'pp_min'));

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
    if (!items.length) return ephemeral('農分圖資料庫目前沒有符合條件的圖。');

    const m = items[Math.floor(Math.random() * items.length)];
    const setId = m.beatmapset_id || m.beatmapsetId || null;
    const mapId = m.beatmap_id || m.beatmapId || m.id || null;

    const fields = [
        { name: 'PP', value: m.pp != null ? `~${Math.round(m.pp)}pp` : '—', inline: true },
        { name: '星數', value: m.star != null ? `${Number(m.star).toFixed(2)}★` : '—', inline: true },
        { name: 'BPM', value: m.bpm != null ? String(Math.round(m.bpm)) : '—', inline: true },
    ];
    if (m.total_length) fields.push({ name: '長度', value: fmtLen(m.total_length), inline: true });

    const name = `${m.artist || ''} - ${m.title || ''}`.trim() || `Beatmapset ${setId || ''}`.trim();
    return message({
        title: (name + (m.version ? ` [${m.version}]` : '')).slice(0, 250),
        url: mapId ? `https://osu.ppy.sh/b/${mapId}` : (setId ? `https://osu.ppy.sh/s/${setId}` : `${origin}/`),
        description: m.creator ? `mapper：${m.creator}` : undefined,
        color: PINK,
        image: setId ? { url: `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` } : undefined,
        fields,
        footer: { text: `${SITE_FOOTER} · Farm Maps` },
    });
}

/* --- handler ---------------------------------------------------------- */

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : (event.body || '');

    const h = event.headers || {};
    const ok = verifySignature(
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

    if (interaction.type === T_PING) return json({ type: R_PONG });

    const origin = originOf(event);
    const name = interaction.data && interaction.data.name;
    const options = optsOf(interaction);

    try {
        if (interaction.type === T_AUTOCOMPLETE) {
            if (name === 'collection') return await autocompleteCollection(options);
            return json({ type: R_AUTOCOMPLETE, data: { choices: [] } });
        }

        if (interaction.type === T_COMMAND) {
            switch (name) {
                case 'collection': return await cmdCollection(options, origin);
                case 'gallery': return await cmdGallery(options, origin);
                case 'pp': return await cmdPp(options);
                case 'farm': return await cmdFarm(options, origin);
                default: return ephemeral('未知指令。');
            }
        }

        return json({ type: R_PONG });
    } catch (err) {
        return ephemeral(`發生錯誤：${String(err && err.message || err).slice(0, 200)}`);
    }
};
