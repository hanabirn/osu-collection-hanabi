/* Shared helpers for the Discord bot — signature check, response envelopes,
   presentational bits (SR-gradient colour, country-flag emoji, formatters)
   and osu! API v2 user resolution. Used by discord-interactions.js; the
   presentational helpers are also reused by collections-publish.js's
   "new collection" announcement. */
const crypto = require('crypto');

const PINK = 0xff66aa;
const SITE_ORIGIN = 'https://osu-collection-hanabi.netlify.app';
const SITE_FOOTER = 'osu! 歌曲收藏';
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

/* --- signature --------------------------------------------------------- */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function verifySignature(rawBody, signatureHex, timestamp, publicKeyHex) {
    if (!signatureHex || !timestamp || !publicKeyHex) return false;
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

const message = (embed, components) => json({
    type: R.MESSAGE,
    data: { embeds: [].concat(embed), components: components || [], allowed_mentions: { parse: [] } },
});

const updateMessage = (embed, components) => json({
    type: R.UPDATE_MESSAGE,
    data: { embeds: [].concat(embed), components: components || [], allowed_mentions: { parse: [] } },
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
    if (s < 60) return `${s} 秒前`;
    if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
    if (s < 2592000) return `${Math.floor(s / 86400)} 天前`;
    if (s < 31536000) return `${Math.floor(s / 2592000)} 個月前`;
    return `${Math.floor(s / 31536000)} 年前`;
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

const siteFooter = (extra) => ({
    text: extra ? `${SITE_FOOTER} · ${extra}` : SITE_FOOTER,
    icon_url: SITE_ICON,
});

function originOf(event) {
    const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host = (event.headers && event.headers.host) || 'osu-collection-hanabi.netlify.app';
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
    PINK, SITE_ORIGIN, SITE_FOOTER, SITE_ICON, T, R, EPHEMERAL, API_MODE, MODE_LABEL,
    verifySignature, json, message, updateMessage, ephemeral, autocomplete,
    optsOf, optVal, invokerId,
    fmtLen, fmtNum, ago, flagEmoji, srColor, rankColor,
    osuAuthor, siteFooter, originOf, resolveOsuUser,
};
