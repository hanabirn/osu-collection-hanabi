/* ===== Direct messages =====
   Same toolkit as js/chat.js (cursor-based polling, verifyAuthToken auth,
   Netlify Blobs) but 1:1 instead of one shared room: a list view of your
   conversations, and a thread view for whichever one you've opened. Every
   dm-*.js endpoint is scoped to the caller's own verified id by
   construction (see netlify/functions/dm-*.js file comments) — there's no
   query param that could address someone else's inbox or conversation. */
const DM_POLL_INTERVAL_MS = 4000;

let dmLoaded = false;
let dmView = 'list'; // 'list' | 'thread'
let dmPollTimer = null;
let dmCurrentPartner = null; // { id, username, country }
let dmLastId = 0;

function ensureDmLoaded() {
    if (!dmLoaded) {
        dmLoaded = true;
        loadDmConversations();
    }
    startDmPolling();
}

function startDmPolling() {
    stopDmPolling();
    dmPollTimer = setInterval(dmPollTick, DM_POLL_INTERVAL_MS);
}
function stopDmPolling() {
    if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null; }
}
function dmPollTick() {
    if (dmView === 'thread' && dmCurrentPartner) pollDmThread();
    else loadDmConversations();
}
// Same pause-when-backgrounded idea as js/chat.js.
document.addEventListener('visibilitychange', () => {
    const dmPage = document.getElementById('page-dm');
    if (!dmPage || dmPage.style.display === 'none') return;
    if (document.visibilityState === 'hidden') stopDmPolling();
    else startDmPolling();
});

function chatIsNearBottomEl(listEl) {
    return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
}

/* Shared with dmPollTick() (called every 4s while the list view is showing)
   as well as the actual first load — a transient failure on a background
   poll should never blow away a list that already rendered successfully,
   same distinction js/chat.js draws between its own initial load and
   pollChatMessages(). Only the very first failed attempt shows the error
   state; later ones just log and leave whatever's already on screen. */
let dmConversationsEverLoaded = false;

async function loadDmConversations() {
    const token = getOsuAuthToken();
    updateDmLoginUI();
    if (!token) { updateDmBadge(0); return; }

    const listEl = document.getElementById('dm-conversations-list');
    try {
        const res = await fetch('/.netlify/functions/dm-conversations', { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) { updateDmBadge(0); return; }
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        updateDmBadge(data.totalUnread || 0);
        dmConversationsEverLoaded = true;
        if (dmView !== 'list' || !listEl) return;
        renderDmConversationsList(data.conversations || []);
    } catch (e) {
        console.error('DM conversations load failed:', e);
        if (!dmConversationsEverLoaded && listEl && dmView === 'list') {
            listEl.innerHTML = `<p class="osu-empty">${t('chat_load_fail')}</p>`;
        }
    }
}

function dmRelativeSnippetTime(iso) {
    try {
        const d = new Date(iso);
        const sameDay = d.toDateString() === new Date().toDateString();
        return sameDay
            ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString();
    } catch { return ''; }
}

function renderDmConversationsList(conversations) {
    const listEl = document.getElementById('dm-conversations-list');
    if (!listEl) return;
    if (!conversations.length) {
        listEl.innerHTML = `<p class="osu-empty">${t('dm_empty')}</p>`;
        return;
    }
    listEl.innerHTML = conversations.map(c => `
        <div class="dm-conversation-row" onclick="openDmThread('${c.partnerId}', decodeURIComponent('${chatEncodeForOnclick(c.partnerUsername)}'), ${c.partnerCountry ? `'${c.partnerCountry}'` : 'null'})">
            <div class="avatar-with-flag">
                <img class="tracked-player-avatar" src="${osuAvatarUrl(c.partnerId)}" alt="" onerror="this.style.visibility='hidden';">
                ${c.partnerCountry ? `<img class="avatar-flag-badge" src="${flagUrl(c.partnerCountry)}" alt="" onerror="this.style.display='none';">` : ''}
            </div>
            <div class="dm-conversation-body">
                <div class="dm-conversation-header">
                    <span class="chat-message-name">${escapeHtmlOsu(c.partnerUsername)}</span>
                    <span class="chat-message-time">${dmRelativeSnippetTime(c.lastMessageAt)}</span>
                </div>
                <div class="dm-conversation-snippet">${escapeHtmlOsu(c.lastMessage)}</div>
            </div>
            ${c.unreadCount ? `<span class="dm-nav-badge dm-conversation-unread">${c.unreadCount > 9 ? '9+' : c.unreadCount}</span>` : ''}
        </div>`).join('');
}

function updateDmBadge(totalUnread) {
    const badge = document.getElementById('dm-nav-badge');
    if (!badge) return;
    badge.textContent = totalUnread > 9 ? '9+' : String(totalUnread);
    badge.style.display = totalUnread > 0 ? '' : 'none';
}

/* Same lookup-then-act shape as trackMapperFromInput (js/updates.js): the
   input takes a username, resolved via the same v1 get_user proxy
   (osuFetch) every other username lookup on this site already uses — no
   new backend needed just to turn "a username" into "an id". */
async function startDmConversationFromInput() {
    const input = document.getElementById('dm-new-username');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;

    const btn = input.nextElementSibling;
    if (btn) btn.disabled = true;
    try {
        const users = await osuFetch(`u=${encodeURIComponent(name)}&type=string`);
        const u = Array.isArray(users) ? users[0] : null;
        if (!u) { showShareToast(t('mapper_not_found')); return; }
        if (String(u.user_id) === String(getLoggedInOsuUser().id)) { showShareToast(t('dm_self_error')); return; }
        input.value = '';
        openDmThread(String(u.user_id), u.username, u.country || null);
    } catch (e) {
        console.error('DM user lookup failed:', e);
        showShareToast(t('mapper_not_found'));
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* ===== Thread view ===== */
async function openDmThread(partnerId, partnerUsername, partnerCountry) {
    dmView = 'thread';
    dmCurrentPartner = { id: String(partnerId), username: partnerUsername, country: partnerCountry };
    dmLastId = 0;

    document.getElementById('dm-list-view').style.display = 'none';
    const threadView = document.getElementById('dm-thread-view');
    threadView.style.display = 'block';

    const partnerEl = document.getElementById('dm-thread-partner');
    const profileUrl = `https://osu.ppy.sh/users/${dmCurrentPartner.id}`;
    partnerEl.innerHTML = `
        <a class="avatar-with-flag" href="${profileUrl}" target="_blank" rel="noopener noreferrer">
            <img class="tracked-player-avatar" src="${osuAvatarUrl(dmCurrentPartner.id)}" alt="" onerror="this.style.visibility='hidden';">
            ${dmCurrentPartner.country ? `<img class="avatar-flag-badge" src="${flagUrl(dmCurrentPartner.country)}" alt="" onerror="this.style.display='none';">` : ''}
        </a>
        <a class="chat-message-name" href="${profileUrl}" target="_blank" rel="noopener noreferrer">${escapeHtmlOsu(dmCurrentPartner.username)}</a>`;

    const messagesEl = document.getElementById('dm-thread-messages');
    messagesEl.innerHTML = `<p class="osu-empty">${t('gallery_loading')}</p>`;

    const token = getOsuAuthToken();
    try {
        const res = await fetch(`/.netlify/functions/dm-messages?with=${dmCurrentPartner.id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const messages = data.messages || [];
        messagesEl.innerHTML = messages.length
            ? messages.map(dmMessageHtml).join('')
            : `<p class="osu-empty">${t('dm_thread_empty')}</p>`;
        if (messages.length) dmLastId = messages[messages.length - 1].id;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (e) {
        console.error('DM thread load failed:', e);
        messagesEl.innerHTML = `<p class="osu-empty">${t('chat_load_fail')}</p>`;
    }

    fetch('/.netlify/functions/dm-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ withId: dmCurrentPartner.id }),
    }).catch(() => {});
    // Zero the badge for this conversation locally too, rather than waiting
    // for the next poll to pick up the server-side reset.
    loadDmConversations();
}

function closeDmThread() {
    dmView = 'list';
    dmCurrentPartner = null;
    document.getElementById('dm-thread-view').style.display = 'none';
    document.getElementById('dm-list-view').style.display = 'block';
    loadDmConversations();
}

function dmAppendMessages(listEl, messages) {
    const fresh = messages.filter(m => !document.getElementById(`dm-msg-${m.id}`));
    if (!fresh.length) return;
    const wasNearBottom = chatIsNearBottomEl(listEl);
    const empty = listEl.querySelector('.osu-empty');
    if (empty) listEl.innerHTML = '';
    listEl.insertAdjacentHTML('beforeend', fresh.map(dmMessageHtml).join(''));
    dmLastId = Math.max(dmLastId, fresh[fresh.length - 1].id);
    if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
}

async function pollDmThread() {
    if (!dmCurrentPartner) return;
    const listEl = document.getElementById('dm-thread-messages');
    if (!listEl) return;
    const token = getOsuAuthToken();
    if (!token) return;
    try {
        const res = await fetch(`/.netlify/functions/dm-messages?with=${dmCurrentPartner.id}&after=${dmLastId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        const messages = data.messages || [];
        if (!messages.length) return;
        dmAppendMessages(listEl, messages);
    } catch (e) {
        console.error('DM thread poll failed:', e);
    }
}

function dmMessageHtml(m) {
    const isMine = String(m.fromId) === String(getLoggedInOsuUser()?.id);
    return `
    <div class="chat-message dm-message${isMine ? ' dm-message-mine' : ''}" id="dm-msg-${m.id}">
        <div class="chat-message-body">
            <div class="chat-message-content">${escapeHtmlOsu(m.content)}</div>
            <span class="chat-message-time">${chatFormatTime(m.createdAt)}</span>
        </div>
    </div>`;
}

async function sendDmMessage() {
    const input = document.getElementById('dm-thread-input');
    if (!input || !dmCurrentPartner) return;
    const content = input.value.trim();
    if (!content) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('dm_login_required')); return; }

    input.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/dm-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ toId: dmCurrentPartner.id, content }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); return; }
        if (res.status === 429) { showShareToast(t('chat_rate_limited')); return; }
        if (!res.ok) throw new Error('send failed');
        const data = await res.json();

        const listEl = document.getElementById('dm-thread-messages');
        if (listEl) {
            dmAppendMessages(listEl, [data.message]);
            listEl.scrollTop = listEl.scrollHeight;
        }
        input.value = '';
    } catch (e) {
        console.error('Send DM failed:', e);
        showShareToast(t('chat_send_fail'));
    } finally {
        input.disabled = false;
        input.focus();
    }
}

/* Login-gated new-conversation row, same show/hide convention as
   updateChatLoginUI() (js/chat.js) — called from applyLoggedInOsuUser()
   (js/osu.js) whenever login state changes. */
function updateDmLoginUI() {
    const loggedIn = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    const newRow = document.getElementById('dm-new-row');
    const loginPrompt = document.getElementById('dm-login-required');
    if (newRow) newRow.style.display = loggedIn ? 'flex' : 'none';
    if (loginPrompt) loginPrompt.style.display = loggedIn ? 'none' : 'flex';
    if (!loggedIn) {
        const listEl = document.getElementById('dm-conversations-list');
        if (listEl) listEl.innerHTML = `<p class="osu-empty">${t('dm_login_required')}</p>`;
    }
}
