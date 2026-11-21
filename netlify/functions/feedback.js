/* 建議&改進: a visitor's suggestion becomes a thread the site owner answers.

   Visitors (no sign-in needed) keep a random key in their browser; the
   server stores only its SHA-256, so the key is the visitor's proof that a
   thread is theirs. Visitors signed in with osu! are also tied to their
   account, so their threads follow them to other devices.

   POST { action: 'create', message, lang, key }             a new suggestion
   POST { action: 'reply', id, message, key }                 the visitor writes back
   GET  ?action=mine&key=…                                    the visitor's threads
   GET  ?action=all                    (owner)                every thread, newest first
   POST { action: 'answer', id, message, status }  (owner)    reply, and set
        status: 'discussing' | 'done' (changed; the reply says to reload) | 'declined'

   The owner is the osu! account in CHAT_OWNER_OSU_ID (as for chat moderation)
   and hears of every new message by a Discord DM from the bot
   (DISCORD_OWNER_ID). Threads live in the DM store under feedback:… keys. */
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const H = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const OWNER_OSU_ID = process.env.CHAT_OWNER_OSU_ID || '26696007';
const MAX_LEN = 2000;
const MAX_INDEX = 1000;
const MAX_MESSAGES = 60;
const NEW_PER_HOUR = 5;          // new threads per visitor key / IP an hour
const SITE = 'https://osu.hanabirn.xyz';
const STATUSES = ['open', 'discussing', 'done', 'declined'];

// added to a 'done' reply, in the visitor's language
const RELOAD_NOTE = {
    zh: '（網站已更新，請重新整理網頁取得最新版本。）',
    'zh-Hans': '（网站已更新，请重新整理网页取得最新版本。）',
    en: '(The site has been updated: reload the page to get the latest version.)',
    ja: '（サイトを更新しました。ページを再読み込みして最新版にしてください。）',
    ko: '(사이트가 업데이트됐어요. 페이지를 새로고침해서 최신 버전을 받아 주세요.)',
    de: '(Die Seite wurde aktualisiert – lade sie neu, um die neueste Version zu bekommen.)',
    es: '(El sitio se actualizó: recarga la página para tener la última versión.)',
    fr: '(Le site a été mis à jour : recharge la page pour avoir la dernière version.)',
    ru: '(Сайт обновлён — перезагрузите страницу, чтобы получить последнюю версию.)',
};

const json = (statusCode, body) => ({ statusCode, headers: H, body: JSON.stringify(body) });

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function userFrom(event) {
    const h = event.headers.authorization || event.headers.Authorization || '';
    return h.startsWith('Bearer ') ? verifyAuthToken(h.slice(7)) : null;
}

// what the visitor's browser sees: the thread without its key
const publicThread = (t) => ({ id: t.id, created: t.created, updated: t.updated, status: t.status, messages: t.messages });

async function notifyOwner(text) {
    const token = process.env.DISCORD_BOT_TOKEN, owner = process.env.DISCORD_OWNER_ID;
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
    } catch (err) { console.error('feedback: owner DM failed', err); }
}

async function updateIndex(store, t) {
    const index = (await store.get('feedback:index', { type: 'json' })) || [];
    const last = t.messages[t.messages.length - 1];
    const row = { id: t.id, created: t.created, updated: t.updated, status: t.status, lastFrom: last.from, preview: t.messages[0].text.slice(0, 80), who: t.osuName || null };
    await store.setJSON('feedback:index', [row, ...index.filter((r) => r.id !== t.id)].slice(0, MAX_INDEX));
}

async function addToList(store, key, id) {
    const list = (await store.get(key, { type: 'json' })) || [];
    if (!list.includes(id)) await store.setJSON(key, [id, ...list].slice(0, 200));
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
    const store = getDmStore();
    const user = userFrom(event);
    const isOwner = !!(user && String(user.id) === OWNER_OSU_ID);

    try {
        if (event.httpMethod === 'GET') {
            const qs = event.queryStringParameters || {};
            if (qs.action === 'all') {
                if (!isOwner) return json(403, { error: 'Owner only' });
                const index = (await store.get('feedback:index', { type: 'json' })) || [];
                const threads = [];
                for (const row of index.slice(0, 100)) {
                    const t = await store.get(`feedback:thread:${row.id}`, { type: 'json' });
                    if (t) threads.push({ ...publicThread(t), lang: t.lang, who: t.osuName || null });
                }
                return json(200, { threads });
            }
            if (qs.action === 'mine') {
                const ids = new Set();
                if (/^[a-f0-9]{32}$/.test(qs.key || '')) for (const id of (await store.get(`feedback:mine:${await sha256(qs.key)}`, { type: 'json' })) || []) ids.add(id);
                if (user) for (const id of (await store.get(`feedback:user:${user.id}`, { type: 'json' })) || []) ids.add(id);
                const threads = [];
                for (const id of [...ids].slice(0, 50)) {
                    const t = await store.get(`feedback:thread:${id}`, { type: 'json' });
                    if (t) threads.push(publicThread(t));
                }
                threads.sort((a, b) => b.updated - a.updated);
                return json(200, { threads });
            }
            return json(400, { error: 'Unknown action' });
        }
        if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

        let body;
        try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const now = Date.now();

        if (body.action === 'create') {
            if (!message) return json(422, { error: 'Empty message' });
            if (message.length > MAX_LEN) return json(422, { error: `Over ${MAX_LEN} characters` });
            if (!/^[a-f0-9]{32}$/.test(body.key || '')) return json(400, { error: 'Missing key' });
            const keyHash = await sha256(body.key);
            const ip = event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'] || '';
            const rateKey = `feedback:rate:${await sha256(`${ip}|${Math.floor(now / 3600000)}`)}`;
            const count = Number(await store.get(rateKey, { type: 'text' })) || 0;
            if (count >= NEW_PER_HOUR) return json(429, { error: 'Too many suggestions this hour' });
            await store.set(rateKey, String(count + 1));
            const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            const t = {
                id, created: now, updated: now, status: 'open', lang: String(body.lang || 'zh').slice(0, 8), keyHash,
                osuId: user ? String(user.id) : null, osuName: user ? user.username : null,
                messages: [{ from: 'visitor', text: message, at: now }],
            };
            await store.setJSON(`feedback:thread:${id}`, t);
            await addToList(store, `feedback:mine:${keyHash}`, id);
            if (user) await addToList(store, `feedback:user:${user.id}`, id);
            await updateIndex(store, t);
            await notifyOwner(`💡 新的建議${t.osuName ? `（${t.osuName}）` : ''} · ${t.lang}\n${message}\n\n${SITE}/?feedback=admin#${id}`);
            return json(200, { thread: publicThread(t) });
        }

        const id = typeof body.id === 'string' && /^[a-f0-9]{16}$/.test(body.id) ? body.id : null;
        if (!id) return json(400, { error: 'Missing id' });
        const t = await store.get(`feedback:thread:${id}`, { type: 'json' });
        if (!t) return json(404, { error: 'No such thread' });

        if (body.action === 'reply') {
            const mine = (/^[a-f0-9]{32}$/.test(body.key || '') && (await sha256(body.key)) === t.keyHash) || (user && t.osuId === String(user.id));
            if (!mine) return json(403, { error: 'Not your thread' });
            if (!message) return json(422, { error: 'Empty message' });
            if (message.length > MAX_LEN) return json(422, { error: `Over ${MAX_LEN} characters` });
            if (t.messages.length >= MAX_MESSAGES) return json(422, { error: 'This thread is full' });
            t.messages.push({ from: 'visitor', text: message, at: now });
            t.updated = now;
            if (t.status !== 'discussing') t.status = 'discussing';
            await store.setJSON(`feedback:thread:${id}`, t);
            await updateIndex(store, t);
            await notifyOwner(`💬 建議有新回覆${t.osuName ? `（${t.osuName}）` : ''}\n${message}\n\n${SITE}/?feedback=admin#${id}`);
            return json(200, { thread: publicThread(t) });
        }

        if (body.action === 'answer') {
            if (!isOwner) return json(403, { error: 'Owner only' });
            const status = STATUSES.includes(body.status) ? body.status : 'discussing';
            if (!message && status === t.status) return json(422, { error: 'Nothing to send' });
            if (message.length > MAX_LEN) return json(422, { error: `Over ${MAX_LEN} characters` });
            let text = message;
            if (status === 'done') text = `${message}${message ? '\n' : ''}${RELOAD_NOTE[t.lang] || RELOAD_NOTE.en}`;
            if (text) t.messages.push({ from: 'owner', text, at: now, status });
            t.status = status;
            t.updated = now;
            await store.setJSON(`feedback:thread:${id}`, t);
            await updateIndex(store, t);
            return json(200, { thread: { ...publicThread(t), lang: t.lang, who: t.osuName || null } });
        }
        return json(400, { error: 'Unknown action' });
    } catch (err) {
        console.error('feedback failed', err);
        return json(500, { error: 'Something went wrong' });
    }
};
