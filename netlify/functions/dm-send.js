/* Sends a direct message — see dm-messages.js for the read side and
   dm-conversations.js for the inbox list this updates. Identity (fromId/
   fromUsername) always comes from the verified osu! login token
   (_auth-token.js), same as chat-send.js; `toId` is the only thing the
   client provides, resolved fresh here (never trusted for username/country)
   so both sides' inbox entries stay accurate even if the recipient renamed
   since the conversation started. */
const { getDmStore } = require('./_blobs-store');
const { verifyAuthToken } = require('./_auth-token');

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MAX_CONTENT_LENGTH = 300;
const MAX_MESSAGES = 500;
const POST_COOLDOWN_MS = 3000;

function convKey(idA, idB) {
    const [lo, hi] = [String(idA), String(idB)].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    return `conv:${lo}:${hi}`;
}

// Best-effort, same shape as chat-send.js's resolveAuthorCountry — a failed
// lookup just means the inbox entry keeps whatever name/flag it already had
// (or shows the bare id for a first-ever message to someone whose lookup
// happened to fail), never blocks the send.
async function resolveUser(userId) {
    try {
        const params = new URLSearchParams({ k: process.env.OSU_API_KEY, u: userId, type: 'id' });
        const res = await fetch(`https://osu.ppy.sh/api/get_user?${params.toString()}`);
        const users = await res.json();
        return Array.isArray(users) && users[0] ? { username: users[0].username, country: users[0].country || null } : null;
    } catch {
        return null;
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = verifyAuthToken(token);
    if (!user) {
        return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid or expired login, please log in again' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const toId = Number.isInteger(body.toId) ? String(body.toId) : (typeof body.toId === 'string' && /^\d+$/.test(body.toId) ? body.toId : null);
    if (!toId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or invalid toId' }) };
    }
    if (toId === user.id) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Can't message yourself" }) };
    }
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message is empty' }) };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        return { statusCode: 422, headers: CORS_HEADERS, body: JSON.stringify({ error: `Message exceeds ${MAX_CONTENT_LENGTH} characters` }) };
    }

    try {
        const store = getDmStore();

        const lastPostAt = await store.get(`lastPostAt:${user.id}`, { type: 'text' });
        if (lastPostAt && Date.now() - parseInt(lastPostAt, 10) < POST_COOLDOWN_MS) {
            return { statusCode: 429, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Sending too fast, please slow down' }) };
        }

        const key = convKey(user.id, toId);
        const messages = (await store.get(key, { type: 'json' })) || [];
        const message = {
            id: (messages.length ? messages[messages.length - 1].id : 0) + 1,
            fromId: user.id,
            fromUsername: user.username,
            content,
            createdAt: new Date().toISOString(),
        };
        messages.push(message);
        await store.setJSON(key, messages.slice(-MAX_MESSAGES));
        await store.set(`lastPostAt:${user.id}`, String(Date.now()));

        const [recipientInfo, senderInfo] = await Promise.all([resolveUser(toId), resolveUser(user.id)]);
        const now = message.createdAt;

        // Sender's own inbox entry — unreadCount untouched, you reading your
        // own outgoing message was never "unread" for you.
        const senderIndex = (await store.get(`index:${user.id}`, { type: 'json' })) || [];
        const senderEntryIdx = senderIndex.findIndex(c => c.partnerId === toId);
        const senderEntry = {
            partnerId: toId,
            partnerUsername: (recipientInfo && recipientInfo.username) || (senderEntryIdx >= 0 ? senderIndex[senderEntryIdx].partnerUsername : toId),
            partnerCountry: (recipientInfo && recipientInfo.country) || (senderEntryIdx >= 0 ? senderIndex[senderEntryIdx].partnerCountry : null),
            lastMessage: content,
            lastMessageAt: now,
            lastSenderId: user.id,
            unreadCount: senderEntryIdx >= 0 ? senderIndex[senderEntryIdx].unreadCount : 0,
        };
        if (senderEntryIdx >= 0) senderIndex[senderEntryIdx] = senderEntry; else senderIndex.push(senderEntry);
        await store.setJSON(`index:${user.id}`, senderIndex);

        // Recipient's inbox entry — unreadCount increments.
        const recipientIndex = (await store.get(`index:${toId}`, { type: 'json' })) || [];
        const recipientEntryIdx = recipientIndex.findIndex(c => c.partnerId === user.id);
        const recipientEntry = {
            partnerId: user.id,
            partnerUsername: user.username,
            partnerCountry: (senderInfo && senderInfo.country) || (recipientEntryIdx >= 0 ? recipientIndex[recipientEntryIdx].partnerCountry : null),
            lastMessage: content,
            lastMessageAt: now,
            lastSenderId: user.id,
            unreadCount: (recipientEntryIdx >= 0 ? recipientIndex[recipientEntryIdx].unreadCount : 0) + 1,
        };
        if (recipientEntryIdx >= 0) recipientIndex[recipientEntryIdx] = recipientEntry; else recipientIndex.push(recipientEntry);
        await store.setJSON(`index:${toId}`, recipientIndex);

        return { statusCode: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' }, body: JSON.stringify({ message }) };
    } catch (err) {
        return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
};
