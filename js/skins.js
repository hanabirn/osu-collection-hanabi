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
