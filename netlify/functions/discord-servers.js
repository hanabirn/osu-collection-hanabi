/* 社群 → Discord 伺服器: osu! community servers that visitors submit and the
   site owner approves (js/discord-servers.js).

   GET  ?action=list                     the approved servers + our own (featured),
                                         names / icons / member counts from
                                         Discord's invite API, refreshed every 6 h
   GET  ?action=mine        (signed in)  the caller's submissions and their state
   GET  ?action=pending     (owner)      the review queue
   POST { action:'submit', invite, description, tags[], lang }   (signed in)
   POST { action:'review', id, approve, note }                   (owner)
   POST { action:'remove', id }          (owner, or the one who submitted it)

   A submission is checked against Discord's invite API (it must be a live,
   permanent-looking invite to a server), then waits for review; the owner
   gets a Discord DM. Data lives in the DM store (KV_DM) under servers:*. */
const crypto = require('crypto');
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');
const { getEnv } = require('./_cf-env');

const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const OWNER_OSU_ID = process.env.CHAT_OWNER_OSU_ID || '26696007';
const SITE = 'https://osu.hanabirn.xyz';
const FEATURED_INVITE = 'vVuGsm5YZF'; // osu! Collection's own server
const TAGS = ['osu', 'taiko', 'catch', 'mania', 'mapping', 'tournament', 'skins', 'chat', 'art', 'music', 'beginners', 'competitive'];
const LANGS = ['zh', 'zh-Hans', 'en', 'ja', 'ko', 'de', 'es', 'fr', 'ru', 'pt', 'id', 'th', 'vi', 'pl', 'other'];
const MAX_DESC = 500;
const MAX_PER_USER = 5;
const REFRESH_MS = 6 * 3600 * 1000;

const json = (statusCode, body) => ({ statusCode, headers: H, body: JSON.stringify(body) });
const inviteCode = (text) => {
    const s = String(text || '').trim();
    const m = /(?:discord(?:app)?\.(?:gg|com\/invite)\/)([A-Za-z0-9-]{2,32})\/?$/.exec(s) || /^([A-Za-z0-9-]{2,32})$/.exec(s);
    return m ? m[1] : null;
};

// Discord's public invite lookup: the server's name, icon, banner, member counts
async function lookupInvite(code) {
    const r = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.guild) return null;
    const g = d.guild;
    return {
        code, guildId: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'png'}?size=128` : null,
        // the server's banner, or else its invite background (splash): shown across the card's top
        banner: g.banner ? `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.${g.banner.startsWith('a_') ? 'gif' : 'webp'}?size=1024`
            : g.splash ? `https://cdn.discordapp.com/splashes/${g.id}/${g.splash}.webp?size=1024` : null,
        members: d.approximate_member_count || 0, online: d.approximate_presence_count || 0,
        expires: d.expires_at || null, checkedAt: Date.now(),
    };
}

async function notifyOwner(text) {
    const env = getEnv() || {};
    const token = env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
    const owner = env.DISCORD_OWNER_ID || process.env.DISCORD_OWNER_ID;
    if (!token || !owner) return;
    try {
        const ch = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: owner }),
        }).then((r) => (r.ok ? r.json() : null));
        if (!ch || !ch.id) return;
        await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`, {
            method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
        });
    } catch (err) { console.error('discord-servers: owner DM failed', err); }
}

const pub = (s) => ({
    id: s.id, code: s.code, name: s.name, icon: s.icon, banner: s.banner, members: s.members, online: s.online,
    description: s.description, tags: s.tags, lang: s.lang, status: s.status, note: s.note || '',
    submittedBy: s.submittedBy ? s.submittedBy.name : null, approvedAt: s.approvedAt || null, created: s.created,
});

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { ...H, 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
    const store = getDmStore();
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const user = auth.startsWith('Bearer ') ? verifyAuthToken(auth.slice(7)) : null;
    const isOwner = !!(user && String(user.id) === String(OWNER_OSU_ID));
    const all = async () => (await store.get('servers:all', { type: 'json' })) || [];
    const saveAll = (list) => store.setJSON('servers:all', list);

    try {
        if (event.httpMethod === 'GET') {
            const qs = event.queryStringParameters || {};
            if (qs.action === 'list' || !qs.action) {
                let list = await all();
                // stale names / counts: a few refreshed per request, so no request waits long
                let changed = false, budget = 4;
                for (const s of list) {
                    if (s.status !== 'approved' || budget <= 0 || Date.now() - (s.checkedAt || 0) < REFRESH_MS) continue;
                    budget--;
                    const fresh = await lookupInvite(s.code).catch(() => null);
                    if (fresh) Object.assign(s, { name: fresh.name, icon: fresh.icon, banner: fresh.banner, members: fresh.members, online: fresh.online, checkedAt: fresh.checkedAt, dead: false });
                    else Object.assign(s, { checkedAt: Date.now(), dead: true });
                    changed = true;
                }
                if (changed) await saveAll(list);
                let featured = await store.get('servers:featured', { type: 'json' });
                if (!featured || !('banner' in featured) || featured.v !== 2 || Date.now() - (featured.checkedAt || 0) > REFRESH_MS) {
                    const fresh = await lookupInvite(FEATURED_INVITE).catch(() => null);
                    if (fresh) { featured = { ...fresh, v: 2 }; await store.setJSON('servers:featured', featured); }
                }
                const approved = list.filter((s) => s.status === 'approved' && !s.dead)
                    .sort((a, b) => (b.online || 0) - (a.online || 0)).map(pub);
                return { statusCode: 200, headers: { ...H, 'Cache-Control': 'public, max-age=120' }, body: JSON.stringify({ featured, servers: approved, tags: TAGS }) };
            }
            // the submit form's "check": what the invite points to (browsers can't ask Discord directly)
            if (qs.action === 'preview') {
                const code = inviteCode(qs.invite);
                const info = code ? await lookupInvite(code).catch(() => null) : null;
                if (!info) return json(404, { error: 'That invite does not work (expired or invalid)' });
                return json(200, { server: info });
            }
            if (qs.action === 'mine') {
                if (!user) return json(401, { error: 'Sign in first' });
                return json(200, { servers: (await all()).filter((s) => s.submittedBy && String(s.submittedBy.id) === String(user.id)).map(pub) });
            }
            // who asked to join our server (owner): newest first
            if (qs.action === 'joins') {
                if (!isOwner) return json(403, { error: 'Owner only' });
                return json(200, { joins: ((await store.get('servers:joins', { type: 'json' })) || []).slice(0, 100) });
            }
            // the join form's osu! lookup: name and country to fill in
            if (qs.action === 'osu') {
                const ref = String(qs.u || '').trim().slice(0, 40);
                if (!ref) return json(400, { error: 'osu' });
                try {
                    const { getOsuToken } = require('./_osu-auth');
                    const token = await getOsuToken();
                    const r = await fetch(`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(ref)}?key=${/^\d+$/.test(ref) ? 'id' : 'username'}`, { headers: { Authorization: `Bearer ${token}` } });
                    if (!r.ok) return json(404, { error: 'osu' });
                    const u = await r.json();
                    return json(200, { id: u.id, username: u.username, country: u.country_code || '', avatar: u.avatar_url || null });
                } catch { return json(502, { error: 'osu' }); }
            }
            if (qs.action === 'pending') {
                if (!isOwner) return json(403, { error: 'Owner only' });
                return json(200, { servers: (await all()).filter((s) => s.status === 'pending').map((s) => ({ ...pub(s), submittedById: s.submittedBy && s.submittedBy.id })) });
            }
            return json(400, { error: 'Unknown action' });
        }

        if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
        let body;
        try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

        /* Joining our own server: who they are on Discord and osu!, and where
           from, so the owner can give the right roles; then the invite. */
        if (body.action === 'join') {
            const discord = typeof body.discord === 'string' ? body.discord.trim().replace(/^@/, '') : '';
            if (!/^[A-Za-z0-9_.]{2,32}$/.test(discord) && !/^.{2,32}#\d{4}$/.test(discord)) return json(422, { error: 'discord' });
            const osuIn = typeof body.osu === 'string' ? body.osu.trim() : '';
            const osuRef = (/osu\.ppy\.sh\/(?:users|u)\/([^/?#\s]+)/.exec(osuIn) || [, osuIn])[1];
            if (!osuRef || osuRef.length > 40) return json(422, { error: 'osu' });
            let osuUser = null;
            try {
                const { getOsuToken } = require('./_osu-auth');
                const token = await getOsuToken();
                const key = /^\d+$/.test(osuRef) ? 'id' : 'username';
                const r = await fetch(`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(osuRef)}?key=${key}`, { headers: { Authorization: `Bearer ${token}` } });
                if (r.ok) osuUser = await r.json();
            } catch { osuUser = null; }
            if (!osuUser || !osuUser.id) return json(422, { error: 'osu' });
            const country = /^[A-Z]{2}$/.test(String(body.country || '').toUpperCase()) ? String(body.country).toUpperCase() : (osuUser.country_code || '');
            const ip = event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'] || '';
            const rateKey = `servers:joinrate:${crypto.createHash('sha256').update(`${ip}|${Math.floor(Date.now() / 3600000)}`).digest('hex').slice(0, 24)}`;
            const n = Number(await store.get(rateKey, { type: 'text' })) || 0;
            if (n >= 5) return json(429, { error: 'Too many requests this hour' });
            await store.set(rateKey, String(n + 1));
            const entry = { at: Date.now(), discord, osuId: osuUser.id, osuName: osuUser.username, country, osuCountry: osuUser.country_code || '', signedIn: user ? user.username : null };
            const joins = (await store.get('servers:joins', { type: 'json' })) || [];
            joins.unshift(entry);
            await store.setJSON('servers:joins', joins.slice(0, 300));
            const flag = (c) => (/^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '');
            await notifyOwner(`🙋 有人要加入伺服器\nDiscord：${discord}\nosu!：${osuUser.username}（https://osu.ppy.sh/users/${osuUser.id}）\n國家／地區：${flag(country)} ${country}${country !== entry.osuCountry && entry.osuCountry ? `（osu! 上是 ${entry.osuCountry}）` : ''}`);
            return json(200, { invite: `https://discord.gg/${FEATURED_INVITE}`, osuName: osuUser.username, country });
        }

        if (body.action === 'submit') {
            if (!user) return json(401, { error: 'Sign in first' });
            const code = inviteCode(body.invite);
            if (!code) return json(422, { error: 'Not a Discord invite link' });
            const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESC) : '';
            if (description.length < 10) return json(422, { error: 'Describe the server in a sentence or two' });
            const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).filter((x) => TAGS.includes(x)))].slice(0, 5);
            const lang = LANGS.includes(body.lang) ? body.lang : 'other';
            const info = await lookupInvite(code);
            if (!info) return json(422, { error: 'That invite does not work (expired or invalid)' });
            if (info.expires) return json(422, { error: 'Use an invite that never expires' });
            const list = await all();
            if (list.some((s) => s.guildId === info.guildId && s.status !== 'rejected')) return json(409, { error: 'This server is already listed or waiting for review' });
            if (list.filter((s) => s.submittedBy && String(s.submittedBy.id) === String(user.id) && s.status !== 'rejected').length >= MAX_PER_USER) return json(429, { error: 'Too many submissions' });
            const entry = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), ...info, description, tags, lang, status: 'pending', created: Date.now(), submittedBy: { id: String(user.id), name: user.username } };
            list.push(entry);
            await saveAll(list);
            await notifyOwner(`🗂 新的伺服器申請：${info.name}（${info.members} 人）\n提交者：${user.username}\n${description}\n\nhttps://discord.gg/${code}\n${SITE}/?servers=review`);
            return json(200, { server: pub(entry) });
        }

        if (body.action === 'review') {
            if (!isOwner) return json(403, { error: 'Owner only' });
            const list = await all();
            const s = list.find((x) => x.id === body.id);
            if (!s) return json(404, { error: 'No such server' });
            s.status = body.approve ? 'approved' : 'rejected';
            s.note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
            if (body.approve) s.approvedAt = Date.now();
            await saveAll(list);
            return json(200, { server: pub(s) });
        }

        if (body.action === 'remove') {
            const list = await all();
            const s = list.find((x) => x.id === body.id);
            if (!s) return json(404, { error: 'No such server' });
            const mine = user && s.submittedBy && String(s.submittedBy.id) === String(user.id);
            if (!isOwner && !mine) return json(403, { error: 'Not yours' });
            await saveAll(list.filter((x) => x.id !== body.id));
            return json(200, { ok: true });
        }
        return json(400, { error: 'Unknown action' });
    } catch (err) {
        console.error('discord-servers failed', err);
        return json(500, { error: 'Something went wrong' });
    }
};
