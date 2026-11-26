/* ===== 社群 → Discord 伺服器 =====
   osu! community servers: ours first (the Discord bot is being tested there),
   then the ones visitors submitted and the owner approved. Server:
   netlify/functions/discord-servers.js. Submitting needs an osu! login; the
   owner reviews submissions here (and gets a Discord DM for each). ===== */
const SRV_API = '/.netlify/functions/discord-servers';
const SRV_TAG_LABEL = {
    osu: 'osu!', taiko: 'osu!taiko', catch: 'osu!catch', mania: 'osu!mania', mapping: 'Mapping', tournament: 'Tournament',
    skins: 'Skins', chat: 'Chat', art: 'Art', music: 'Music', beginners: 'Beginners', competitive: 'Competitive',
};
const SRV_LANGS = [
    ['zh', '繁體中文'], ['zh-Hans', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['de', 'Deutsch'],
    ['es', 'Español'], ['fr', 'Français'], ['ru', 'Русский'], ['pt', 'Português'], ['id', 'Bahasa Indonesia'],
    ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['pl', 'Polski'], ['other', '—'],
];
let srvData = null;
let srvTag = '';
let srvPicked = new Set();
const srvEsc = (s) => (typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s));
const srvToken = () => (typeof getOsuAuthToken === 'function' ? getOsuAuthToken() : null);
const srvIsOwner = () => { const u = typeof getLoggedInOsuUser === 'function' && getLoggedInOsuUser(); return !!(u && String(u.id) === '26696007'); };

async function srvCall(method, query, body) {
    const token = srvToken();
    const res = await fetch(`${SRV_API}${query ? `?${new URLSearchParams(query)}` : ''}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
}

async function ensureServersPage() {
    const list = document.getElementById('servers-list');
    if (!list) return;
    if (!srvData) list.innerHTML = `<p class="osu-empty">${srvEsc(t('ssc_loading'))}</p>`;
    try { srvData = await srvCall('GET', { action: 'list' }); } catch { srvData = srvData || { featured: null, servers: [], tags: [] }; }
    renderServersPage();
    loadServersMine();
    if (srvIsOwner()) loadServersReview();
}

function srvCounts(s) {
    return `<span class="srv-count"><i class="srv-dot on"></i>${srvEsc(t('servers_online', { n: (s.online || 0).toLocaleString() }))}</span><span class="srv-count"><i class="srv-dot"></i>${srvEsc(t('servers_members', { n: (s.members || 0).toLocaleString() }))}</span>`;
}
function srvIcon(s, size = 56) {
    return s.icon ? `<img class="srv-icon" src="${srvEsc(s.icon)}" alt="" width="${size}" height="${size}" loading="lazy">` : `<span class="srv-icon srv-icon-blank" style="width:${size}px;height:${size}px">${srvEsc((s.name || '?').slice(0, 1))}</span>`;
}

function renderServersPage() {
    const d = srvData || {};
    const f = d.featured;
    const fe = document.getElementById('servers-featured');
    if (fe) {
        fe.innerHTML = f ? `
            <div class="srv-featured-card"${f.banner ? ` style="--banner:url('${srvEsc(f.banner)}')"` : ''}>
                ${srvIcon(f, 72)}
                <div class="srv-featured-main">
                    <div class="srv-featured-tag">${srvEsc(t('servers_featured_tag'))}</div>
                    <div class="srv-name">${srvEsc(f.name)}</div>
                    <div class="srv-counts">${srvCounts(f)}</div>
                    <p class="srv-bot-note">🤖 ${srvEsc(t('servers_bot_note'))}</p>
                </div>
                <a class="btn srv-join" href="https://discord.gg/${encodeURIComponent(f.code)}" target="_blank" rel="noopener noreferrer">${typeof icon === 'function' ? icon('discord', { extraClass: 'icon-label-gap' }) : ''}${srvEsc(t('servers_join'))}</a>
            </div>` : '';
    }
    const tagsEl = document.getElementById('servers-tag-filter');
    const used = [...new Set((d.servers || []).flatMap((s) => s.tags || []))];
    if (tagsEl) {
        tagsEl.innerHTML = used.length ? [['', t('servers_all_tags')], ...used.map((x) => [x, SRV_TAG_LABEL[x] || x])]
            .map(([v, lab]) => `<button type="button" class="srv-tag${srvTag === v ? ' on' : ''}" onclick="srvTag='${v}'; renderServersPage()">${srvEsc(lab)}</button>`).join('') : '';
    }
    const list = document.getElementById('servers-list');
    const shown = (d.servers || []).filter((s) => !srvTag || (s.tags || []).includes(srvTag));
    if (!list) return;
    if (!shown.length) { list.innerHTML = `<p class="osu-empty srv-empty">${srvEsc(t('servers_empty'))}</p>`; return; }
    list.innerHTML = shown.map((s) => `
        <article class="srv-card${s.banner ? ' has-banner' : ''}">
            ${s.banner ? `<div class="srv-banner" style="background-image:url('${srvEsc(s.banner)}')"></div>` : ''}
            <div class="srv-card-head">${srvIcon(s)}<div class="srv-card-title"><div class="srv-name" title="${srvEsc(s.name)}">${srvEsc(s.name)}</div><div class="srv-counts">${srvCounts(s)}</div></div></div>
            <div class="srv-card-tags">${(s.tags || []).map((x) => `<span class="srv-chip">${srvEsc(SRV_TAG_LABEL[x] || x)}</span>`).join('')}${s.lang && s.lang !== 'other' ? `<span class="srv-chip srv-lang">${srvEsc((SRV_LANGS.find(([k]) => k === s.lang) || [, s.lang])[1])}</span>` : ''}</div>
            <p class="srv-desc">${srvEsc(s.description)}</p>
            <a class="btn srv-join" href="https://discord.gg/${encodeURIComponent(s.code)}" target="_blank" rel="noopener noreferrer">${srvEsc(t('servers_join'))}</a>
        </article>`).join('');
}

const SRV_STATUS = { pending: 'servers_pending', approved: 'servers_approved', rejected: 'servers_rejected' };
async function loadServersMine() {
    const box = document.getElementById('servers-mine');
    if (!box) return;
    if (!srvToken()) { box.hidden = true; return; }
    let mine = [];
    try { mine = (await srvCall('GET', { action: 'mine' })).servers || []; } catch { mine = []; }
    box.hidden = !mine.length;
    box.innerHTML = mine.length ? `<h3 class="home-h"><span>${srvEsc(t('servers_mine'))}</span></h3><ul class="srv-mine-list">${mine.map((s) => `
        <li>${srvIcon(s, 28)}<b>${srvEsc(s.name)}</b><span class="srv-state is-${s.status}">${srvEsc(t(SRV_STATUS[s.status] || s.status))}</span>${s.note ? `<small>${srvEsc(s.note)}</small>` : ''}
        <button type="button" class="srv-x" onclick="removeServer('${s.id}')">${srvEsc(t('servers_remove'))}</button></li>`).join('')}</ul>` : '';
}

async function loadServersReview() {
    const box = document.getElementById('servers-review');
    if (!box) return;
    let list = [];
    try { list = (await srvCall('GET', { action: 'pending' })).servers || []; } catch { list = []; }
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<h3 class="home-h"><span>${srvEsc(t('servers_review', { n: list.length }))}</span></h3>${list.map((s) => `
        <div class="srv-review-row">${srvIcon(s, 40)}
            <div class="srv-review-main"><b>${srvEsc(s.name)}</b> <span class="srv-counts">${srvCounts(s)}</span>
                <div class="srv-card-tags">${(s.tags || []).map((x) => `<span class="srv-chip">${srvEsc(SRV_TAG_LABEL[x] || x)}</span>`).join('')}<span class="srv-chip">${srvEsc(s.lang)}</span><span class="srv-chip">${srvEsc(s.submittedBy || '')}</span></div>
                <p class="srv-desc">${srvEsc(s.description)}</p>
                <a href="https://discord.gg/${encodeURIComponent(s.code)}" target="_blank" rel="noopener noreferrer">discord.gg/${srvEsc(s.code)}</a></div>
            <div class="srv-review-acts">
                <button type="button" class="btn srv-ok" onclick="reviewServer('${s.id}', true)">${srvEsc(t('servers_approve'))}</button>
                <button type="button" class="btn srv-no" onclick="reviewServer('${s.id}', false)">${srvEsc(t('servers_reject'))}</button>
            </div>
        </div>`).join('')}` : '';
}
async function reviewServer(id, approve) {
    const note = approve ? '' : (prompt(t('servers_reject_note')) || '');
    try { await srvCall('POST', null, { action: 'review', id, approve, note }); } catch (e) { showShareToast(e.message); }
    ensureServersPage();
}
async function removeServer(id) {
    if (!confirm(t('servers_remove_confirm'))) return;
    try { await srvCall('POST', null, { action: 'remove', id }); } catch (e) { showShareToast(e.message); }
    ensureServersPage();
}

/* ----- submitting ----- */
function openServerSubmit() {
    if (!srvToken()) { showShareToast(t('servers_need_login')); return; }
    document.getElementById('servers-submit-modal').style.display = 'flex';
    const lang = document.getElementById('srv-lang');
    if (lang && !lang.options.length) {
        lang.innerHTML = SRV_LANGS.map(([k, n]) => `<option value="${k}">${srvEsc(n)}</option>`).join('');
        const cur = typeof siteLang === 'string' ? siteLang : 'en';
        lang.value = SRV_LANGS.some(([k]) => k === cur) ? cur : 'en';
    }
    renderSrvTagPick();
}
function closeServerSubmit() { document.getElementById('servers-submit-modal').style.display = 'none'; }
function renderSrvTagPick() {
    const el = document.getElementById('srv-tag-pick');
    const tags = (srvData && srvData.tags && srvData.tags.length) ? srvData.tags : Object.keys(SRV_TAG_LABEL);
    if (el) el.innerHTML = tags.map((x) => `<button type="button" class="srv-tag${srvPicked.has(x) ? ' on' : ''}" onclick="toggleSrvTag('${x}')">${srvEsc(SRV_TAG_LABEL[x] || x)}</button>`).join('');
}
function toggleSrvTag(x) {
    if (srvPicked.has(x)) srvPicked.delete(x); else if (srvPicked.size < 5) srvPicked.add(x);
    renderSrvTagPick();
}
async function previewServerInvite() {
    const box = document.getElementById('srv-preview');
    const invite = document.getElementById('srv-invite').value.trim();
    if (!invite) return;
    box.innerHTML = `<span class="srv-label">${srvEsc(t('ssc_loading'))}</span>`;
    try {
        const s = (await srvCall('GET', { action: 'preview', invite })).server;
        box.innerHTML = `<div class="srv-card-head">${srvIcon(s, 48)}<div class="srv-card-title"><div class="srv-name">${srvEsc(s.name)}</div><div class="srv-counts">${srvCounts(s)}</div>${s.expires ? `<small class="srv-warn">${srvEsc(t('servers_invite_expires'))}</small>` : ''}</div></div>`;
    } catch (e) { box.innerHTML = `<span class="srv-warn">${srvEsc(e.message)}</span>`; }
}
async function submitServer() {
    const status = document.getElementById('srv-status');
    const btn = document.getElementById('srv-send');
    btn.disabled = true;
    status.textContent = '';
    try {
        await srvCall('POST', null, {
            action: 'submit', invite: document.getElementById('srv-invite').value.trim(),
            description: document.getElementById('srv-desc').value.trim(), tags: [...srvPicked], lang: document.getElementById('srv-lang').value,
        });
        showShareToast(t('servers_sent'));
        document.getElementById('srv-invite').value = '';
        document.getElementById('srv-desc').value = '';
        document.getElementById('srv-preview').innerHTML = '';
        srvPicked = new Set();
        closeServerSubmit();
        loadServersMine();
    } catch (e) {
        status.textContent = e.message;
        status.style.color = '#ff5252';
    } finally { btn.disabled = false; }
}

// ?servers=review (the link in the owner's Discord DM) opens the page
if (/[?&]servers=review\b/.test(location.search)) {
    const go = () => setTimeout(() => { if (typeof switchTab === 'function') switchTab('servers'); }, 300);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
}
