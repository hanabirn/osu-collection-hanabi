/* ===== osu! Skin locker — stored entirely in the visitor's own browser =====
   No backend exists on this site (the beatmap collection is the same:
   localStorage-only), and skin files (.osk) commonly run 10-200+ MB, far
   past what localStorage can hold. IndexedDB has no such practical size
   limit, so skin *files* (as Blobs) live there, keyed per-browser — this
   is a personal locker, not a shared upload visible to other visitors. */
const SKIN_DB_NAME = 'osu_skins_db';
const SKIN_STORE = 'skins';

function openSkinDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SKIN_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SKIN_STORE)) {
                db.createObjectStore(SKIN_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function addSkinFile(file) {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readwrite');
        tx.objectStore(SKIN_STORE).add({ name: file.name, size: file.size, addedAt: Date.now(), file });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function getAllSkins() {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readonly');
        const req = tx.objectStore(SKIN_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

function deleteSkinFile(id) {
    return openSkinDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(SKIN_STORE, 'readwrite');
        tx.objectStore(SKIN_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

async function handleSkinUpload(event) {
    const input = event.target;
    const files = [...(input.files || [])];
    if (!files.length) return;
    const status = document.getElementById('skin-upload-status');

    for (const file of files) {
        try {
            await addSkinFile(file);
        } catch (e) {
            console.error('Skin upload failed:', e);
            if (status) status.textContent = t('skins_upload_fail', { n: file.name });
        }
    }
    input.value = '';
    if (status && !status.textContent) status.textContent = t('skins_upload_done', { n: files.length });
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    renderSkinsList();
}

async function downloadSkinFile(id) {
    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === id);
    if (!skin) return;
    const url = URL.createObjectURL(skin.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = skin.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function confirmDeleteSkin(id) {
    if (!confirm(t('skins_delete_confirm'))) return;
    await deleteSkinFile(id);
    renderSkinsList();
}

/* ===== Skin thumbnail + skin.ini info preview =====
   .osk files are plain zip archives. Instead of unzipping the whole thing
   (files run 10-200+ MB), fflate's filter option skips decompressing every
   entry except the one candidate image and skin.ini itself, so this stays
   fast even for large skins — both come out of the same unzip() pass rather
   than two. Only matches files sitting at the zip root (same as real .osk
   layout), not inside a subfolder. Extracted results are cached per skin id
   for the session so re-renders (after upload/delete) don't redo the work. */
const SKIN_THUMB_CANDIDATES = ['cursor.png', 'cursor@2x.png', 'menu-background.png', 'menu-background@2x.png', 'hitcircle.png', 'hitcircle@2x.png'];
const skinAssetCache = new Map();

/* skin.ini is a plain key:value INI file; only the [General] section's
   Name/Author/Version are worth surfacing here. */
function parseSkinIni(text) {
    const generalMatch = text.match(/\[General\]([\s\S]*?)(?:\r?\n\[|$)/i);
    if (!generalMatch) return null;
    const section = generalMatch[1];
    const grab = (key) => {
        const m = section.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im'));
        return m ? m[1].trim() : '';
    };
    const info = { name: grab('Name'), author: grab('Author'), version: grab('Version') };
    return (info.name || info.author || info.version) ? info : null;
}

function extractSkinAssets(file) {
    if (typeof fflate === 'undefined') return Promise.resolve({ thumbUrl: null, info: null });
    return file.arrayBuffer().then(buf => new Promise(resolve => {
        try {
            fflate.unzip(new Uint8Array(buf), {
                filter: entry => SKIN_THUMB_CANDIDATES.includes(entry.name.toLowerCase()) || entry.name.toLowerCase() === 'skin.ini',
            }, (err, unzipped) => {
                if (err) { resolve({ thumbUrl: null, info: null }); return; }

                let thumbUrl = null;
                for (const name of SKIN_THUMB_CANDIDATES) {
                    const key = Object.keys(unzipped).find(k => k.toLowerCase() === name);
                    if (key) { thumbUrl = URL.createObjectURL(new Blob([unzipped[key]], { type: 'image/png' })); break; }
                }

                let info = null;
                const iniKey = Object.keys(unzipped).find(k => k.toLowerCase() === 'skin.ini');
                if (iniKey) {
                    try { info = parseSkinIni(new TextDecoder('utf-8').decode(unzipped[iniKey])); }
                    catch { info = null; }
                }

                resolve({ thumbUrl, info });
            });
        } catch {
            resolve({ thumbUrl: null, info: null });
        }
    })).catch(() => ({ thumbUrl: null, info: null }));
}

function formatSkinIniInfo(info) {
    const parts = [];
    if (info.name) parts.push(escapeSkinName(info.name));
    if (info.author) parts.push(t('skins_by_author', { author: escapeSkinName(info.author) }));
    if (info.version) parts.push(`v${escapeSkinName(info.version)}`);
    return parts.join(' &middot; ');
}

function loadSkinThumbnails(skins) {
    for (const skin of skins) {
        if (skinAssetCache.has(skin.id)) continue;
        skinAssetCache.set(skin.id, null);
        extractSkinAssets(skin.file).then(assets => {
            skinAssetCache.set(skin.id, assets);
            const thumbEl = document.getElementById(`skin-thumb-${skin.id}`);
            if (thumbEl && assets.thumbUrl) thumbEl.innerHTML = `<img src="${assets.thumbUrl}" alt="">`;
            const infoEl = document.getElementById(`skin-ini-info-${skin.id}`);
            if (infoEl && assets.info) infoEl.innerHTML = formatSkinIniInfo(assets.info);
        });
    }
}

function formatSkinSize(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeSkinName(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function renderSkinsList() {
    const container = document.getElementById('skins-list');
    if (!container) return;
    let skins;
    try {
        skins = await getAllSkins();
    } catch (e) {
        container.innerHTML = `<p class="skins-empty">${t('skins_load_fail')}</p>`;
        return;
    }
    skins.sort((a, b) => b.addedAt - a.addedAt);
    if (skins.length === 0) {
        container.innerHTML = `<p class="skins-empty">${t('skins_empty')}</p>`;
        return;
    }
    container.innerHTML = skins.map(s => {
        const cached = skinAssetCache.get(s.id);
        return `
        <div class="skin-item">
            <div class="skin-item-thumb" id="skin-thumb-${s.id}">${cached && cached.thumbUrl ? `<img src="${cached.thumbUrl}" alt="">` : '🎵'}</div>
            <div class="skin-item-info">
                <div class="skin-item-name">${escapeSkinName(s.name)}</div>
                <div class="skin-item-meta">${formatSkinSize(s.size)} &middot; ${new Date(s.addedAt).toLocaleDateString()}</div>
                <div class="skin-item-ini-info" id="skin-ini-info-${s.id}">${cached && cached.info ? formatSkinIniInfo(cached.info) : ''}</div>
            </div>
            <div class="skin-item-actions">
                <button class="skin-backup-btn" onclick="openSkinPreviewModal(${s.id})" title="${t('skins_preview_btn')}">${icon('palette')}</button>
                <button class="skin-backup-btn" onclick="backupSkinToCloud(${s.id})" title="${t('skins_backup_btn')}">${icon('cloudUpload')}</button>
                <button class="skin-download-btn" onclick="downloadSkinFile(${s.id})">${icon('download', { extraClass: 'icon-label-gap' })}${t('skins_download')}</button>
                <button class="skin-delete-btn" onclick="confirmDeleteSkin(${s.id})">${icon('trash2', { extraClass: 'icon-label-gap' })}${t('skins_delete')}</button>
            </div>
        </div>
    `;
    }).join('');
    loadSkinThumbnails(skins);
}

/* ===== Optional cloud backup =====
   Strictly opt-in and size-capped — see netlify/functions/skins-upload.js
   for exactly why (Netlify Functions' ~6MB request body ceiling vs. real
   skins commonly running 10-200+ MB). Lives as its own list rather than a
   per-item "synced" toggle on the local list above: a cloud backup is a
   snapshot copy, not a live mirror, so keeping the two lists independent
   avoids having to reconcile local-vs-cloud identity for files that have no
   stable id of their own (only a name + size, both mutable). ===== */
const SKIN_BACKUP_MAX_BYTES = 4 * 1024 * 1024;

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function backupSkinToCloud(localId) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }

    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === localId);
    if (!skin) return;
    if (skin.size > SKIN_BACKUP_MAX_BYTES) {
        showShareToast(t('skins_backup_too_large', { limit: SKIN_BACKUP_MAX_BYTES / 1024 / 1024 }));
        return;
    }

    try {
        const dataBase64 = await blobToBase64(skin.file);
        const res = await fetch('/.netlify/functions/skins-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: skin.name, dataBase64 }),
        });
        if (res.status === 401) { showShareToast(t('skins_backup_login_required')); return; }
        if (!res.ok) throw new Error('upload failed');
        showShareToast(t('skins_backup_done'));
        renderCloudSkinsList();
    } catch (e) {
        console.error('Skin cloud backup failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}

async function renderCloudSkinsList() {
    const section = document.getElementById('cloud-skins-section');
    const container = document.getElementById('cloud-skins-list');
    if (!section || !container) return;

    const token = getOsuAuthToken();
    if (!token) { section.style.display = 'none'; return; }
    section.style.display = '';

    try {
        const res = await fetch('/.netlify/functions/skins-list', { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) { section.style.display = 'none'; return; }
        if (!res.ok) throw new Error('list failed');
        const data = await res.json();
        const items = data.items || [];

        if (items.length === 0) {
            container.innerHTML = `<p class="skins-empty">${t('skins_backup_empty')}</p>`;
            return;
        }
        container.innerHTML = items.map(it => `
            <div class="skin-item cloud-skin-item">
                <div class="skin-item-thumb">☁️</div>
                <div class="skin-item-info">
                    <div class="skin-item-name">${escapeSkinName(it.name)}</div>
                    <div class="skin-item-meta">${formatSkinSize(it.size)} &middot; ${new Date(it.uploadedAt).toLocaleDateString()}</div>
                </div>
                <div class="skin-item-actions">
                    <button class="skin-download-btn" onclick="restoreCloudSkinToLocal('${it.id}', decodeURIComponent('${encodeURIComponent(it.name)}'))">${icon('download', { extraClass: 'icon-label-gap' })}${t('skins_backup_restore')}</button>
                    <button class="skin-delete-btn" onclick="confirmDeleteCloudSkin('${it.id}')">${icon('trash2', { extraClass: 'icon-label-gap' })}${t('skins_delete')}</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Cloud skins list failed:', e);
        container.innerHTML = `<p class="skins-empty">${t('skins_load_fail')}</p>`;
    }
}

async function restoreCloudSkinToLocal(id, name) {
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }
    try {
        const res = await fetch(`/.netlify/functions/skins-download?id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('download failed');
        const blob = await res.blob();
        await addSkinFile(new File([blob], name, { type: 'application/octet-stream' }));
        showShareToast(t('skins_backup_restored'));
        renderSkinsList();
    } catch (e) {
        console.error('Cloud skin restore failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}

/* ===== Skin online preview =====
   A canvas animation loop showing off a skin's cursor + hit-circle set
   without ever downloading it in-game — the .osk is already sitting in
   IndexedDB (see the locker above), so this just unzips a few more root-
   level PNGs than the list thumbnail does (extractSkinAssets above only
   grabs one candidate image) plus skin.ini's [General] cursor behavior
   flags and [Colours] combo palette, via the same fflate filtered-unzip
   approach so large skins still unzip fast. The animation itself is a
   fixed, made-up demo (approach circle shrinking onto a hit circle that
   pops on "hit", cursor swooping in to click it and swinging back out) —
   not a recreation of real gameplay, just enough motion to see the skin's
   shapes, colors, and cursor rotate/expand behavior in action. */
const SKIN_PREVIEW_BASE_NAMES = [
    'cursor', 'cursormiddle', 'hitcircle', 'hitcircleoverlay', 'approachcircle',
    'default-0', 'default-1', 'default-2', 'default-3', 'default-4',
    'default-5', 'default-6', 'default-7', 'default-8', 'default-9',
];
function skinPreviewFilterName(name) {
    const lower = name.toLowerCase();
    if (lower === 'skin.ini') return true;
    return SKIN_PREVIEW_BASE_NAMES.some(base => lower === `${base}.png` || lower === `${base}@2x.png`);
}

function parseSkinIniColours(text) {
    const section = text.match(/\[Colours\]([\s\S]*?)(?:\r?\n\[|$)/i);
    if (!section) return [];
    const colours = [];
    const re = /^[ \t]*Combo\d+[ \t]*:[ \t]*(\d+)[ \t]*,[ \t]*(\d+)[ \t]*,[ \t]*(\d+)/gim;
    let m;
    while ((m = re.exec(section[1]))) colours.push(`rgb(${m[1]},${m[2]},${m[3]})`);
    return colours;
}
function parseSkinIniGeneralBool(text, key, fallback) {
    const m = text.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'im'));
    return m ? m[1].trim() === '1' : fallback;
}

// Keyed by skin id, caches the *promise* (not just the resolved value) so
// concurrent preview-opens for the same skin id share one unzip pass
// instead of racing two.
const skinPreviewCache = new Map();

function extractSkinPreviewAssets(skinId, file) {
    if (skinPreviewCache.has(skinId)) return skinPreviewCache.get(skinId);
    const promise = (typeof fflate === 'undefined' ? Promise.resolve(null) : file.arrayBuffer().then(buf => new Promise(resolve => {
        try {
            fflate.unzip(new Uint8Array(buf), { filter: entry => skinPreviewFilterName(entry.name) }, (err, unzipped) => {
                if (err) { resolve(null); return; }
                const pick = (base) => {
                    const key2x = Object.keys(unzipped).find(k => k.toLowerCase() === `${base}@2x.png`);
                    const key1x = Object.keys(unzipped).find(k => k.toLowerCase() === `${base}.png`);
                    const key = key2x || key1x;
                    return key ? URL.createObjectURL(new Blob([unzipped[key]], { type: 'image/png' })) : null;
                };
                let iniText = '';
                const iniKey = Object.keys(unzipped).find(k => k.toLowerCase() === 'skin.ini');
                if (iniKey) { try { iniText = new TextDecoder('utf-8').decode(unzipped[iniKey]); } catch { iniText = ''; } }
                resolve({
                    cursor: pick('cursor'),
                    cursorMiddle: pick('cursormiddle'),
                    hitcircle: pick('hitcircle'),
                    hitcircleOverlay: pick('hitcircleoverlay'),
                    approachCircle: pick('approachcircle'),
                    numbers: Array.from({ length: 10 }, (_, i) => pick(`default-${i}`)),
                    cursorRotate: iniText ? parseSkinIniGeneralBool(iniText, 'CursorRotate', true) : true,
                    cursorExpand: iniText ? parseSkinIniGeneralBool(iniText, 'CursorExpand', true) : true,
                    colours: iniText ? parseSkinIniColours(iniText) : [],
                });
            });
        } catch { resolve(null); }
    })).catch(() => null));
    skinPreviewCache.set(skinId, promise);
    return promise;
}

const SKIN_PREVIEW_LOOP_MS = 1400;
const SKIN_PREVIEW_HIT_MS = 1000; // when the hit-circle "pop" and cursor "click" happen
function easeInOutSkinPreview(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

function drawSkinPreviewFrame(ctx, canvas, images, assets, elapsed) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#150c22';
    ctx.fillRect(0, 0, w, h);

    const t = elapsed % SKIN_PREVIEW_LOOP_MS;
    const cx = w / 2, cy = h / 2;
    const baseR = w * 0.16;

    let circleScale = 1, circleAlpha = 1, approachScale = null;
    if (t < SKIN_PREVIEW_HIT_MS) {
        approachScale = 3 - (t / SKIN_PREVIEW_HIT_MS) * 2; // shrinks 3x -> 1x onto the circle
    } else {
        const p = (t - SKIN_PREVIEW_HIT_MS) / (SKIN_PREVIEW_LOOP_MS - SKIN_PREVIEW_HIT_MS);
        circleScale = 1 + p * 0.4;
        circleAlpha = Math.max(0, 1 - p * 1.4);
    }

    if (circleAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = circleAlpha;
        const r = baseR * circleScale;
        if (images.hitcircle) ctx.drawImage(images.hitcircle, cx - r, cy - r, r * 2, r * 2);
        else { ctx.fillStyle = '#f06292'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
        if (images.hitcircleOverlay) ctx.drawImage(images.hitcircleOverlay, cx - r, cy - r, r * 2, r * 2);
        const numImg = images.numbers && images.numbers[1];
        if (numImg) {
            const nw = r * 0.5, nh = nw * (numImg.height / numImg.width);
            ctx.drawImage(numImg, cx - nw / 2, cy - nh / 2, nw, nh);
        }
        ctx.restore();
    }
    if (approachScale !== null) {
        const ar = baseR * approachScale;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (SKIN_PREVIEW_HIT_MS - t) / 200 + 0.3);
        if (images.approachCircle) ctx.drawImage(images.approachCircle, cx - ar, cy - ar, ar * 2, ar * 2);
        else { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, ar, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
    }

    // Cursor swoops in to "click" the circle at the hit moment, then swings
    // back out along a different angle to set up the next loop's approach —
    // continuous motion rather than resetting instantly, so it reads as one
    // gesture repeating rather than a cursor teleporting each loop.
    const outerR = w * 0.375;
    let cxu, cyu, angle, clickPulse = 0;
    if (t <= SKIN_PREVIEW_HIT_MS) {
        const p = easeInOutSkinPreview(t / SKIN_PREVIEW_HIT_MS);
        angle = -Math.PI / 2 + p * 0.7;
        const r = outerR * (1 - p);
        cxu = cx + Math.cos(angle) * r;
        cyu = cy + Math.sin(angle) * r;
        if (t > SKIN_PREVIEW_HIT_MS - 120) clickPulse = 1 - (SKIN_PREVIEW_HIT_MS - t) / 120;
    } else {
        const p = easeInOutSkinPreview((t - SKIN_PREVIEW_HIT_MS) / (SKIN_PREVIEW_LOOP_MS - SKIN_PREVIEW_HIT_MS));
        angle = -Math.PI / 2 + 0.7 + p * (Math.PI * 2 - 0.7);
        const r = outerR * p;
        cxu = cx + Math.cos(angle) * r;
        cyu = cy + Math.sin(angle) * r;
        if (p < 0.15) clickPulse = 1 - p / 0.15;
    }

    const cursorScale = assets.cursorExpand ? 1 + clickPulse * 0.3 : 1;
    const cursorSize = w * 0.11 * cursorScale;
    ctx.save();
    ctx.translate(cxu, cyu);
    if (images.cursor) {
        if (assets.cursorRotate) ctx.rotate(angle + Math.PI / 2);
        ctx.drawImage(images.cursor, -cursorSize / 2, -cursorSize / 2, cursorSize, cursorSize);
    } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-2, -2); ctx.lineTo(14, 4); ctx.lineTo(2, 8); ctx.lineTo(-2, 16); ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    // cursormiddle intentionally drawn unrotated on top, same as real osu!.
    if (images.cursorMiddle) {
        const ms = cursorSize * 0.5;
        ctx.drawImage(images.cursorMiddle, cxu - ms / 2, cyu - ms / 2, ms, ms);
    }
}

let skinPreviewRAF = null;
let skinPreviewStartTime = 0;

function stopSkinPreviewLoop() {
    if (skinPreviewRAF) { cancelAnimationFrame(skinPreviewRAF); skinPreviewRAF = null; }
}

async function openSkinPreviewModal(skinId) {
    const modal = document.getElementById('skin-preview-modal');
    const status = document.getElementById('skin-preview-status');
    const coloursEl = document.getElementById('skin-preview-colours');
    const canvas = document.getElementById('skin-preview-canvas');
    if (!modal || !canvas) return;

    stopSkinPreviewLoop();
    modal.style.display = 'flex';
    document.getElementById('skin-preview-title').textContent = '';
    status.textContent = t('skins_preview_loading');
    coloursEl.innerHTML = '';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const skins = await getAllSkins();
    const skin = skins.find(s => s.id === skinId);
    if (!skin) { status.textContent = t('skins_preview_fail'); return; }
    document.getElementById('skin-preview-title').textContent = skin.name;

    const assets = await extractSkinPreviewAssets(skinId, skin.file);
    // The modal may have been closed (or reopened for a different skin)
    // while the unzip above was in flight — bail rather than animate into
    // a canvas nobody's looking at, or the wrong skin's canvas.
    if (!assets || document.getElementById('skin-preview-modal').style.display === 'none') {
        if (assets === null) status.textContent = t('skins_preview_fail');
        return;
    }

    const images = {};
    await Promise.all(['cursor', 'cursorMiddle', 'hitcircle', 'hitcircleOverlay', 'approachCircle'].map(async key => {
        if (assets[key]) images[key] = await loadImageQuiet(assets[key]);
    }));
    images.numbers = await Promise.all(assets.numbers.map(url => url ? loadImageQuiet(url) : Promise.resolve(null)));

    if (document.getElementById('skin-preview-modal').style.display === 'none') return;
    status.textContent = '';
    if (assets.colours.length) {
        coloursEl.innerHTML = assets.colours.map(c => `<span class="skin-preview-colour-dot" style="background:${c}"></span>`).join('');
    }

    skinPreviewStartTime = performance.now();
    const loop = (now) => {
        drawSkinPreviewFrame(ctx, canvas, images, assets, now - skinPreviewStartTime);
        skinPreviewRAF = requestAnimationFrame(loop);
    };
    skinPreviewRAF = requestAnimationFrame(loop);
}

function closeSkinPreviewModal() {
    const modal = document.getElementById('skin-preview-modal');
    if (modal) modal.style.display = 'none';
    stopSkinPreviewLoop();
}

async function confirmDeleteCloudSkin(id) {
    if (!confirm(t('skins_delete_confirm'))) return;
    const token = getOsuAuthToken();
    if (!token) { showShareToast(t('skins_backup_login_required')); return; }
    try {
        const res = await fetch('/.netlify/functions/skins-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error('delete failed');
        renderCloudSkinsList();
    } catch (e) {
        console.error('Cloud skin delete failed:', e);
        showShareToast(t('skins_backup_fail'));
    }
}
