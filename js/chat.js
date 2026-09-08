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
// Consecutive messages from the same author within this window render as one
// visual block (avatar + name shown once, tighter spacing).
const CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000;
// Only used to decide whether to *offer* the delete button client-side —
// the real permission check lives server-side in chat-delete.js.
const CHAT_OWNER_OSU_ID_HINT = '26696007';

let chatLoaded = false;
let chatLastId = 0;
let chatPollTimer = null;
let chatReplyTarget = null; // { id, username, snippet }
let chatEditingId = null;   // message id whose inline editor is currently open
let chatPendingMedia = null; // { dataUrl, base64, mime } staged for the next send

const CHAT_MEDIA_MAX_BYTES = 4 * 1024 * 1024;
const CHAT_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
let chatPasteBound = false;

/* ===== Emoji ===== curated Unicode set, grouped. No picker library: the
   ones on a CDN fetch their emoji-data JSON at runtime, which this site's
   CSP blocks — and a flat hand-list is tiny and dependency-free anyway.
   Emoji are just text, so nothing server-side changes; they store, render,
   translate and edit like any other characters. */
const CHAT_EMOJI_GROUPS = [
    ['😀', ['😀','😁','😂','🤣','😅','😊','😇','🙂','😉','😌','😍','🥰','😘','😙','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤨','😐','😑','😶','🙄','😏','😒','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','😱','😨','😰','😥','😓','🤥','😬','😳','🫠','🥲','🫣','🫡','🫥','🥱']],
    ['👍', ['👍','👎','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙏','✍️','💪','🦾','👏','🙌','👐','🤲','🫶','🤜','🤛','✊','👊','🫵','💅','🤳']],
    ['❤️', ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💯','💢','💥','💫','💦','💨','🕳️','💬','💭','💤']],
    ['🔥', ['🔥','⭐','🌟','✨','⚡','☀️','🌈','☁️','🌊','❄️','🎉','🎊','🎈','🎁','🏆','🥇','🥈','🥉','🎯','🎮','🕹️','🎵','🎶','🎧','🎤','💿','📀','🎼','🚀','💎','👑','🔔','🔕','💡','🧨','🎗️']],
    ['🐱', ['🐱','🐶','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐢','🐍','🐙','🦑','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈']],
    ['🍕', ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🧇','🥞','🧀','🍞','🥐','🥨','🥯','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍥','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🌰','🥜','🍯','🥛','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🍸','🍹']],
    ['⚽', ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚴','🚵']],
    ['🚩', ['🚩','🏁','🏳️','🏴','🏴‍☠️','🇹🇼','🇯🇵','🇰🇷','🇺🇸','🇬🇧','🇩🇪','🇫🇷','🇷🇺','🇪🇸','🇨🇳','🇭🇰','🇨🇦','🇦🇺','🇧🇷','🇮🇩','🇵🇭','🇹🇭','🇻🇳','🇲🇾','🇸🇬']],
];
// Only the few ASCII emoticons people type without thinking — converted at
// render time (on the already-escaped text, so it stays XSS-safe). The
// stored message keeps the original text, so an edit shows what was typed.
const CHAT_EMOTICONS = [
    [/&lt;3/g, '❤️'], [/&lt;\/3/g, '💔'],
    [/:'\)/g, '🥲'], [/:'\(/g, '😢'],
    [/:-?\)/g, '🙂'], [/:-?\(/g, '🙁'], [/:-?D/g, '😄'], [/:-?P/g, '😛'],
    [/;-?\)/g, '😉'], [/:-?o/gi, '😮'], [/:-?\//g, '😕'], [/:3\b/g, '😺'],
    [/\bxD\b/g, '😆'], [/\bXD\b/g, '😆'], [/\bT_T\b/g, '😭'], [/\bo_o\b/gi, '😳'],
];

function ensureChatLoaded() {
    if (!chatLoaded) {
        chatLoaded = true;
        loadInitialChatMessages();
    }
    startChatPolling();
    if (!chatPasteBound) {
        chatPasteBound = true;
        const input = document.getElementById('chat-input');
        if (input) input.addEventListener('paste', (e) => {
            const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
            if (item) { e.preventDefault(); onChatFilePicked(item.getAsFile()); }
        });
    }
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
            ? messages.map((m, i) => chatMessageHtml(m, messages[i - 1])).join('')
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
    const prevNode = empty ? null : chatPrevFromNode(listEl.querySelector('.chat-message:last-child'));
    listEl.insertAdjacentHTML('beforeend', fresh.map((m, i) => chatMessageHtml(m, i === 0 ? prevNode : fresh[i - 1])).join(''));
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
        // Repaint any message edited elsewhere since we last saw it.
        for (const m of (data.edited || [])) {
            const node = document.getElementById(`chat-msg-${m.id}`);
            if (node && node.getAttribute('data-edited-at') !== (m.editedAt || '')) {
                chatReplaceMessageNode(m);
            }
        }
        const messages = data.messages || [];
        if (messages.length) chatAppendMessages(listEl, messages);
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

/* Renders message text: HTML-escape first (XSS-safe), THEN swap the few
   ASCII emoticons for emoji on that already-safe string. */
function chatRenderContent(text) {
    let html = escapeHtmlOsu(text || '');
    for (const [re, ch] of CHAT_EMOTICONS) html = html.replace(re, ch);
    return html;
}

/* True when `m` should visually continue `prev` (same author, close in time,
   and not a reply — a reply always shows its own header for context). */
function chatIsGrouped(m, prev) {
    if (!prev || m.replyToId) return false;
    if (String(prev.authorId) !== String(m.authorId)) return false;
    const gap = new Date(m.createdAt) - new Date(prev.createdAt);
    return gap >= 0 && gap < CHAT_GROUP_WINDOW_MS;
}

// Minimal {authorId, createdAt} for chatIsGrouped(), read back off a rendered
// node so incremental append / in-place repaint can group against the DOM.
function chatPrevFromNode(node) {
    if (!node || !node.classList.contains('chat-message')) return null;
    return { authorId: node.dataset.authorId, createdAt: node.dataset.createdAt };
}

function chatMessageHtml(m, prev) {
    const grouped = chatIsGrouped(m, prev);
    const loggedInUser = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser();
    const isOwn = loggedInUser && String(loggedInUser.id) === String(m.authorId);
    const canDelete = loggedInUser && (isOwn || String(loggedInUser.id) === CHAT_OWNER_OSU_ID_HINT);
    const replyHtml = m.replyToId && m.replyAuthorUsername ? `
        <div class="chat-reply-quote">${icon('cornerUpLeft', { extraClass: 'icon-label-gap' })}<b>${escapeHtmlOsu(m.replyAuthorUsername)}</b>：${escapeHtmlOsu(m.replyContent || '')}</div>` : '';
    const cardHtml = m.beatmapPreview ? chatBeatmapCardHtml(m.beatmapPreview) : '';
    const mediaHtml = m.media && m.media.id ? `
        <a class="chat-message-media-link" href="/chat-media/${encodeURIComponent(m.media.id)}" target="_blank" rel="noopener noreferrer">
            <img class="chat-message-media" src="/chat-media/${encodeURIComponent(m.media.id)}" alt="" loading="lazy">
        </a>` : '';
    const profileUrl = `https://osu.ppy.sh/users/${m.authorId}`;
    const editedMark = m.editedAt ? ` <span class="chat-message-edited" title="${escapeHtmlOsu(chatFormatTime(m.editedAt))}">${t('chat_edited_marker')}</span>` : '';
    return `
    <div class="chat-message${grouped ? ' chat-message--grouped' : ''}" id="chat-msg-${m.id}" data-edited-at="${escapeHtmlOsu(m.editedAt || '')}" data-author-id="${escapeHtmlOsu(String(m.authorId || ''))}" data-created-at="${escapeHtmlOsu(m.createdAt || '')}">
        <a class="chat-message-author" href="${profileUrl}" target="_blank" rel="noopener noreferrer" title="${t('chat_view_profile_title')}" aria-hidden="${grouped ? 'true' : 'false'}">
            <div class="avatar-with-flag">
                <img class="tracked-player-avatar" src="${osuAvatarUrl(m.authorId)}" alt="" onerror="this.style.visibility='hidden';">
                ${m.authorCountry ? `<img class="avatar-flag-badge" src="${flagUrl(m.authorCountry)}" alt="" onerror="this.style.display='none';">` : ''}
            </div>
        </a>
        <div class="chat-message-body">
            <div class="chat-message-header">
                <a class="chat-message-name" href="${profileUrl}" target="_blank" rel="noopener noreferrer">${escapeHtmlOsu(m.authorUsername)}</a>
                <span class="chat-message-time">${chatFormatTime(m.createdAt)}${editedMark}</span>
                <button class="chat-translate-btn" onclick="toggleChatTranslation(${m.id}, decodeURIComponent('${chatEncodeForOnclick(m.content)}'), this)" title="${t('chat_translate_btn_title')}">${icon('globe', { size: '1.15em' })}</button>
                <button class="chat-reply-btn" onclick="setChatReplyTarget(${m.id}, decodeURIComponent('${chatEncodeForOnclick(m.authorUsername)}'), decodeURIComponent('${chatEncodeForOnclick(m.content)}'))" title="${t('chat_reply_btn_title')}">${icon('cornerUpLeft')}</button>
                ${isOwn ? `<button class="chat-edit-btn" onclick="startChatEdit(${m.id})" title="${t('chat_edit_btn_title')}">${icon('pencil')}</button>` : ''}
                ${canDelete ? `<button class="chat-delete-btn" onclick="deleteChatMessage(${m.id})" title="${t('chat_delete_btn_title')}">${icon('x')}</button>` : ''}
            </div>
            ${replyHtml}
            ${m.content ? `<div class="chat-message-content">${chatRenderContent(m.content)}</div>` : ''}
            ${mediaHtml}
            <div class="chat-translation" id="chat-translation-${m.id}" style="display:none;"></div>
            ${cardHtml}
        </div>
    </div>`;
}

/* ===== Inline edit (own messages) ===== */
function startChatEdit(id) {
    const node = document.getElementById(`chat-msg-${id}`);
    const contentEl = node && node.querySelector('.chat-message-content');
    if (!contentEl || node.querySelector('.chat-edit-box')) return;
    chatEditingId = id;
    const original = chatMessageOriginalText(id);
    const box = document.createElement('div');
    box.className = 'chat-edit-box';
    box.innerHTML = `
        <textarea class="chat-edit-input" maxlength="300" rows="2"></textarea>
        <div class="chat-edit-actions">
            <button class="chat-edit-save" onclick="submitChatEdit(${id})">${t('chat_edit_save')}</button>
            <button class="chat-edit-cancel" onclick="cancelChatEdit(${id})">${t('chat_edit_cancel')}</button>
        </div>`;
    contentEl.style.display = 'none';
    contentEl.insertAdjacentElement('afterend', box);
    const ta = box.querySelector('.chat-edit-input');
    ta.value = original;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChatEdit(id); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelChatEdit(id); }
    });
}

// The rendered .chat-message-content has had emoticons swapped in, so read
// the source text back from the translate button's encoded copy instead.
function chatMessageOriginalText(id) {
    const btn = document.querySelector(`#chat-msg-${id} .chat-translate-btn`);
    const m = btn && btn.getAttribute('onclick').match(/decodeURIComponent\('([^']*)'\)/);
    try { return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; }
}

function cancelChatEdit(id) {
    const node = document.getElementById(`chat-msg-${id}`);
    const box = node && node.querySelector('.chat-edit-box');
    const contentEl = node && node.querySelector('.chat-message-content');
    if (box) box.remove();
    if (contentEl) contentEl.style.display = '';
    if (chatEditingId === id) chatEditingId = null;
}

async function submitChatEdit(id) {
    const node = document.getElementById(`chat-msg-${id}`);
    const box = node && node.querySelector('.chat-edit-box');
    const ta = box && box.querySelector('.chat-edit-input');
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return; }
    ta.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/chat-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ messageId: id, content }),
        });
        if (res.status === 401) { showShareToast(t('osu_login_fail')); return; }
        if (res.status === 429) { showShareToast(t('chat_rate_limited')); return; }
        if (!res.ok) throw new Error('edit failed');
        const data = await res.json();
        chatEditingId = null;
        chatReplaceMessageNode(data.message);
    } catch (e) {
        console.error('Edit chat message failed:', e);
        showShareToast(t('chat_edit_fail'));
        ta.disabled = false;
    }
}

/* Repaints one already-rendered message in place (after an edit — local or,
   via the poll's `edited` list, someone else's). No-ops on the message this
   tab is currently editing so a poll can't yank the textarea away. */
function chatReplaceMessageNode(m) {
    if (chatEditingId === m.id) return;
    const node = document.getElementById(`chat-msg-${m.id}`);
    if (!node) return;
    const wasGrouped = node.classList.contains('chat-message--grouped');
    node.insertAdjacentHTML('afterend', chatMessageHtml(m, wasGrouped ? chatPrevFromNode(node.previousElementSibling) : null));
    node.remove();
}

/* ===== On-demand translation ("🌐" per message) =====
   Opt-in rather than auto-translating every message — most chat messages
   don't need it, and this keeps the free MyMemory API (see
   netlify/functions/chat-translate.js) called only for messages a visitor
   actually asked about. Cached per message+site-language so re-clicking
   (or a language switch mid-session) doesn't needlessly re-hit the API for
   text already translated once. */
const chatTranslationCache = {}; // `${messageId}:${lang}` -> translatedText

async function toggleChatTranslation(id, content, btnEl) {
    const box = document.getElementById(`chat-translation-${id}`);
    if (!box) return;

    if (box.style.display !== 'none') {
        box.style.display = 'none';
        if (btnEl) btnEl.title = t('chat_translate_btn_title');
        return;
    }

    const cacheKey = `${id}:${siteLang}`;
    if (chatTranslationCache[cacheKey]) {
        box.innerHTML = chatTranslationCache[cacheKey];
        box.style.display = 'block';
        if (btnEl) btnEl.title = t('chat_translate_hide_title');
        return;
    }

    box.style.display = 'block';
    box.innerHTML = `<span class="chat-translation-loading">${t('chat_translate_loading')}</span>`;
    try {
        const res = await fetch('/.netlify/functions/chat-translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content, targetLang: siteLang }),
        });
        if (!res.ok) throw new Error('translate failed');
        const data = await res.json();
        const html = `${icon('globe', { extraClass: 'icon-label-gap' })}${escapeHtmlOsu(data.translatedText)}`;
        chatTranslationCache[cacheKey] = html;
        box.innerHTML = html;
        if (btnEl) btnEl.title = t('chat_translate_hide_title');
    } catch (e) {
        console.error('Chat translation failed:', e);
        box.innerHTML = `<span class="chat-translation-error">${t('chat_translate_fail')}</span>`;
    }
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

/* ===== Emoji picker ===== */
const CHAT_EMOJI_RECENT_KEY = 'chat_emoji_recent';

function chatEmojiRecent() {
    try { return JSON.parse(localStorage.getItem(CHAT_EMOJI_RECENT_KEY) || '[]').slice(0, 24); }
    catch { return []; }
}
function chatPushEmojiRecent(ch) {
    try {
        const next = [ch, ...chatEmojiRecent().filter(e => e !== ch)].slice(0, 24);
        localStorage.setItem(CHAT_EMOJI_RECENT_KEY, JSON.stringify(next));
    } catch { /* private mode — recents just won't stick */ }
}

function chatBuildEmojiPicker() {
    const panel = document.getElementById('chat-emoji-panel');
    if (!panel) return;
    const recent = chatEmojiRecent();
    const section = (emojis) => `<div class="chat-emoji-grid">${
        emojis.map(e => `<button type="button" class="chat-emoji-cell" onclick="chatInsertEmoji('${e}')">${e}</button>`).join('')
    }</div>`;
    let html = '';
    if (recent.length) {
        html += `<div class="chat-emoji-cat-label">${t('chat_emoji_recent')}</div>${section(recent)}`;
    }
    for (const [, list] of CHAT_EMOJI_GROUPS) html += section(list);
    panel.innerHTML = html;
}

function toggleChatEmojiPicker() {
    const panel = document.getElementById('chat-emoji-panel');
    if (!panel) return;
    const open = panel.hasAttribute('hidden');
    if (open) {
        chatBuildEmojiPicker();
        panel.removeAttribute('hidden');
        setTimeout(() => document.addEventListener('pointerdown', chatEmojiOutsideClose), 0);
        document.addEventListener('keydown', chatEmojiEscClose);
    } else {
        chatCloseEmojiPicker();
    }
}
function chatCloseEmojiPicker() {
    const panel = document.getElementById('chat-emoji-panel');
    if (panel) panel.setAttribute('hidden', '');
    document.removeEventListener('pointerdown', chatEmojiOutsideClose);
    document.removeEventListener('keydown', chatEmojiEscClose);
}
function chatEmojiOutsideClose(e) {
    if (!e.target.closest('#chat-emoji-panel') && !e.target.closest('#chat-emoji-btn')) chatCloseEmojiPicker();
}
function chatEmojiEscClose(e) { if (e.key === 'Escape') chatCloseEmojiPicker(); }

function chatInsertEmoji(ch) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next = input.value.slice(0, start) + ch + input.value.slice(end);
    if (next.length > (parseInt(input.maxLength, 10) || 300)) return;
    input.value = next;
    const caret = start + ch.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    chatPushEmojiRecent(ch);
}

/* ===== Image / GIF attachment ===== */
function onChatFilePicked(file) {
    if (!file) return;
    if (!CHAT_MEDIA_TYPES.includes(file.type)) { showShareToast(t('chat_media_bad_type')); return; }
    if (file.size > CHAT_MEDIA_MAX_BYTES) { showShareToast(t('chat_media_too_big')); return; }
    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        if (!base64) return;
        chatPendingMedia = { dataUrl, base64, mime: file.type };
        const box = document.getElementById('chat-media-preview');
        const img = document.getElementById('chat-media-preview-img');
        if (img) img.src = dataUrl;
        if (box) box.hidden = false;
        document.getElementById('chat-input')?.focus();
    };
    reader.readAsDataURL(file);
}

function clearChatPendingMedia() {
    chatPendingMedia = null;
    const box = document.getElementById('chat-media-preview');
    const img = document.getElementById('chat-media-preview-img');
    if (img) img.removeAttribute('src');
    if (box) box.hidden = true;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content && !chatPendingMedia) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('chat_login_required')); return; }

    input.disabled = true;
    const sendBtn = input.parentElement?.querySelector('button:last-child');
    if (sendBtn) sendBtn.disabled = true;
    try {
        let mediaId = null;
        if (chatPendingMedia) {
            const up = await fetch('/.netlify/functions/chat-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ dataBase64: chatPendingMedia.base64 }),
            });
            if (up.status === 401) { showShareToast(t('osu_login_fail')); return; }
            if (up.status === 429) { showShareToast(t('chat_rate_limited')); return; }
            if (up.status === 403) { showShareToast(t('chat_media_disabled')); return; }
            if (!up.ok) { showShareToast(t('chat_media_upload_fail')); return; }
            mediaId = (await up.json()).mediaId;
        }

        const res = await fetch('/.netlify/functions/chat-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ content, mediaId, replyToId: chatReplyTarget ? chatReplyTarget.id : null }),
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
        clearChatPendingMedia();
    } catch (e) {
        console.error('Send chat message failed:', e);
        showShareToast(t('chat_send_fail'));
    } finally {
        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
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
