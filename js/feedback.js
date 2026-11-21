/* ===== Suggestions & Improvements: a conversation with the site owner =====
   A suggestion becomes a thread (netlify/functions/feedback.js). The visitor
   needs no sign-in: a random key kept in this browser proves the threads are
   theirs (and, signed in with osu!, they follow the account too). The owner
   is told on Discord, answers here, and sets the thread's status:
   討論中 / 已更新 / 不採用. Replies show under 我的建議 and in the
   notification bell; the visitor can write back.
   The old Google Sheet still gets a copy of each new suggestion. */
const FEEDBACK_API = 'https://script.google.com/macros/s/AKfycby0XtYQeXLu1f9gj1vNNhTNdZyCAII2STh5JOhgVrOdgEZu56QpT3s7kVvkiTPTHbLB/exec';
const FB_FN = '/.netlify/functions/feedback';
const FB_KEY = 'feedback-key-v1';
const FB_SEEN = 'feedback-seen-v1';
const FB_OWNER_ID = '26696007';

function fbKey() {
    try {
        let k = localStorage.getItem(FB_KEY);
        if (!/^[a-f0-9]{32}$/.test(k || '')) {
            k = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(FB_KEY, k);
        }
        return k;
    } catch { return null; }
}
const fbHasKey = () => { try { return /^[a-f0-9]{32}$/.test(localStorage.getItem(FB_KEY) || ''); } catch { return false; } };
const fbSeen = () => { try { return JSON.parse(localStorage.getItem(FB_SEEN)) || {}; } catch { return {}; } };
const fbSetSeen = (m) => { try { localStorage.setItem(FB_SEEN, JSON.stringify(m)); } catch { /* fine */ } };
function fbHeaders(extra) {
    const h = { ...(extra || {}) };
    const tok = typeof getOsuAuthToken === 'function' ? getOsuAuthToken() : null;
    if (tok) h.Authorization = `Bearer ${tok}`;
    return h;
}
const fbIsOwner = () => { const u = typeof getLoggedInOsuUser === 'function' ? getLoggedInOsuUser() : null; return !!(u && String(u.id) === FB_OWNER_ID); };
async function fbCall(method, params, body) {
    const url = method === 'GET' ? `${FB_FN}?${new URLSearchParams(params)}` : FB_FN;
    const res = await fetch(url, { method, headers: fbHeaders(body ? { 'Content-Type': 'application/json' } : null), body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
}

const FB_STATUS = {
    open: ['feedback_status_open', 'is-open'],
    discussing: ['feedback_status_discussing', 'is-discussing'],
    done: ['feedback_status_done', 'is-done'],
    declined: ['feedback_status_declined', 'is-declined'],
};
const fbStatusChip = (s) => { const [k, c] = FB_STATUS[s] || FB_STATUS.open; return `<span class="fb-status ${c}">${escHtml(t(k))}</span>`; };
const fbTime = (ms) => {
    const lang = typeof siteLang !== 'undefined' ? ({ zh: 'zh-TW', 'zh-Hans': 'zh-CN' }[siteLang] || siteLang) : undefined;
    return new Date(ms).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};
function fbMessages(th, ownerView) {
    return `<ol class="fb-msgs">${th.messages.map((m) => `
        <li class="fb-msg ${m.from === 'owner' ? 'is-owner' : 'is-visitor'}">
            <span class="fb-msg-who">${escHtml(m.from === 'owner' ? t('feedback_owner') : (ownerView ? (th.who || t('feedback_visitor')) : t('feedback_you')))} · ${escHtml(fbTime(m.at))}</span>
            <p>${escHtml(m.text)}</p>
        </li>`).join('')}</ol>`;
}

/* ----- the visitor: send, and 我的建議 ----- */
let fbThreads = [];
async function handleFeedbackSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const message = form.elements.message.value.trim();
    if (!message) return false;
    // Honeypot: bots fill every field, real users never see or fill this one.
    if (form.elements.website && form.elements.website.value) { form.reset(); return false; }
    const btn = form.querySelector('.feedback-submit');
    const status = document.getElementById('feedback-status');
    btn.disabled = true;
    try {
        const { thread } = await fbCall('POST', null, { action: 'create', message, lang: siteLang, key: fbKey() });
        fetch(FEEDBACK_API, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ message, context: `osu-collection-hanabi / ${siteLang}` }) }).catch(() => {});
        fbThreads = [thread, ...fbThreads.filter((x) => x.id !== thread.id)];
        const seen = fbSeen(); seen[thread.id] = thread.updated; fbSetSeen(seen);
        form.reset();
        if (status) { status.textContent = t('feedback_success'); status.className = 'feedback-status is-ok'; }
        renderFeedbackMine();
    } catch (e) {
        if (status) { status.textContent = e.status === 429 ? t('feedback_too_many') : t('feedback_fail'); status.className = 'feedback-status is-err'; }
    }
    btn.disabled = false;
    return false;
}

async function loadFeedbackMine() {
    if (!fbHasKey() && !(typeof getOsuAuthToken === 'function' && getOsuAuthToken())) { fbThreads = []; return fbThreads; }
    try { fbThreads = (await fbCall('GET', { action: 'mine', key: fbHasKey() ? fbKey() : '' })).threads || []; }
    catch { /* keep what we have */ }
    return fbThreads;
}

function renderFeedbackMine() {
    const box = document.getElementById('feedback-mine');
    if (!box) return;
    if (!fbThreads.length) { box.hidden = true; return; }
    box.hidden = false;
    const seen = fbSeen();
    box.innerHTML = `<h3 class="home-h"><span>${escHtml(t('feedback_mine_title'))}</span></h3>
        <ol class="fb-threads">${fbThreads.map((th) => `
        <li class="fb-thread${(seen[th.id] || 0) < th.updated && th.messages[th.messages.length - 1].from === 'owner' ? ' is-new' : ''}">
            <div class="fb-thread-head">${fbStatusChip(th.status)}<time>${escHtml(fbTime(th.created))}</time></div>
            ${fbMessages(th, false)}
            <form class="fb-reply" onsubmit="return sendFeedbackReply(event, '${th.id}')">
                <textarea name="message" rows="2" maxlength="2000" placeholder="${escHtml(t('feedback_reply_placeholder'))}" required></textarea>
                <button type="submit" class="btn">${escHtml(t('feedback_reply_send'))}</button>
            </form>
        </li>`).join('')}</ol>`;
    // everything shown counts as seen
    for (const th of fbThreads) seen[th.id] = th.updated;
    fbSetSeen(seen);
}

async function sendFeedbackReply(event, id) {
    event.preventDefault();
    const form = event.target;
    const message = form.elements.message.value.trim();
    if (!message) return false;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
        const { thread } = await fbCall('POST', null, { action: 'reply', id, message, key: fbHasKey() ? fbKey() : '' });
        fbThreads = fbThreads.map((x) => (x.id === id ? thread : x));
        renderFeedbackMine();
    } catch { btn.disabled = false; alertFeedback(t('feedback_fail')); }
    return false;
}
function alertFeedback(msg) { const s = document.getElementById('feedback-status'); if (s) { s.textContent = msg; s.className = 'feedback-status is-err'; } }

/* ----- the bell: a reply from the owner since the visitor last looked ----- */
async function checkFeedbackReplies() {
    if (!fbHasKey() || typeof addNotification !== 'function') return;
    const threads = await loadFeedbackMine();
    const seen = fbSeen();
    for (const th of threads) {
        const last = th.messages[th.messages.length - 1];
        if (last.from !== 'owner' || (seen[th.id] || 0) >= th.updated) continue;
        addNotification({
            id: `feedback:${th.id}:${th.updated}`, type: 'feedback', createdAt: last.at, read: false,
            title: `${t('feedback_notif_title')} · ${t((FB_STATUS[th.status] || FB_STATUS.open)[0])}`,
            detail: last.text.slice(0, 120),
        });
    }
    if (typeof renderNotificationBell === 'function') renderNotificationBell();
}

/* ----- the owner: every thread, answer and set its status ----- */
let fbAll = [], fbFilter = 'active';
async function loadFeedbackAdmin() {
    const box = document.getElementById('feedback-admin');
    if (!box) return;
    if (!fbIsOwner()) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<p class="osu-empty">${escHtml(t('gallery_loading'))}</p>`;
    try { fbAll = (await fbCall('GET', { action: 'all' })).threads || []; }
    catch { box.innerHTML = `<p class="osu-empty">${escHtml(t('feedback_fail'))}</p>`; return; }
    renderFeedbackAdmin();
}
function renderFeedbackAdmin() {
    const box = document.getElementById('feedback-admin');
    if (!box) return;
    const show = fbAll.filter((th) => (fbFilter === 'active' ? th.status === 'open' || th.status === 'discussing' : fbFilter === 'all' || th.status === fbFilter));
    const filters = [['active', 'feedback_filter_active'], ['done', 'feedback_status_done'], ['declined', 'feedback_status_declined'], ['all', 'osu_filter_all']];
    box.innerHTML = `
        <h3 class="home-h"><span>${escHtml(t('feedback_admin_title'))} <small>${fbAll.filter((x) => x.status === 'open').length} ${escHtml(t('feedback_status_open'))}</small></span>
            <span class="fb-filters">${filters.map(([k, lab]) => `<button type="button" class="${fbFilter === k ? 'is-on' : ''}" onclick="fbFilter='${k}';renderFeedbackAdmin()">${escHtml(t(lab))}</button>`).join('')}</span></h3>
        ${show.length ? `<ol class="fb-threads">${show.map((th) => `
        <li class="fb-thread" id="fb-${th.id}">
            <div class="fb-thread-head">${fbStatusChip(th.status)}<span>${escHtml(th.who || t('feedback_visitor'))} · ${escHtml(th.lang || '')}</span><time>${escHtml(fbTime(th.created))}</time></div>
            ${fbMessages(th, true)}
            <form class="fb-reply fb-answer" onsubmit="return sendFeedbackAnswer(event, '${th.id}')">
                <textarea name="message" rows="3" maxlength="2000" placeholder="${escHtml(t('feedback_answer_placeholder'))}"></textarea>
                <div class="fb-answer-btns">
                    <button type="submit" class="btn" data-status="discussing">💬 ${escHtml(t('feedback_answer_reply'))}</button>
                    <button type="submit" class="btn fb-done" data-status="done">✅ ${escHtml(t('feedback_answer_done'))}</button>
                    <button type="submit" class="btn fb-declined" data-status="declined">❌ ${escHtml(t('feedback_answer_declined'))}</button>
                </div>
            </form>
        </li>`).join('')}</ol>` : `<p class="osu-empty">${escHtml(t('feedback_admin_empty'))}</p>`}`;
    const hash = location.hash.slice(1);
    if (hash) { const el = document.getElementById(`fb-${hash}`); if (el) el.scrollIntoView({ block: 'center' }); }
}
async function sendFeedbackAnswer(event, id) {
    event.preventDefault();
    const form = event.target;
    const status = (event.submitter && event.submitter.dataset.status) || 'discussing';
    const message = form.elements.message.value.trim();
    if (!message && status === 'discussing') return false;
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
        const { thread } = await fbCall('POST', null, { action: 'answer', id, message, status });
        fbAll = fbAll.map((x) => (x.id === id ? thread : x));
        renderFeedbackAdmin();
    } catch { form.querySelectorAll('button').forEach((b) => { b.disabled = false; }); alertFeedback(t('feedback_fail')); }
    return false;
}

/* the 建議&改進 page opening */
async function ensureFeedbackPage() {
    await loadFeedbackMine();
    renderFeedbackMine();
    loadFeedbackAdmin();
}
// ?feedback=admin (the link in the owner's Discord DM) opens the page
if (/[?&]feedback=admin\b/.test(location.search)) {
    const go = () => setTimeout(() => { if (typeof switchTab === 'function') switchTab('feedback'); }, 300);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}
