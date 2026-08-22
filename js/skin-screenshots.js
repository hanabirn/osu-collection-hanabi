/* ===== Public skin screenshot plaza =====
   Browse/publish real screenshots of osu! skins in action — see
   netlify/functions/skin-screenshots-{upload,list,image,download,like,
   delete}.js. Unlike the public collections gallery (one entry per user,
   overwritten on republish), a user can publish many screenshots here, so
   this is a flat paginated list filtered by mode/search/liked/mine rather
   than a per-owner drill-down. Every screenshot needs a way to actually get
   the skin — either an external downloadUrl the publisher types in, or the
   .osk file itself uploaded alongside the screenshot (small ones only, see
   skin-screenshots-upload.js's size cap; at least one of the two is
   required). Publishing/liking/deleting all require a verified osu! login
   (getOsuAuthToken(), js/osu.js) since the server trusts nothing else about
   who's asking — and, since this site has no moderation/admin panel, that
   login is the only real deterrent against abuse (see
   skin-screenshots-upload.js's header comment). ===== */
const SKIN_SCREENSHOTS_PAGE_SIZE = 20;
const SKIN_SCREENSHOT_MAX_DIM = 1280;
const SKIN_SCREENSHOT_JPEG_QUALITY = 0.82;

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
let sscUploadMode = 'standard';

function ensureSkinScreenshotsLoaded() {
    renderSscUploadModeTabs();
    renderSkinScreenshotsFilterTabs();
    if (!skinScreenshotsLoaded) loadSkinScreenshotsPage(0);
}

/* Same osu-mode-tabs + modeIconSvg pattern used everywhere else on the site
   a ruleset needs picking (collection tabs, farm-map tabs, the gallery
   detail modal's mode switcher). */
function renderSscUploadModeTabs() {
    const el = document.getElementById('ssc-upload-mode-tabs');
    if (!el) return;
    el.innerHTML = OSU_MODES.map((mode, i) => `
        <button type="button" class="osu-tab ${mode === sscUploadMode ? 'active' : ''}" onclick="switchSscUploadMode('${mode}', this)">${modeIconSvg(mode)} ${OSU_MODE_LABELS[i]}</button>
    `).join('');
}
function switchSscUploadMode(mode, el) {
    sscUploadMode = mode;
    document.querySelectorAll('#ssc-upload-mode-tabs .osu-tab').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

function renderSkinScreenshotsFilterTabs() {
    const el = document.getElementById('skin-screenshots-mode-filter');
    if (!el) return;
    const allBtn = `<button class="osu-tab ${skinScreenshotsMode === '' ? 'active' : ''}" onclick="filterSkinScreenshotsMode('')">${t('ssc_filter_all')}</button>`;
    const modeBtns = OSU_MODES.map((mode, i) => `<button class="osu-tab ${skinScreenshotsMode === mode ? 'active' : ''}" onclick="filterSkinScreenshotsMode('${mode}')">${modeIconSvg(mode)} ${OSU_MODE_LABELS[i]}</button>`).join('');
    el.innerHTML = allBtn + modeBtns;
}
function filterSkinScreenshotsMode(mode) {
    skinScreenshotsMode = mode;
    renderSkinScreenshotsFilterTabs();
    loadSkinScreenshotsPage(0);
}

function switchSkinScreenshotsSort(sort) {
    skinScreenshotsSort = sort;
    loadSkinScreenshotsPage(0);
}

/* Debounced server-side search (skinName/author/username) — same pattern
   as searchPublicCollections() in js/public-collections.js. */
function searchSkinScreenshots(value) {
    skinScreenshotsQuery = value.trim();
    clearTimeout(skinScreenshotsSearchDebounce);
    skinScreenshotsSearchDebounce = setTimeout(() => loadSkinScreenshotsPage(0), 350);
}

function toggleSkinScreenshotsLikedOnly(checked) {
    if (checked && !getOsuAuthToken()) { showShareToast(t('ssc_login_required')); syncSkinScreenshotsCheckboxes(); return; }
    skinScreenshotsLikedOnly = checked;
    loadSkinScreenshotsPage(0);
}
function toggleSkinScreenshotsMineOnly(checked) {
    if (checked && !getOsuAuthToken()) { showShareToast(t('ssc_login_required')); syncSkinScreenshotsCheckboxes(); return; }
    skinScreenshotsMineOnly = checked;
    loadSkinScreenshotsPage(0);
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
        const res = await fetch(`/.netlify/functions/skin-screenshots-list?${params}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 401) {
            // Only happens for a likedOnly/mine request whose token expired
            // since the checkbox was checked — fall back to browsing everyone.
            skinScreenshotsLikedOnly = false;
            skinScreenshotsMineOnly = false;
            syncSkinScreenshotsCheckboxes();
            return loadSkinScreenshotsPage(0);
        }
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        skinScreenshotsPage = data.page || 0;
        skinScreenshotsTotal = data.total || 0;
        skinScreenshotsItems = data.items || [];
        renderSkinScreenshotsList();
    } catch (e) {
        console.error('Skin screenshots list failed:', e);
        listEl.innerHTML = `<p class="osu-empty">${t('ssc_load_fail')}</p>`;
    }
}

function renderSkinScreenshotsList() {
    const listEl = document.getElementById('skin-screenshots-list');
    const pageEl = document.getElementById('skin-screenshots-pagination');
    if (!listEl || !skinScreenshotsLoaded) return;

    syncSkinScreenshotsCheckboxes();

    if (skinScreenshotsItems.length === 0) {
        const hasFilter = !!(skinScreenshotsQuery || skinScreenshotsMode || skinScreenshotsLikedOnly || skinScreenshotsMineOnly);
        listEl.innerHTML = `<p class="osu-empty">${t(hasFilter ? 'ssc_no_results' : 'ssc_empty')}</p>`;
        if (pageEl) pageEl.innerHTML = '';
        return;
    }

    const loggedInUser = getLoggedInOsuUser();

    listEl.innerHTML = skinScreenshotsItems.map(item => {
        const isOwn = loggedInUser && String(loggedInUser.id) === String(item.userId);
        const actionBtnHtml = isOwn
            ? `<button class="ssc-delete-btn" onclick="deleteSkinScreenshot('${item.id}')" title="${t('ssc_delete_btn_title')}">${icon('trash2')}</button>`
            : `<button class="ssc-like-btn ${item.likedByMe ? 'liked' : ''}" onclick="toggleSkinScreenshotLike('${item.id}', this)" title="${t('gallery_like_btn_title')}">
                <span class="ssc-like-icon">${icon('heart', { filled: item.likedByMe })}</span><span class="ssc-like-count">${(item.likeCount || 0).toLocaleString()}</span>
               </button>`;
        const aspectStyle = (item.width && item.height) ? ` style="aspect-ratio:${item.width}/${item.height};"` : '';
        // A screenshot always has at least one of these two (enforced by
        // skin-screenshots-upload.js) — both render when a publisher gave
        // both an external link and a hosted .osk.
        const linkBtnHtml = item.downloadUrl
            ? `<a class="btn ssc-link-btn" href="${escapeHtmlOsu(item.downloadUrl)}" target="_blank" rel="noopener noreferrer">${icon('externalLink', { extraClass: 'icon-label-gap' })}${t('ssc_download_link_title')}</a>`
            : '';
        const fileBtnHtml = item.oskFilename
            ? `<a class="btn ssc-link-btn" href="/.netlify/functions/skin-screenshots-download?id=${item.id}">${icon('download', { extraClass: 'icon-label-gap' })}${t('ssc_download_file_title')}</a>`
            : '';
        const authorLine = item.author ? t('ssc_by_author', { author: escapeHtmlOsu(item.author) }) : escapeHtmlOsu(item.username || '');

        return `
        <div class="skin-screenshot-card">
            <div class="ssc-image-wrap"${aspectStyle}>
                <img class="ssc-image" src="/.netlify/functions/skin-screenshots-image?id=${item.id}" alt="${escapeHtmlOsu(item.skinName)}" loading="lazy">
                <span class="ssc-mode-badge">${modeIconSvg(item.mode)}</span>
            </div>
            <div class="ssc-body">
                <div class="ssc-header">
                    <div class="ssc-header-text">
                        <div class="ssc-name">${escapeHtmlOsu(item.skinName)}</div>
                        <div class="ssc-author">${authorLine}</div>
                    </div>
                    ${actionBtnHtml}
                </div>
                <div class="ssc-links-row">${linkBtnHtml}${fileBtnHtml}</div>
            </div>
        </div>`;
    }).join('');

    if (!pageEl) return;
    const totalPages = Math.max(1, Math.ceil(skinScreenshotsTotal / SKIN_SCREENSHOTS_PAGE_SIZE));
    if (totalPages <= 1) {
        pageEl.innerHTML = '';
        return;
    }
    let pages = '';
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(0)" ${skinScreenshotsPage === 0 ? 'disabled' : ''}>«</button>`;
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(Math.max(0,${skinScreenshotsPage}-1))" ${skinScreenshotsPage === 0 ? 'disabled' : ''}>‹</button>`;
    pages += buildPaginationPageButtons(skinScreenshotsPage, totalPages, (i) => `loadSkinScreenshotsPage(${i})`);
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(Math.min(${totalPages - 1},${skinScreenshotsPage}+1))" ${skinScreenshotsPage >= totalPages - 1 ? 'disabled' : ''}>›</button>`;
    pages += `<button class="osu-page-btn" onclick="loadSkinScreenshotsPage(${totalPages - 1})" ${skinScreenshotsPage >= totalPages - 1 ? 'disabled' : ''}>»</button>`;
    pageEl.innerHTML = pages;
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

        const item = skinScreenshotsItems.find(i => i.id === id);
        if (item) { item.likedByMe = data.liked; item.likeCount = data.likeCount; }
        if (btnEl) {
            btnEl.classList.toggle('liked', data.liked);
            btnEl.querySelector('.ssc-like-icon').innerHTML = icon('heart', { filled: data.liked });
            btnEl.querySelector('.ssc-like-count').textContent = data.likeCount.toLocaleString();
        }
    } catch (e) {
        console.error('Toggle skin screenshot like failed:', e);
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
        loadSkinScreenshotsPage(skinScreenshotsPage);
    } catch (e) {
        console.error('Delete skin screenshot failed:', e);
        showShareToast(t('ssc_delete_fail'));
    }
}

/* ===== Upload form =====
   Downscales/re-encodes the chosen image to JPEG client-side before it ever
   leaves the browser (screenshots straight off a phone/high-DPI monitor can
   run several MB — sending that as-is would blow past
   skin-screenshots-upload.js's per-request limit and just waste the
   uploader's bandwidth for a thumbnail-sized gallery card anyway). */
function resizeImageToJpeg(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (!blob) { reject(new Error('encode failed')); return; }
                resolve({ blob, width, height });
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
        img.src = url;
    });
}

const SKIN_SCREENSHOT_MAX_OSK_BYTES = 2.5 * 1024 * 1024;

function previewSkinScreenshotFile(input) {
    const preview = document.getElementById('ssc-upload-preview');
    if (!preview) return;
    const file = input.files && input.files[0];
    if (!file) { preview.innerHTML = ''; return; }
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" alt="">`;
}

/* Just names the chosen .osk (and flags an oversized one immediately,
   before the user even hits publish) — the file itself is read fresh from
   the input at submit time in uploadSkinScreenshot(), same as the
   screenshot file input. */
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

async function uploadSkinScreenshot() {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('ssc_login_required')); return; }

    const nameInput = document.getElementById('ssc-upload-name');
    const authorInput = document.getElementById('ssc-upload-author');
    const urlInput = document.getElementById('ssc-upload-url');
    const fileInput = document.getElementById('ssc-upload-file');
    const oskFileInput = document.getElementById('ssc-upload-osk-file');
    const status = document.getElementById('ssc-upload-status');
    const skinName = nameInput.value.trim();
    const author = authorInput.value.trim();
    const downloadUrl = urlInput.value.trim();
    const file = fileInput.files && fileInput.files[0];
    const oskFile = oskFileInput.files && oskFileInput.files[0];

    if (!skinName) { status.textContent = t('ssc_name_required'); status.style.color = '#ff5252'; return; }
    if (!file) { status.textContent = t('ssc_image_required'); status.style.color = '#ff5252'; return; }
    if (!downloadUrl && !oskFile) { status.textContent = t('ssc_link_or_file_required'); status.style.color = '#ff5252'; return; }
    if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) { status.textContent = t('ssc_url_invalid'); status.style.color = '#ff5252'; return; }
    if (oskFile && oskFile.size > SKIN_SCREENSHOT_MAX_OSK_BYTES) {
        status.textContent = t('ssc_osk_too_large', { limit: (SKIN_SCREENSHOT_MAX_OSK_BYTES / 1024 / 1024).toFixed(1) });
        status.style.color = '#ff5252';
        return;
    }

    status.textContent = t('ssc_uploading');
    status.style.color = '#c8a2e0';

    try {
        const { blob, width, height } = await resizeImageToJpeg(file, SKIN_SCREENSHOT_MAX_DIM, SKIN_SCREENSHOT_JPEG_QUALITY);
        const dataBase64 = await blobToBase64(blob);
        const payload = { skinName, author, downloadUrl, mode: sscUploadMode, dataBase64, width, height };
        if (oskFile) {
            payload.oskDataBase64 = await blobToBase64(oskFile);
            payload.oskFilename = oskFile.name;
        }
        const res = await fetch('/.netlify/functions/skin-screenshots-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
        });
        if (res.status === 401) { status.textContent = t('ssc_login_required'); status.style.color = '#ff5252'; return; }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'upload failed');

        status.textContent = '';
        showShareToast(t('ssc_upload_done'));
        nameInput.value = '';
        authorInput.value = '';
        urlInput.value = '';
        fileInput.value = '';
        oskFileInput.value = '';
        const preview = document.getElementById('ssc-upload-preview');
        if (preview) preview.innerHTML = '';
        const oskNameEl = document.getElementById('ssc-upload-osk-name');
        if (oskNameEl) oskNameEl.textContent = '';
        if (skinScreenshotsLoaded) loadSkinScreenshotsPage(0);
    } catch (e) {
        console.error('Skin screenshot upload failed:', e);
        status.textContent = `${t('ssc_upload_fail')}${e.message ? ' (' + e.message + ')' : ''}`;
        status.style.color = '#ff5252';
    }
}
