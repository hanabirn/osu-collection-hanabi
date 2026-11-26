/* ===== 皮膚廣場: the public skin gallery =====
   Server: netlify/functions/skin-screenshots-{upload,list,image,download,
   like,delete}.js. Each skin has up to 8 screenshots (the first is the
   cover; cards flip through them), the modes it covers, its aspect ratio,
   a description, and one or more download links (Google Drive, MEGA,
   MediaFire… recognised and labelled) and/or a small .osk. Publishing,
   liking and deleting need a verified osu! login (getOsuAuthToken()). ===== */
const SKIN_SCREENSHOTS_PAGE_SIZE = 12;
const SSC_MAX_IMAGES = 8;
const SSC_MAX_LINKS = 5;
const SSC_MAX_DIM = 1920;
const SSC_WEBP_QUALITY = 0.86;
const SKIN_SCREENSHOT_MAX_OSK_BYTES = 2.5 * 1024 * 1024;

let skinScreenshotsLoaded = false;
let skinScreenshotsPage = 0;
let skinScreenshotsSort = 'recent';
let skinScreenshotsItems = [];
let skinScreenshotsTotal = 0;
let skinScreenshotsQuery = '';
let skinScreenshotsMode = '';
let skinScreenshotsLikedOnly = false;
let skinScreenshotsMineOnly = false;
let skinScreenshotsSearchDebounce = null;

const sscImg = (key) => `/.netlify/functions/skin-screenshots-image?id=${encodeURIComponent(key)}`;
const sscEsc = (s) => (typeof escapeHtmlOsu === 'function' ? escapeHtmlOsu(s) : String(s == null ? '' : s));

/* Download hosts, recognised from the link so each button says where it goes. */
const SSC_HOSTS = [
    [/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/, 'Google Drive', '#1fa463'],
    [/(^|\.)mega\.(nz|co\.nz|io)$/, 'MEGA', '#d9272e'],
    [/(^|\.)mediafire\.com$/, 'MediaFire', '#1299f3'],
    [/(^|\.)dropbox\.com$|(^|\.)dropboxusercontent\.com$/, 'Dropbox', '#0061ff'],
    [/(^|\.)onedrive\.live\.com$|(^|\.)1drv\.ms$|sharepoint\.com$/, 'OneDrive', '#0a74da'],
    [/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/, 'GitHub', '#8b949e'],
    [/(^|\.)osu\.ppy\.sh$/, 'osu! forum', '#ff66aa'],
    [/(^|\.)gofile\.io$/, 'Gofile', '#3d7bfd'],
    [/(^|\.)pixeldrain\.com$/, 'Pixeldrain', '#ffb000'],
    [/(^|\.)discord(app)?\.com$|cdn\.discordapp\.com$/, 'Discord', '#5865f2'],
];
function sscHost(url) {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
    for (const [re, name, color] of SSC_HOSTS) if (re.test(host)) return { name, color, host };
    return { name: host.replace(/^www\./, ''), color: '#9aa0a6', host };
}

function ensureSkinScreenshotsLoaded() {
    renderSkinScreenshotsFilterTabs();
    if (!skinScreenshotsLoaded) loadSkinScreenshotsPage(0);
}

function renderSkinScreenshotsFilterTabs() {
    const el = document.getElementById('skin-screenshots-mode-filter');
    if (!el) return;
    const allBtn = `<button class="osu-tab ${skinScreenshotsMode === '' ? 'active' : ''}" onclick="filterSkinScreenshotsMode('')">${t('ssc_filter_all')}</button>`;
    const modeBtns = OSU_MODES.map((mode, i) => `<button class="osu-tab ${skinScreenshotsMode === mode ? 'active' : ''}" onclick="filterSkinScreenshotsMode('${mode}')">${modeIconSvg(mode)} ${OSU_MODE_LABELS[i]}</button>`).join('');
    el.innerHTML = allBtn + modeBtns;
}
function filterSkinScreenshotsMode(mode) { skinScreenshotsMode = mode; renderSkinScreenshotsFilterTabs(); loadSkinScreenshotsPage(0); }
function switchSkinScreenshotsSort(sort) { skinScreenshotsSort = sort; loadSkinScreenshotsPage(0); }
function searchSkinScreenshots(value) {
    skinScreenshotsQuery = value.trim();
    clearTimeout(skinScreenshotsSearchDebounce);
    skinScreenshotsSearchDebounce = setTimeout(() => loadSkinScreenshotsPage(0), 350);
}
function toggleSkinScreenshotsLikedOnly(checked) {
    if (checked && !getOsuAuthToken()) { showShareToast(t('ssc_login_required')); syncSkinScreenshotsCheckboxes(); return; }
    skinScreenshotsLikedOnly = checked; loadSkinScreenshotsPage(0);
}
function toggleSkinScreenshotsMineOnly(checked) {
    if (checked && !getOsuAuthToken()) { showShareToast(t('ssc_login_required')); syncSkinScreenshotsCheckboxes(); return; }
    skinScreenshotsMineOnly = checked; loadSkinScreenshotsPage(0);
}
function syncSkinScreenshotsCheckboxes() {
    const likedCb = document.getElementById('ssc-liked-only-checkbox');
    if (likedCb) likedCb.checked = skinScreenshotsLikedOnly;
    const mineCb = document.getElementById('ssc-mine-only-checkbox');
    if (mineCb) mineCb.checked = skinScreenshotsMineOnly;
}

async function loadSkinScreenshotsPage(page) {
    skinScreenshotsLoaded = true;
    const listEl = document.getElementById('skin-screenshots-list');
    const pageEl = document.getElementById('skin-screenshots-pagination');
    if (!listEl) return;
    listEl.innerHTML = `<p class="osu-empty">${t('ssc_loading')}</p>`;
    if (pageEl) pageEl.innerHTML = '';
    try {
        const params = new URLSearchParams({ page, sort: skinScreenshotsSort });
        if (skinScreenshotsQuery) params.set('q', skinScreenshotsQuery);
        if (skinScreenshotsMode) params.set('mode', skinScreenshotsMode);
        if (skinScreenshotsLikedOnly) params.set('likedOnly', '1');
        if (skinScreenshotsMineOnly) params.set('mine', '1');
        const token = getOsuAuthToken();
        const res = await fetch(`/.netlify/functions/skin-screenshots-list?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (res.status === 401) {
            skinScreenshotsLikedOnly = false; skinScreenshotsMineOnly = false; syncSkinScreenshotsCheckboxes();
            return loadSkinScreenshotsPage(0);
        }
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        skinScreenshotsPage = data.page || 0;
        skinScreenshotsTotal = data.total || 0;
        // entries from before multi-screenshot skins: one image under the entry's id, one mode, one link
        skinScreenshotsItems = (data.items || []).map((e) => ({
            ...e,
            images: Array.isArray(e.images) && e.images.length ? e.images : [{ key: e.id, w: e.width || null, h: e.height || null }],
            modes: Array.isArray(e.modes) && e.modes.length ? e.modes : [e.mode || 'standard'],
            links: Array.isArray(e.links) ? e.links : (e.downloadUrl ? [e.downloadUrl] : []),
        }));
        renderSkinScreenshotsList();
    } catch (e) {
        console.error('Skin screenshots list failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('ssc_load_fail')}</p>`;
    }
}

function sscModeIcons(modes) { return (modes || []).map((m) => `<span class="ssc-mode-ic" title="${sscEsc(m)}">${modeIconSvg(m)}</span>`).join(''); }
function sscDate(iso) { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } }

function renderSkinScreenshotsList() {
    const listEl = document.getElementById('skin-screenshots-list');
    const pageEl = document.getElementById('skin-screenshots-pagination');
    if (!listEl || !skinScreenshotsLoaded) return;
    syncSkinScreenshotsCheckboxes();

    if (skinScreenshotsItems.length === 0) {
        const hasFilter = !!(skinScreenshotsQuery || skinScreenshotsMode || skinScreenshotsLikedOnly || skinScreenshotsMineOnly);
        listEl.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">${icon(hasFilter ? 'search' : 'camera', { size: '1.5rem' })}</div>
            <div class="empty-state-sub">${sscEsc(t(hasFilter ? 'ssc_no_results' : 'ssc_empty'))}</div>
            ${hasFilter ? '' : `<ol class="empty-steps"><li>${escHtml(t('ssc_step1'))}</li><li>${escHtml(t('ssc_step2'))}</li><li>${escHtml(t('ssc_step3'))}</li></ol>`}
        </div>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = `<div class="ssc-grid">${skinScreenshotsItems.map((item, idx) => {
        const imgs = item.images || [];
        const authorLine = item.author ? t('ssc_by_author', { author: sscEsc(item.author) }) : sscEsc(item.username || '');
        const nav = imgs.length > 1
            ? `<button type="button" class="ssc-nav prev" aria-label="‹" onclick="event.stopPropagation(); sscFlip(${idx}, -1)">‹</button><button type="button" class="ssc-nav next" aria-label="›" onclick="event.stopPropagation(); sscFlip(${idx}, 1)">›</button>
               <span class="ssc-dots">${imgs.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</span>`
            : '';
        return `<article class="ssc-card" data-idx="${idx}" data-at="0" onclick="openSkinDetail(${idx})" tabindex="0" onkeydown="if(event.key==='Enter')openSkinDetail(${idx})">
            <div class="ssc-shot">
                <img src="${sscImg(imgs[0] && imgs[0].key)}" alt="${sscEsc(item.skinName)}" loading="lazy">
                ${nav}
                <span class="ssc-modes">${sscModeIcons(item.modes)}</span>
                ${imgs.length > 1 ? `<span class="ssc-count">${icon('camera')} ${imgs.length}</span>` : ''}
            </div>
            <div class="ssc-info">
                <div class="ssc-name" title="${sscEsc(item.skinName)}">${sscEsc(item.skinName)}${item.version ? ` <span class="ssc-ver">${sscEsc(item.version)}</span>` : ''}</div>
                <div class="ssc-meta"><span class="ssc-author">${authorLine}</span>
                    <span class="ssc-stats"><span title="${sscEsc(t('gallery_like_btn_title'))}">${icon('heart', { filled: item.likedByMe })} ${(item.likeCount || 0).toLocaleString()}</span><span>${icon('download')} ${(item.downloads || 0).toLocaleString()}</span></span></div>
            </div>
        </article>`;
    }).join('')}</div>`;

    if (!pageEl) return;
    const totalPages = Math.max(1, Math.ceil(skinScreenshotsTotal / SKIN_SCREENSHOTS_PAGE_SIZE));
    if (totalPages <= 1) { pageEl.innerHTML = ''; return; }
    let pages = '';
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(0)" ${skinScreenshotsPage === 0 ? 'disabled' : ''}>«</button>`;
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(Math.max(0,${skinScreenshotsPage}-1))" ${skinScreenshotsPage === 0 ? 'disabled' : ''}>‹</button>`;
    pages += buildPaginationPageButtons(skinScreenshotsPage, totalPages, (i) => `loadSkinScreenshotsPage(${i})`);
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(Math.min(${totalPages - 1},${skinScreenshotsPage}+1))" ${skinScreenshotsPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(${totalPages - 1})" ${skinScreenshotsPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    pageEl.innerHTML = pages;
}

// a card's ‹ › : the next screenshot in place
function sscFlip(idx, d) {
    const card = document.querySelector(`.ssc-card[data-idx="${idx}"]`);
    const item = skinScreenshotsItems[idx];
    if (!card || !item) return;
    const n = item.images.length;
    const at = (Number(card.dataset.at) + d + n) % n;
    card.dataset.at = String(at);
    card.querySelector('.ssc-shot img').src = sscImg(item.images[at].key);
    card.querySelectorAll('.ssc-dots i').forEach((dot, i) => dot.classList.toggle('on', i === at));
}

/* ----- one skin: screenshots large, details and downloads beside them ----- */
let sscDetailIdx = -1;
let sscDetailAt = 0;
function openSkinDetail(idx) {
    const item = skinScreenshotsItems[idx];
    if (!item) return;
    sscDetailIdx = idx;
    const card = document.querySelector(`.ssc-card[data-idx="${idx}"]`);
    sscDetailAt = card ? Number(card.dataset.at) || 0 : 0;
    renderSkinDetail();
    document.getElementById('ssc-detail-modal').style.display = 'flex';
}
function closeSkinDetail() { document.getElementById('ssc-detail-modal').style.display = 'none'; sscDetailIdx = -1; }
function sscDetailGo(i) { sscDetailAt = i; renderSkinDetail(); }

function renderSkinDetail() {
    const item = skinScreenshotsItems[sscDetailIdx];
    const box = document.getElementById('ssc-detail-body');
    if (!item || !box) return;
    const imgs = item.images || [];
    const at = Math.min(sscDetailAt, imgs.length - 1);
    const user = getLoggedInOsuUser();
    const isOwn = user && String(user.id) === String(item.userId);
    const links = (item.links || []).map((url, i) => {
        const h = sscHost(url);
        return `<a class="ssc-dl" style="--host:${h ? h.color : '#9aa0a6'}" href="/.netlify/functions/skin-screenshots-download?id=${encodeURIComponent(item.id)}&link=${i}" target="_blank" rel="noopener noreferrer">${icon('download')}<b>${sscEsc(h ? h.name : t('ssc_link_other'))}</b><small>${sscEsc(h ? h.host : '')}</small></a>`;
    }).join('');
    const osk = item.oskFilename
        ? `<a class="ssc-dl" style="--host:#ff66aa" href="/.netlify/functions/skin-screenshots-download?id=${encodeURIComponent(item.id)}">${icon('package')}<b>.osk</b><small>${sscEsc(item.oskFilename)}</small></a>`
        : '';
    const n = imgs.length;
    box.innerHTML = `
        <div class="ssc-detail">
            <div class="ssc-detail-left">
                <div class="ssc-detail-shot">
                    <img src="${sscImg(imgs[at].key)}" alt="${sscEsc(item.skinName)}">
                    ${n > 1 ? `<button type="button" class="ssc-nav prev" onclick="sscDetailGo(${(at - 1 + n) % n})">‹</button><button type="button" class="ssc-nav next" onclick="sscDetailGo(${(at + 1) % n})">›</button>` : ''}
                </div>
                ${n > 1 ? `<div class="ssc-thumbs">${imgs.map((im, i) => `<button type="button" class="${i === at ? 'on' : ''}" onclick="sscDetailGo(${i})"><img src="${sscImg(im.key)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
            </div>
            <div class="ssc-detail-right">
                <h3 class="ssc-detail-name">${sscEsc(item.skinName)}${item.version ? ` <span class="ssc-ver">${sscEsc(item.version)}</span>` : ''}</h3>
                <div class="ssc-detail-by">${item.author ? t('ssc_by_author', { author: sscEsc(item.author) }) : ''}<span class="ssc-detail-up">${sscEsc(t('ssc_uploaded_by', { name: item.username || '' }))} · ${sscEsc(sscDate(item.uploadedAt))}</span></div>
                <div class="ssc-detail-tags">${sscModeIcons(item.modes)}${item.aspect ? `<span class="ssc-chip">${sscEsc(item.aspect)}</span>` : ''}<span class="ssc-chip">${icon('heart', { filled: item.likedByMe })} ${(item.likeCount || 0).toLocaleString()}</span><span class="ssc-chip">${icon('download')} ${(item.downloads || 0).toLocaleString()}</span></div>
                ${item.description ? `<p class="ssc-detail-desc">${sscEsc(item.description)}</p>` : ''}
                <div class="ssc-dl-title">${sscEsc(t('ssc_download_title'))}</div>
                <div class="ssc-dls">${links}${osk}</div>
                <div class="ssc-detail-actions">
                    ${isOwn
                        ? `<button type="button" class="btn ssc-del" onclick="deleteSkinScreenshot('${item.id}')">${icon('trash2', { extraClass: 'icon-label-gap' })}${sscEsc(t('ssc_delete_btn_title'))}</button>`
                        : `<button type="button" class="btn ssc-like-btn ${item.likedByMe ? 'liked' : ''}" onclick="toggleSkinScreenshotLike('${item.id}', this)">${icon('heart', { filled: item.likedByMe, extraClass: 'icon-label-gap' })}${(item.likeCount || 0).toLocaleString()}</button>`}
                </div>
            </div>
        </div>`;
}

async function toggleSkinScreenshotLike(id, btnEl) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('ssc_login_required')); return; }
    if (btnEl) btnEl.disabled = true;
    try {
        const res = await fetch('/.netlify/functions/skin-screenshots-like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ targetId: id }),
        });
        if (res.status === 401) { showShareToast(t('ssc_login_required')); return; }
        if (!res.ok) throw new Error('like failed');
        const data = await res.json();
        const item = skinScreenshotsItems.find((i) => i.id === id);
        if (item) { item.likedByMe = data.liked; item.likeCount = data.likeCount; }
        renderSkinDetail();
        renderSkinScreenshotsList();
    } catch (e) {
        console.error('Toggle skin like failed:', e);
        showShareToast(t('gallery_like_fail'));
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

async function deleteSkinScreenshot(id) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('ssc_login_required')); return; }
    if (!confirm(t('ssc_delete_confirm'))) return;
    try {
        const res = await fetch('/.netlify/functions/skin-screenshots-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error('delete failed');
        showShareToast(t('ssc_delete_done'));
        closeSkinDetail();
        loadSkinScreenshotsPage(skinScreenshotsPage);
    } catch (e) {
        console.error('Delete skin failed:', e);
        showShareToast(t('ssc_delete_fail'));
    }
}

/* ----- sharing a skin ----- */
let sscPicked = []; // [{ file, url }]: the screenshots in order, the first one the cover
let sscModes = new Set(['standard']);

function openSkinShare() {
    if (!getOsuAuthToken()) { showShareToast(t('ssc_login_required')); return; }
    document.getElementById('ssc-share-modal').style.display = 'flex';
    renderSscShareModes();
    renderSscPicked();
    if (!document.querySelector('#ssc-links .ssc-link-row')) addSscLinkRow();
}
function closeSkinShare() { document.getElementById('ssc-share-modal').style.display = 'none'; }

function renderSscShareModes() {
    const el = document.getElementById('ssc-share-modes');
    if (!el) return;
    el.innerHTML = OSU_MODES.map((m, i) => `<button type="button" class="ssc-mode-toggle ${sscModes.has(m) ? 'on' : ''}" aria-pressed="${sscModes.has(m)}" onclick="toggleSscMode('${m}')">${modeIconSvg(m)} ${OSU_MODE_LABELS[i]}</button>`).join('');
}
function toggleSscMode(m) {
    if (sscModes.has(m) && sscModes.size > 1) sscModes.delete(m); else sscModes.add(m);
    renderSscShareModes();
}

function pickSscImages(input) {
    const files = [...(input.files || [])].filter((f) => f.type.startsWith('image/'));
    for (const f of files) {
        if (sscPicked.length >= SSC_MAX_IMAGES) { showShareToast(t('ssc_images_max', { n: SSC_MAX_IMAGES })); break; }
        sscPicked.push({ file: f, url: URL.createObjectURL(f) });
    }
    input.value = '';
    renderSscPicked();
}
function moveSscImage(i, d) {
    const j = i + d;
    if (j < 0 || j >= sscPicked.length) return;
    [sscPicked[i], sscPicked[j]] = [sscPicked[j], sscPicked[i]];
    renderSscPicked();
}
function removeSscImage(i) {
    const [x] = sscPicked.splice(i, 1);
    if (x) URL.revokeObjectURL(x.url);
    renderSscPicked();
}
function renderSscPicked() {
    const el = document.getElementById('ssc-picked');
    if (!el) return;
    const tiles = sscPicked.map((p, i) => `<div class="ssc-pick${i === 0 ? ' cover' : ''}">
            <img src="${p.url}" alt="">
            ${i === 0 ? `<span class="ssc-cover-tag">${sscEsc(t('ssc_cover'))}</span>` : ''}
            <span class="ssc-pick-acts">
                <button type="button" onclick="moveSscImage(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="←">←</button>
                <button type="button" onclick="moveSscImage(${i}, 1)" ${i === sscPicked.length - 1 ? 'disabled' : ''} aria-label="→">→</button>
                <button type="button" onclick="removeSscImage(${i})" aria-label="${sscEsc(t('close_label'))}">✕</button>
            </span>
        </div>`).join('');
    const add = sscPicked.length < SSC_MAX_IMAGES
        ? `<label class="ssc-pick ssc-pick-add">${icon('plus', { size: '1.4rem' })}<span>${sscEsc(t('ssc_images_add'))}</span><small>${sscPicked.length} / ${SSC_MAX_IMAGES}</small><input type="file" accept="image/*" multiple hidden onchange="pickSscImages(this)"></label>`
        : '';
    el.innerHTML = tiles + add;
}

function addSscLinkRow(value = '') {
    const box = document.getElementById('ssc-links');
    if (!box || box.querySelectorAll('.ssc-link-row').length >= SSC_MAX_LINKS) return;
    const row = document.createElement('div');
    row.className = 'ssc-link-row';
    row.innerHTML = `<input type="url" maxlength="500" placeholder="https://" value="${sscEsc(value)}" oninput="sscLinkHost(this)"><span class="ssc-link-host"></span><button type="button" class="ssc-link-del" aria-label="${sscEsc(t('close_label'))}" onclick="this.parentElement.remove(); sscLinkAddBtn()">✕</button>`;
    box.appendChild(row);
    sscLinkHost(row.querySelector('input'));
    sscLinkAddBtn();
}
function sscLinkAddBtn() {
    const b = document.getElementById('ssc-link-add');
    if (b) b.hidden = document.querySelectorAll('#ssc-links .ssc-link-row').length >= SSC_MAX_LINKS;
}
function sscLinkHost(input) {
    const tag = input.parentElement.querySelector('.ssc-link-host');
    const h = /^https?:\/\//i.test(input.value.trim()) ? sscHost(input.value.trim()) : null;
    tag.textContent = h ? h.name : '';
    tag.style.setProperty('--host', h ? h.color : 'transparent');
}

function previewSkinScreenshotOskFile(input) {
    const nameEl = document.getElementById('ssc-upload-osk-name');
    if (!nameEl) return;
    const file = input.files && input.files[0];
    if (!file) { nameEl.textContent = ''; return; }
    if (file.size > SKIN_SCREENSHOT_MAX_OSK_BYTES) {
        nameEl.textContent = t('ssc_osk_too_large', { limit: (SKIN_SCREENSHOT_MAX_OSK_BYTES / 1024 / 1024).toFixed(1) });
        nameEl.style.color = '#ff5252';
        input.value = '';
        return;
    }
    nameEl.style.color = '';
    nameEl.textContent = t('ssc_osk_selected', { name: file.name });
}

// a screenshot → WebP, at most 1920 px wide (2x of the largest place it is shown)
function sscEncode(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > SSC_MAX_DIM) { height = Math.round(height * (SSC_MAX_DIM / width)); width = SSC_MAX_DIM; }
            const c = document.createElement('canvas');
            c.width = width; c.height = height;
            c.getContext('2d').drawImage(img, 0, 0, width, height);
            const done = (blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('encode failed')));
            c.toBlob((b) => (b && b.type === 'image/webp' ? done(b) : c.toBlob(done, 'image/jpeg', 0.85)), 'image/webp', SSC_WEBP_QUALITY);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
        img.src = url;
    });
}

async function uploadSkinScreenshot() {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('ssc_login_required')); return; }
    const status = document.getElementById('ssc-upload-status');
    const say = (msg, bad) => { status.textContent = msg; status.style.color = bad ? '#ff5252' : '#c8a2e0'; };
    const skinName = document.getElementById('ssc-upload-name').value.trim();
    const author = document.getElementById('ssc-upload-author').value.trim();
    const version = document.getElementById('ssc-upload-version').value.trim();
    const aspect = document.getElementById('ssc-upload-aspect').value;
    const description = document.getElementById('ssc-upload-desc').value.trim();
    const links = [...document.querySelectorAll('#ssc-links .ssc-link-row input')].map((i) => i.value.trim()).filter(Boolean);
    const oskInput = document.getElementById('ssc-upload-osk-file');
    const oskFile = oskInput.files && oskInput.files[0];

    if (!skinName) return say(t('ssc_name_required'), true);
    if (!sscPicked.length) return say(t('ssc_image_required'), true);
    if (links.some((l) => !/^https?:\/\//i.test(l))) return say(t('ssc_url_invalid'), true);
    if (!links.length && !oskFile) return say(t('ssc_link_or_file_required'), true);

    const btn = document.getElementById('ssc-upload-btn');
    btn.disabled = true;
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    try {
        const images = [];
        for (let i = 0; i < sscPicked.length; i++) {
            say(t('ssc_uploading_n', { n: i + 1, t: sscPicked.length }));
            const { blob, width, height } = await sscEncode(sscPicked[i].file);
            const res = await fetch('/.netlify/functions/skin-screenshots-upload?part=image', { method: 'POST', headers: auth, body: JSON.stringify({ dataBase64: await blobToBase64(blob) }) });
            const data = await res.json().catch(() => null);
            if (res.status === 401) return say(t('ssc_login_required'), true);
            if (!res.ok) throw new Error((data && data.error) || 'image upload failed');
            images.push({ key: data.key, w: width, h: height });
        }
        say(t('ssc_uploading'));
        const payload = { skinName, author, version, description, aspect, modes: [...sscModes], images, links };
        if (oskFile) { payload.oskDataBase64 = await blobToBase64(oskFile); payload.oskFilename = oskFile.name; }
        const res = await fetch('/.netlify/functions/skin-screenshots-upload', { method: 'POST', headers: auth, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'upload failed');

        say('');
        showShareToast(t('ssc_upload_done'));
        ['ssc-upload-name', 'ssc-upload-author', 'ssc-upload-version', 'ssc-upload-desc'].forEach((id) => { document.getElementById(id).value = ''; });
        oskInput.value = '';
        document.getElementById('ssc-upload-osk-name').textContent = '';
        sscPicked.forEach((p) => URL.revokeObjectURL(p.url));
        sscPicked = [];
        document.getElementById('ssc-links').innerHTML = '';
        closeSkinShare();
        loadSkinScreenshotsPage(0);
    } catch (e) {
        console.error('Skin upload failed:', e);
        say(`${t('ssc_upload_fail')}${e.message ? ` (${e.message})` : ''}`, true);
    } finally {
        btn.disabled = false;
    }
}
