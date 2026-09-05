/* ===== Public chat room =====
   Cursor-based polling (GET /chat-list?after=<lastSeenId> every 4s) — same
   mechanism osu-taiwan-hub.com/chat uses (confirmed by inspecting its own
   network requests), just without copying its actual feature: pasting an
   osu! beatmap/beatmapset link here renders a card with a one-click "加入
   收藏" button wired to this site's own addOsuBeatmap() (js/osu.js), instead
   of a generic score-preview card. Posting requires the same osu! OAuth
   login every other write action on this site already uses (getOsuAuthToken
   in js/osu.js); reading the room needs no login. */
const CHAT_POLL_INTERVAL_MS = 4000;
const CHAT_NEAR_BOTTOM_PX = 60;
// Only used to decide whether to *offer* the delete button client-side —
// the real permission check lives server-side in chat-delete.js.
const CHAT_OWNER_OSU_ID_HINT = '26696007';

let chatLoaded = false;
let chatLastId = 0;
let chatPollTimer = null;
let chatReplyTarget = null; // { id, username, snippet }

function ensureChatLoaded() {
    if (!chatLoaded) {
        chatLoaded = true;
        loadInitialChatMessages();
    }
    startChatPolling();
}

function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(pollChatMessages, CHAT_POLL_INTERVAL_MS);
}
function stopChatPolling() {
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}
// Don't keep polling a backgrounded browser tab — same idea js/pwa.js
// already uses for its own SW update check. Only relevant while the chat
// tab is the one currently showing; switchTab() itself already stops
// polling when the visitor navigates to a different site tab.
document.addEventListener('visibilitychange', () => {
    const chatPage = document.getElementById('page-chat');
    if (!chatPage || chatPage.style.display === 'none') return;
    if (document.visibilityState === 'hidden') stopChatPolling();
    else startChatPolling();
});

function chatIsNearBottom(listEl) {
    return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < CHAT_NEAR_BOTTOM_PX;
}

async function loadInitialChatMessages() {
    const listEl = document.getElementById('chat-messages-list');
    if (!listEl) return;
    try {
        const res = await fetch('/.netlify/functions/chat-list');
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const messages = data.messages || [];
        listEl.innerHTML = messages.length
            ? messages.map(chatMessageHtml).join('')
            : `<p class="osu-empty">${t('chat_empty')}</p>`;
        if (messages.length) chatLastId = messages[messages.length - 1].id;
        listEl.scrollTop = listEl.scrollHeight;
    } catch (e) {
        console.error('Chat load failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('chat_load_fail')}</p>`;
    }
}

/* Appends only messages not already in the DOM. Needed because a poll in
   flight when sendChatMessage() optimistically appends its own just-sent
   message (or two overlapping polls) can otherwise race and render the same
   message twice — id doubles as both the poll cursor and a dedupe key. */
function chatAppendMessages(listEl, messages) {
    const fresh = messages.filter(m => !document.getElementById(`chat-msg-${m.id}`));
    if (!fresh.length) return;
    const wasNearBottom = chatIsNearBottom(listEl);
    const empty = listEl.querySelector('.osu-empty');
    if (empty) listEl.innerHTML = '';
    listEl.insertAdjacentHTML('beforeend', fresh.map(chatMessageHtml).join(''));
    chatLastId = Math.max(chatLastId, fresh[fresh.length - 1].id);
    if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
}

async function pollChatMessages() {
    const listEl = document.getElementById('chat-messages-list');
    if (!listEl) return;
    try {
        const res = await fetch(`/.netlify/functions/chat-list?after=${chatLastId}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const messages = data.messages || [];
        if (!messages.length) return;
        chatAppendMessages(listEl, messages);
    } catch (e) {
        console.error('Chat poll failed:', e);
    }
}

/* encodeURIComponent leaves ' unescaped (it's in the RFC3986 "unreserved"
   set), so embedding it directly inside a single-quoted onclick="" JS string
   literal breaks that string open the moment the content itself contains an
   apostrophe — which free-text chat messages constantly do ("it's", "don't").
   The extra %27 pass closes that gap; decodeURIComponent still unwraps it
   correctly since %27 is just ' own percent-encoding. */
function chatEncodeForOnclick(str) {
    return encodeURIComponent(str).replace(/'/g, '%27');
}

function chatFormatTime(iso) {
    try {
        return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

function chatMessageHtml(m) {
    const loggedInUser = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    const canDelete = loggedInUser && (String(loggedInUser.id) === String(m.authorId) || String(loggedInUser.id) === CHAT_OWNER_OSU_ID_HINT);
    const replyHtml = m.replyToId && m.replyAuthorUsername ? `
        <div class="chat-reply-quote">${icon('cornerUpLeft', { extraClass: 'icon-label-gap' })}<b>${escapeHtmlOsu(m.replyAuthorUsername)}</b>：${escapeHtmlOsu(m.replyContent || '')}</div>` : '';
    const cardHtml = m.beatmapPreview ? chatBeatmapCardHtml(m.beatmapPreview) : '';
    return `
    <div class="chat-message" id="chat-msg-${m.id}">
        <div class="avatar-with-flag">
            <img class="tracked-player-avatar" src="${osuAvatarUrl(m.authorId)}" alt="" onerror="this.style.visibility='hidden';">
        </div>
        <div class="chat-message-body">
            <div class="chat-message-header">
                <span class="chat-message-name">${escapeHtmlOsu(m.authorUsername)}</span>
                <span class="chat-message-time">${chatFormatTime(m.createdAt)}</span>
                <button class="chat-reply-btn" onclick="setChatReplyTarget(${m.id}, decodeURIComponent('${chatEncodeForOnclick(m.authorUsername)}'), decodeURIComponent('${chatEncodeForOnclick(m.content)}'))" title="${t('chat_reply_btn_title')}">${icon('cornerUpLeft')}</button>
                ${canDelete ? `<button class="chat-delete-btn" onclick="deleteChatMessage(${m.id})" title="${t('chat_delete_btn_title')}">${icon('x')}</button>` : ''}
            </div>
            ${replyHtml}
            <div class="chat-message-content">${escapeHtmlOsu(m.content)}</div>
            ${cardHtml}
        </div>
    </div>`;
}

function chatBeatmapCardHtml(p) {
    const coverUrl = `https://assets.ppy.sh/beatmaps/${p.beatmapsetId}/covers/card.jpg`;
    const col = typeof getOsuCollection === 'function' ? getOsuCollection() : {};
    const inCollection = OSU_MODES.some(m => (col[m] || []).some(s => s.beatmapset_id === p.beatmapsetId));
    const modesHtml = (p.modes || []).map(mNum => modeIconSvg(OSU_MODE_NAMES[mNum])).join('');
    const starRange = p.starMin === p.starMax ? p.starMax.toFixed(2) : `${p.starMin.toFixed(2)}~${p.starMax.toFixed(2)}`;
    return `
    <div class="chat-beatmap-card">
        <div class="chat-beatmap-card-bg" style="background-image:url('${coverUrl}')"></div>
        <div class="chat-beatmap-card-overlay"></div>
        <div class="chat-beatmap-card-info">
            <div class="chat-beatmap-card-title">${escapeHtmlOsu(p.title || '')}</div>
            <div class="chat-beatmap-card-meta">${escapeHtmlOsu(p.artist || '')} · mapped by ${escapeHtmlOsu(p.creator || '')}</div>
            <div class="chat-beatmap-card-stats">${modesHtml}<span>${starRange}⭐</span></div>
        </div>
        <button class="chat-beatmap-card-add-btn${inCollection ? ' in-collection' : ''}" ${inCollection ? 'disabled' : `onclick="addOsuBeatmap(${p.beatmapsetId})"`}>
            ${icon(inCollection ? 'check' : 'plus', { extraClass: 'icon-label-gap' })}${t(inCollection ? 'farm_in_collection' : 'chat_add_to_collection_btn')}
        </button>
    </div>`;
}

function setChatReplyTarget(id, username, content) {
    chatReplyTarget = { id, username, snippet: content.length > 60 ? content.slice(0, 60) + '…' : content };
    const banner = document.getElementById('chat-reply-banner');
    const text = document.getElementById('chat-reply-banner-text');
    if (text) text.textContent = t('chat_replying_to', { name: username, content: chatReplyTarget.snippet });
    if (banner) banner.style.display = 'flex';
    document.getElementById('chat-input')?.focus();
}
function clearChatReplyTarget() {
    chatReplyTarget = null;
    const banner = document.getElementById('chat-reply-banner');
    if (banner) banner.style.display = 'none';
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return; }

    input.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/chat-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ content, replyToId: chatReplyTarget ? chatReplyTarget.id : null }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); return; }
        if (res.status === 429) { showShareToast(t('chat_rate_limited')); return; }
        if (!res.ok) throw new Error('send failed');
        const data = await res.json();

        const listEl = document.getElementById('chat-messages-list');
        if (listEl) {
            // A poll already in flight when this resolves can render the same
            // message first — chatAppendMessages() no-ops in that case rather
            // than duplicating it.
            chatAppendMessages(listEl, [data.message]);
            // Always jump to the bottom for your own just-sent message,
            // regardless of prior scroll position — unlike a poll picking up
            // someone else's message, you unambiguously want to see this one.
            listEl.scrollTop = listEl.scrollHeight;
        }
        input.value = '';
        clearChatReplyTarget();
    } catch (e) {
        console.error('Send chat message failed:', e);
        showShareToast(t('chat_send_fail'));
    } finally {
        input.disabled = false;
        input.focus();
    }
}

async function deleteChatMessage(id) {
    const token = getOsuAuthToken();
    if (!token) return;
    if (!confirm(t('chat_delete_confirm'))) return;
    try {
        const res = await fetch('/.netlify/functions/chat-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ messageId: id }),
        });
        if (!res.ok) throw new Error('delete failed');
        document.getElementById(`chat-msg-${id}`)?.remove();
    } catch (e) {
        console.error('Delete chat message failed:', e);
        showShareToast(t('chat_delete_fail'));
    }
}

/* Login-gated input row, same show/hide convention as osu-check-played-btn
   etc. in applyLoggedInOsuUser() (js/osu.js), which calls this whenever
   login state changes. */
function updateChatLoginUI() {
    const loggedIn = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    const inputRow = document.getElementById('chat-input-row');
    const loginPrompt = document.getElementById('chat-login-required');
    if (inputRow) inputRow.style.display = loggedIn ? 'flex' : 'none';
    if (loginPrompt) loginPrompt.style.display = loggedIn ? 'none' : 'flex';
}
