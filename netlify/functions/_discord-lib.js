/* Shared helpers for the Discord bot — signature check, response envelopes,
   presentational bits (SR-gradient colour, country-flag emoji, formatters)
   and osu! API v2 user resolution. Used by discord-interactions.js; the
   presentational helpers are also reused by collections-publish.js's
   "new collection" announcement. */
const crypto = require('crypto');
const { t } = require('./_discord-i18n');

const PINK = 0xff66aa;
const SITE_ORIGIN = 'https://osu.hanabirn.xyz';
const SITE_ICON = `${SITE_ORIGIN}/assets/icons/icon-192.png`;

// Interaction / response type numbers.
const T = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4 };
const R = {
    PONG: 1,
    MESSAGE: 4,
    DEFERRED_MESSAGE: 5,
    DEFERRED_UPDATE: 6,
    UPDATE_MESSAGE: 7,
    AUTOCOMPLETE: 8,
};
const EPHEMERAL = 64;

// osu! ruleset name maps. Slash-command option values use the API spelling
// (osu/taiko/fruits/mania); a few places still speak the site spelling
// (osu/taiko/catch/mania), so normalise both ways.
const API_MODE = { osu: 'osu', taiko: 'taiko', fruits: 'fruits', catch: 'fruits', mania: 'mania' };
const MODE_LABEL = { osu: 'osu!', taiko: 'osu!taiko', fruits: 'osu!catch', mania: 'osu!mania' };

// Application emojis (uploaded by scripts/upload-discord-emojis.mjs from
// assets/discord-emoji/): the score card's own grade letters. Usable by this
// app in any server. Keyed by the osu! API `rank` value; falls back to bold
// text if an id is missing.
const GRADE_EMOJI = {
    X: '<:g_ss:1571451498850680832>', SS: '<:g_ss:1571451498850680832>',
    XH: '<:g_ssh:1571451501866389574>', SSH: '<:g_ssh:1571451501866389574>',
    S: '<:g_s:1571451504727036024>', SH: '<:g_sh:1571451507566706698>',
    A: '<:g_a:1571451510141878282>', B: '<:g_b:1571451513073573959>', C: '<:g_c:1571451515716243556>', D: '<:g_d:1571451529465036810>', F: '',
};
const gradeTag = (rank) => GRADE_EMOJI[rank] || `**${rank || '?'}**`;

const MODE_EMOJI = {
    osu: '<:mode_osu:1546378621315452978>',
    taiko: '<:mode_taiko:1546378629938942052>',
    fruits: '<:mode_catch:1546378637916373045>',
    mania: '<:mode_mania:1546378646498054169>',
};
const modeTag = (apiMode) => MODE_EMOJI[apiMode] || '';

// osu!lazer mod glyphs (ppy/osu-resources, CC BY-NC 4.0) on a hexagon in the
// mod type's colour, as the score card draws them (assets/discord-emoji/).
const MOD_EMOJI = {
    NM: '<:m_nm:1571451550067593248>', NF: '<:m_nf:1571451552684576788>',
    EZ: '<:m_ez:1571451555322789958>', HT: '<:m_ht:1571451557545902103>',
    DC: '<:m_dc:1571451560553357362>', HD: '<:m_hd:1571451563140980736>',
    HR: '<:m_hr:1571451565728989364>', SD: '<:m_sd:1571451571005558854>',
    PF: '<:m_pf:1571451573542850640>', DT: '<:m_dt:1571451576013557902>',
    NC: '<:m_nc:1571451578655707237>', FL: '<:m_fl:1571451581335871558>',
    BL: '<:m_bl:1571451583625961533>', FI: '<:m_fi:1571451586511638548>',
    SO: '<:m_so:1571451589322084482>', RX: '<:m_rx:1571451592417484940>',
    AP: '<:m_ap:1571451595281928353>', MR: '<:m_mr:1571451597446189088>',
    RD: '<:m_rd:1571451600600567878>', CL: '<:m_cl:1571451603129471020>',
    '4K': '<:m_4k:1571451606191575040>', '5K': '<:m_5k:1571451609056026646>',
    '6K': '<:m_6k:1571451611857821826>', '7K': '<:m_7k:1571451614227865602>',
    '8K': '<:m_8k:1571451617348423800>', '9K': '<:m_9k:1571451620015997068>',
};

// A World Cup mappool bracket label -> the matching mod hexagon emoji, like
// the badges the site's 世界盃圖池 tab shows. Handles both the full-word
// labels the crawler stores ("No Mod", "Hard Rock", "Free Mod"...) and bare
// acronyms ("NM1", "HD2"). FreeMod / TieBreaker have no mod icon, so they
// come back as a short text chip.
const BRACKET_MOD = {
    'no mod': 'NM', nomod: 'NM',
    hidden: 'HD',
    'hard rock': 'HR', hardrock: 'HR',
    'double time': 'DT', doubletime: 'DT',
    nightcore: 'NC', flashlight: 'FL', easy: 'EZ',
    'half time': 'HT', halftime: 'HT',
    'sudden death': 'SD', perfect: 'PF', mirror: 'MR', random: 'RD',
    'free mod': 'FM', freemod: 'FM',
    tiebreaker: 'TB', 'tie breaker': 'TB',
};
// -> the mod acronym ("NM", "HD", "FM", "TB", ...) or the raw label.
function bracketMod(label) {
    if (!label) return '';
    const norm = String(label).toLowerCase().replace(/\s*\d+$/, '').trim();
    return BRACKET_MOD[norm] || (/^[a-z]{2,4}$/.test(norm) ? norm.toUpperCase() : String(label));
}
function bracketBadge(label) {
    const mod = bracketMod(label);
    return MOD_EMOJI[mod] || (mod ? `\`${mod}\`` : '');
}

// A custom-emoji tag "<:name:12345>" -> its CDN PNG url, for use as an embed
// image / thumbnail / author icon (where emoji markup can't go, and where it
// renders far larger than an inline emoji).
function emojiImageUrl(tag, size = 96) {
    const m = /^<a?:\w+:(\d+)>$/.exec(String(tag || ''));
    return m ? `https://cdn.discordapp.com/emojis/${m[1]}.${tag[1] === 'a' ? 'gif' : 'png'}?size=${size}` : null;
}

// osu! score `mods` (array of strings or {acronym}) -> plain acronym array,
// "CL" (classic) dropped as noise.
function modsList(mods) {
    return (mods || [])
        .map(m => (typeof m === 'string' ? m : m && m.acronym))
        .filter(x => x && x !== 'CL')
        .map(x => String(x).toUpperCase());
}

// ... -> a run of mod emojis; unknown mods fall back to "+XX".
function modsTag(mods) {
    return modsList(mods).map(m => MOD_EMOJI[m] || `+${m}`).join('');
}

/* --- signature --------------------------------------------------------- */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/* Async: WebCrypto Ed25519 (Cloudflare Workers and Node 20+ both have it),
   with the old node:crypto path kept as a fallback. */
async function verifySignature(rawBody, signatureHex, timestamp, publicKeyHex) {
    if (!signatureHex || !timestamp || !publicKeyHex) return false;
    if (!/^[0-9a-f]{128}$/i.test(signatureHex) || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (subtle) {
        try {
            const bytes = hex => Uint8Array.from(hex.match(/../g), b => parseInt(b, 16));
            const key = await subtle.importKey('raw', bytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
            return await subtle.verify({ name: 'Ed25519' }, key, bytes(signatureHex), new TextEncoder().encode(timestamp + rawBody));
        } catch {
            // fall through to node:crypto
        }
    }
    try {
        const key = crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
            format: 'der',
            type: 'spki',
        });
        return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, 'hex'));
    } catch {
        return false;
    }
}

/* --- response envelopes ---------------------------------------------------- */

const json = (obj, statusCode = 200) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
});

// `embed` may be a single embed object or an array (Discord allows up to 10
// per message).
const message = (embed, components) => json({
    type: R.MESSAGE,
    data: { embeds: [].concat(embed).slice(0, 10), components: components || [], allowed_mentions: { parse: [] } },
});

const updateMessage = (embed, components) => json({
    type: R.UPDATE_MESSAGE,
    data: { embeds: [].concat(embed).slice(0, 10), components: components || [], allowed_mentions: { parse: [] } },
});

const ephemeral = (content) => json({
    type: R.MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

const autocomplete = (choices) => json({
    type: R.AUTOCOMPLETE,
    data: { choices: (choices || []).slice(0, 25) },
});

/* --- option access ------------------------------------------------------- */

const optsOf = (interaction) => (interaction.data && interaction.data.options) || [];
const optVal = (options, name) => {
    const o = (options || []).find(x => x.name === name);
    return o ? o.value : undefined;
};
// The Discord user who invoked the interaction (guild vs DM shape).
const invokerId = (interaction) =>
    (interaction.member && interaction.member.user && interaction.member.user.id) ||
    (interaction.user && interaction.user.id) || null;

/* --- formatters -------------------------------------------------------- */

function fmtLen(sec) {
    sec = Math.round(Number(sec) || 0);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const fmtNum = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US'));

function ago(iso) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return t('ago_s', { n: s });
    if (s < 3600) return t('ago_m', { n: Math.floor(s / 60) });
    if (s < 86400) return t('ago_h', { n: Math.floor(s / 3600) });
    if (s < 2592000) return t('ago_d', { n: Math.floor(s / 86400) });
    if (s < 31536000) return t('ago_mo', { n: Math.floor(s / 2592000) });
    return t('ago_y', { n: Math.floor(s / 31536000) });
}

// A block-character sparkline. `higherIsBetter=false` (the default) inverts
// the mapping so a series where smaller = better (e.g. global rank) still
// trends visually upward as it improves.
function sparkline(vals, higherIsBetter = false) {
    const nums = (vals || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (nums.length < 2) return '';
    const min = Math.min(...nums), max = Math.max(...nums);
    const blocks = '▁▂▃▄▅▆▇█';
    return nums.map(n => {
        let t = max === min ? 0.5 : (n - min) / (max - min);
        if (!higherIsBetter) t = 1 - t;
        return blocks[Math.round(t * (blocks.length - 1))];
    }).join('');
}

// A smooth line chart of a global-rank history, as a QuickChart image URL
// for an embed's `image`. Y is reversed so an improving (falling) rank rises
// on the chart; transparent background, pink line, minimal chrome — reads on
// both Discord themes. null if there isn't enough data.
function rankChartUrl(vals) {
    const nums = (vals || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (nums.length < 4) return null;
    const step = Math.ceil(nums.length / 45);
    const pts = nums.filter((_, i) => i % step === 0);
    const cfg = {
        type: 'line',
        data: { labels: pts.map((_, i) => i), datasets: [{
            label: 'rank', data: pts,
            borderColor: '#ff5aa0', backgroundColor: 'rgba(255,102,170,0.18)',
            // 'start' (not true/'origin') so the area fills *below* the line
            // toward the bottom edge — with the reversed y-axis, 'origin'
            // would fill upward.
            fill: 'start', pointRadius: 0, borderWidth: 3, tension: 0.4,
        }] },
        options: {
            plugins: { legend: { display: false } },
            layout: { padding: 8 },
            scales: {
                x: { display: false },
                y: {
                    reverse: true, position: 'right',
                    ticks: { color: '#9aa0a6', maxTicksLimit: 4, font: { size: 15 } },
                    grid: { color: 'rgba(154,160,166,0.15)' },
                    border: { display: false },
                },
            },
        },
    };
    return `https://quickchart.io/chart?bkg=transparent&v=4&w=520&h=170&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

// Two-letter ISO country code -> regional-indicator flag emoji.
function flagEmoji(code) {
    if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
    const cc = code.toUpperCase();
    return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
}

// osu!'s star-rating difficulty spectrum, as an embed side-stripe colour.
// Anchors roughly match the osu!web gradient; black cap above ~9★.
function srColor(stars) {
    const s = Number(stars);
    if (!Number.isFinite(s)) return PINK;
    const stops = [
        [0.1, 0x4290fb], [1.25, 0x4fc0ff], [2.0, 0x4fffd5], [2.5, 0x7cff4f],
        [3.3, 0xf6f05c], [4.2, 0xff8068], [4.9, 0xff4e6f], [5.8, 0xc645b8],
        [6.7, 0x6563de], [7.7, 0x18158e], [9.0, 0x000000],
    ];
    if (s <= stops[0][0]) return stops[0][1];
    if (s >= stops[stops.length - 1][0]) return 0x000000;
    for (let i = 0; i < stops.length - 1; i++) {
        const [s0, c0] = stops[i];
        const [s1, c1] = stops[i + 1];
        if (s < s0 || s > s1) continue;
        const t = (s - s0) / (s1 - s0);
        const lerp = (a, b) => Math.round(a + (b - a) * t);
        const r = lerp((c0 >> 16) & 255, (c1 >> 16) & 255);
        const g = lerp((c0 >> 8) & 255, (c1 >> 8) & 255);
        const b = lerp(c0 & 255, c1 & 255);
        return (r << 16) | (g << 8) | b;
    }
    return PINK;
}

// A rank-tier colour for /pp (fewer digits = brighter).
function rankColor(globalRank) {
    const r = Number(globalRank);
    if (!Number.isFinite(r) || r <= 0) return PINK;
    if (r <= 1000) return 0xffd24a;
    if (r <= 10000) return 0x4fc0ff;
    if (r <= 100000) return 0x7cff4f;
    return 0x9aa0a6;
}

/* --- embed building blocks ------------------------------------------------- */

// Standard author line: osu! avatar + username + country flag, links to the
// profile. `u` is an osu! API v2 user object.
function osuAuthor(u, mode) {
    if (!u) return undefined;
    const flag = flagEmoji(u.country_code || (u.country && u.country.code));
    return {
        name: `${u.username}${flag ? ' ' + flag : ''}`,
        url: `https://osu.ppy.sh/users/${u.id}${mode ? '/' + mode : ''}`,
        icon_url: u.avatar_url || undefined,
    };
}

const siteFooter = (extra) => {
    const base = t('site_footer');
    return { text: extra ? `${base} · ${extra}` : base, icon_url: SITE_ICON };
};

function originOf(event) {
    const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host = (event.headers && event.headers.host) || 'osu.hanabirn.xyz';
    return `${proto}://${host}`;
}

/* --- osu! API v2 ------------------------------------------------------- */

// Resolve a username-or-id to a full API v2 user object (for the given
// ruleset). Returns null on 404.
async function resolveOsuUser(token, nameOrId, apiMode) {
    const res = await fetch(
        `https://osu.ppy.sh/api/v2/users/${encodeURIComponent(String(nameOrId))}/${apiMode || ''}`.replace(/\/$/, '') + '?key=username',
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`osu! API ${res.status}`);
    return res.json();
}

module.exports = {
    PINK, SITE_ORIGIN, SITE_ICON, T, R, EPHEMERAL, API_MODE, MODE_LABEL,
    GRADE_EMOJI, gradeTag, MODE_EMOJI, modeTag, MOD_EMOJI, modsTag, modsList,
    bracketMod, bracketBadge, emojiImageUrl,
    verifySignature, json, message, updateMessage, ephemeral, autocomplete,
    optsOf, optVal, invokerId,
    fmtLen, fmtNum, ago, flagEmoji, srColor, rankColor, sparkline, rankChartUrl,
    osuAuthor, siteFooter, originOf, resolveOsuUser,
};
