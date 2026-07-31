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
    container.innerHTML = skins.map(s => `
        <div class="skin-item">
            <div class="skin-item-info">
                <div class="skin-item-name">${escapeSkinName(s.name)}</div>
                <div class="skin-item-meta">${formatSkinSize(s.size)} &middot; ${new Date(s.addedAt).toLocaleDateString()}</div>
            </div>
            <div class="skin-item-actions">
                <button class="skin-download-btn" onclick="downloadSkinFile(${s.id})">${t('skins_download')}</button>
                <button class="skin-delete-btn" onclick="confirmDeleteSkin(${s.id})">${t('skins_delete')}</button>
            </div>
        </div>
    `).join('');
}
